/** Unit tests for the pure diff-pane logic (PRD §4.13). */
import { describe, expect, it } from "vitest";
import type { Hunk, HunkLine, ReviewFile } from "@unvibe/shared";
import { hashHunkLines } from "@unvibe/shared";
import { MOCK_FILES } from "../../mock/diff.js";
import {
  buildFileTree,
  filterFiles,
  groupHunks,
  hiddenRunLabel,
  hunkOverlaps,
  hunkPlotVisible,
  pairSplitRows,
  parseDiffRef,
  shouldHideHunk,
  tailPathParts,
} from "./diffLogic.js";

let seq = 0;
function hunk(over: Partial<Hunk> = {}): Hunk {
  seq += 1;
  return {
    contentHash: `h${seq}`,
    header: "@@ -1,2 +1,2 @@",
    newStart: 1,
    newEnd: 2,
    oldStart: 1,
    oldEnd: 2,
    added: 1,
    removed: 1,
    lines: [],
    ...over,
  };
}

function file(path: string, hunks: Hunk[] = [], category: ReviewFile["category"] = "source"): ReviewFile {
  return { fileKey: path.replace(/[^a-z0-9]+/gi, "-"), path, category, hunks };
}

function line(kind: HunkLine["kind"], n?: number, o?: number): HunkLine {
  return { kind, text: `code-${kind}`, ...(n !== undefined ? { newLine: n } : {}), ...(o !== undefined ? { oldLine: o } : {}) };
}

describe("buildFileTree", () => {
  it("compacts single-child folders and sorts dirs before files", () => {
    const rows = buildFileTree([
      file("src/urllib3/connection.py"),
      file("src/urllib3/util/retry.py"),
      file("test/test_connection.py"),
    ]);
    expect(rows).toEqual([
      { type: "dir", path: "src/urllib3", label: "src/urllib3", depth: 0 },
      { type: "dir", path: "src/urllib3/util", label: "util", depth: 1 },
      { type: "file", file: expect.objectContaining({ path: "src/urllib3/util/retry.py" }), depth: 2 },
      { type: "file", file: expect.objectContaining({ path: "src/urllib3/connection.py" }), depth: 1 },
      { type: "dir", path: "test", label: "test", depth: 0 },
      { type: "file", file: expect.objectContaining({ path: "test/test_connection.py" }), depth: 1 },
    ]);
  });

  it("keeps a lone file at the root without a directory row", () => {
    const rows = buildFileTree([file("README.md", [], "docs")]);
    expect(rows).toEqual([{ type: "file", file: expect.objectContaining({ path: "README.md" }), depth: 0 }]);
  });
});

describe("tailPathParts (#227)", () => {
  it("keeps short labels whole", () => {
    expect(tailPathParts("src/app")).toEqual({ pre: "", end: "src/app" });
    expect(tailPathParts("src/")).toEqual({ pre: "", end: "src/" });
    expect(tailPathParts("")).toEqual({ pre: "", end: "" });
  });

  it("splits a long chain so the last segments stay readable", () => {
    expect(tailPathParts("a/b/c/d/e")).toEqual({ pre: "a/b/c/", end: "d/e" });
    expect(tailPathParts("a/b/c/d/e", 1)).toEqual({ pre: "a/b/c/d/", end: "e" });
  });

  it("keeps a trailing slash on the tail (diff-header dirs)", () => {
    expect(tailPathParts("a/b/c/d/")).toEqual({ pre: "a/b/", end: "c/d/" });
  });
});

describe("groupHunks", () => {
  const hs = [hunk(), hunk(), hunk(), hunk()];
  it("groups consecutive hidden hunks into runs", () => {
    expect(
      groupHunks(hs, (_h, i) => i !== 2),
    ).toEqual([{ type: "hidden", indices: [0, 1] }, { type: "show", index: 2 }, { type: "hidden", indices: [3] }]);
  });
  it("returns single shows when nothing hides", () => {
    expect(groupHunks(hs, () => false)).toEqual([0, 1, 2, 3].map((index) => ({ type: "show", index })));
  });
  it("handles an empty hunk list", () => {
    expect(groupHunks([], () => true)).toEqual([]);
  });
});

describe("pairSplitRows", () => {
  it("zips del/add runs pairwise and passes context through", () => {
    const rows = pairSplitRows([line("ctx", 1, 1), line("del", undefined, 2), line("del", undefined, 3), line("add", 2), line("ctx", 3, 4)]);
    expect(rows).toEqual([
      { kind: "ctx", line: expect.objectContaining({ kind: "ctx" }) },
      { kind: "pair", left: expect.objectContaining({ kind: "del" }), right: expect.objectContaining({ kind: "add" }) },
      { kind: "pair", left: expect.objectContaining({ kind: "del" }), right: undefined },
      { kind: "ctx", line: expect.objectContaining({ kind: "ctx" }) },
    ]);
  });
  it("pads add-only runs with empty left cells", () => {
    expect(pairSplitRows([line("add", 5), line("add", 6)])).toEqual([
      { kind: "pair", left: undefined, right: expect.objectContaining({ newLine: 5 }) },
      { kind: "pair", left: undefined, right: expect.objectContaining({ newLine: 6 }) },
    ]);
  });
});

describe("filterFiles", () => {
  const files = [
    file("src/a.py", [hunk({ contentHash: "a1" })]),
    file("test/b.py", [hunk({ contentHash: "b1" })], "tests"),
  ];
  const reviewed = (f: ReviewFile): number => (f.path === "src/a.py" ? 1 : 0);
  it("matches names case-insensitively", () => {
    expect(filterFiles(files, { query: "SRC/", cats: new Set(["source", "tests"]), hideReviewed: false, reviewedCount: reviewed })).toHaveLength(1);
  });
  it("excludes deselected categories", () => {
    expect(filterFiles(files, { query: "", cats: new Set(["tests"]), hideReviewed: false, reviewedCount: reviewed })).toHaveLength(1);
  });
  it("hides fully reviewed files when asked", () => {
    expect(filterFiles(files, { query: "", cats: new Set(["source", "tests"]), hideReviewed: true, reviewedCount: reviewed })).toHaveLength(1);
  });
  it("Since-B filter keeps only files with a hunk in the delta (#351)", () => {
    const base = { query: "", cats: new Set(["source", "tests"]), hideReviewed: false, reviewedCount: reviewed };
    const all = new Set(["h:src-a-py:a1", "h:test-b-py:b1"]);
    expect(filterFiles(files, { ...base, plot: { sinceBaseline: true }, sinceIds: all })).toHaveLength(2);
    expect(
      filterFiles(files, { ...base, plot: { sinceBaseline: true }, sinceIds: new Set(["h:src-a-py:a1"]) }),
    ).toEqual([expect.objectContaining({ path: "src/a.py" })]);
    expect(filterFiles(files, { ...base, plot: {}, sinceIds: new Set(["h:src-a-py:a1"]) })).toHaveLength(1);
  });
  it("hunkPlotVisible combines the Since-B set with the plotline filter (#351)", () => {
    const ha = hunk({ contentHash: "a1" });
    const hb = hunk({ contentHash: "b1" });
    const st = (hash: string) => (hash === "a1" ? { plotline: "unfold" } : undefined);
    expect(hunkPlotVisible(ha, "src-a-py", { plot: { plotline: "unfold" }, hunkStateOf: st })).toBe(true);
    expect(hunkPlotVisible(hb, "test-b-py", { plot: { plotline: "unfold" }, hunkStateOf: st })).toBe(false);
    expect(
      hunkPlotVisible(ha, "src-a-py", {
        plot: { sinceBaseline: true },
        sinceIds: new Set(["h:test-b-py:b1"]),
        hunkStateOf: st,
      }),
    ).toBe(false);
    expect(hunkPlotVisible(hb, "test-b-py", { sinceIds: new Set(["h:test-b-py:b1"]) })).toBe(true);
  });
});

describe("shouldHideHunk", () => {
  const hidden = hunk({ hiddenReason: "imports", added: 1, removed: 1 });
  it("requires the uninteresting level and a hidden reason", () => {
    expect(shouldHideHunk(hidden, { level: "all", unhidden: false })).toBe(false);
    expect(shouldHideHunk(hunk(), { level: "uninteresting", unhidden: false })).toBe(false);
    expect(shouldHideHunk(hidden, { level: "uninteresting", unhidden: false })).toBe(true);
  });
  it("hides by score at the higher levels (#325)", () => {
    expect(shouldHideHunk(hunk(), { level: "routine", score: "mechanical", unhidden: false })).toBe(true);
    expect(shouldHideHunk(hunk(), { level: "substantive", score: "routine", unhidden: false })).toBe(true);
    expect(shouldHideHunk(hunk(), { level: "needs-attention", score: "substantive", unhidden: false })).toBe(true);
    expect(shouldHideHunk(hunk(), { level: "needs-attention", score: "needs-attention", unhidden: false })).toBe(false);
    expect(shouldHideHunk(hunk(), { level: "needs-attention", unhidden: false })).toBe(false);
  });
  it("never hides one-line uninteresting changes", () => {
    const oneLine = hunk({ hiddenReason: "imports", added: 1, removed: 0 });
    expect(shouldHideHunk(oneLine, { level: "uninteresting", unhidden: false })).toBe(false);
  });
  it("never hides revealed hunks, but guide-cited hunks hide like any other (#325)", () => {
    expect(shouldHideHunk(hidden, { level: "needs-attention", score: "mechanical", unhidden: true })).toBe(false);
    expect(shouldHideHunk(hidden, { level: "needs-attention", score: "mechanical", unhidden: false })).toBe(true);
  });
  it("re-applies the level from scratch with no remembered overrides (#342)", () => {
    // A transient expand shows the hunk now ...
    expect(shouldHideHunk(hidden, { level: "substantive", score: "mechanical", unhidden: true })).toBe(false);
    // ... but the next level decision starts clean: the same hunk with
    // no transient expand hides again, and "all" shows everything.
    expect(shouldHideHunk(hidden, { level: "substantive", score: "mechanical", unhidden: false })).toBe(true);
    expect(shouldHideHunk(hidden, { level: "all", unhidden: false })).toBe(false);
    // Visibility is a pure function of the decision: repeated calls agree.
    expect(shouldHideHunk(hidden, { level: "uninteresting", unhidden: false })).toBe(
      shouldHideHunk(hidden, { level: "uninteresting", unhidden: false }),
    );
  });
});

describe("parseDiffRef", () => {
  it("accepts file-only, line and range forms", () => {
    expect(parseDiffRef("diff:conn")).toEqual({ fileKey: "conn", start: undefined, end: undefined });
    expect(parseDiffRef("diff:conn:82")).toEqual({ fileKey: "conn", start: 82, end: 82 });
    expect(parseDiffRef("diff:conn:99-118")).toEqual({ fileKey: "conn", start: 99, end: 118 });
    expect(parseDiffRef("diff:conn:99-118@bdcc1e493e")).toEqual({ fileKey: "conn", start: 99, end: 118 });
  });
  it("rejects other kinds and bad ranges", () => {
    expect(parseDiffRef("card:central")).toBeNull();
    expect(parseDiffRef("diff:")).toBeNull();
    expect(parseDiffRef("diff:conn:0")).toBeNull();
    expect(parseDiffRef("diff:conn:9-2")).toBeNull();
  });
});

describe("hiddenRunLabel (#342)", () => {
  it("labels single and grouped runs by range only", () => {
    const f = file("src/a.py", [hunk(), hunk(), hunk(), hunk()]);
    expect(hiddenRunLabel(f, [1])).toBe("Hunk 2");
    expect(hiddenRunLabel(f, [0, 1])).toBe("Hunks 1–2");
  });
  it("carries no size, no score words and no 'hidden'", () => {
    const f = file("src/a.py", [hunk(), hunk(), hunk()]);
    for (const label of [hiddenRunLabel(f, [0]), hiddenRunLabel(f, [0, 2])]) {
      expect(label).not.toMatch(/hidden/i);
      expect(label).not.toMatch(/[+-]\d/);
      expect(label).not.toMatch(/mechanical|routine|substantive|needs attention/i);
    }
  });
});

describe("hunkOverlaps", () => {
  const h = hunk({ newStart: 80, newEnd: 90 });
  it("matches touching ranges and rejects gaps", () => {
    expect(hunkOverlaps(h, 90, 95)).toBe(true);
    expect(hunkOverlaps(h, 70, 80)).toBe(true);
    expect(hunkOverlaps(h, 91, 95)).toBe(false);
    expect(hunkOverlaps(h, 70, 79)).toBe(false);
  });
});

describe("mock fixture", () => {
  // DISABLED(#119): asserts on the mock fixture itself, not product code; DiffView.test.tsx and e2e/diff.spec.ts read the same values through the UI.
  it.skip("carries the four prototype files with ingest-canonical keys and reasons", () => {
    expect(MOCK_FILES.map((f) => f.fileKey)).toEqual([
      "src-urllib3-connection.py",
      "test-test_connection.py",
      "test-with_dummyserver-test_socketlevel.py",
      "changelog-1362.bugfix.rst",
    ]);
    const byKey = Object.fromEntries(MOCK_FILES.map((f) => [f.fileKey, f]));
    const conn = byKey["src-urllib3-connection.py"];
    const tconn = byKey["test-test_connection.py"];
    const tsock = byKey["test-with_dummyserver-test_socketlevel.py"];
    const log = byKey["changelog-1362.bugfix.rst"];
    expect(conn.hunks).toHaveLength(2);
    expect(tconn.hunks).toHaveLength(3);
    expect(tsock.hunks).toHaveLength(2);
    expect(log.hunks).toHaveLength(1);
    expect(conn.hunks[0].hiddenReason).toBeUndefined();
    expect(tconn.hunks[0].hiddenReason).toBe("imports");
    expect(tconn.hunks[1].hiddenReason).toBe("imports");
    // Single added import row: never hidden (PRD §4.13 one-line rule).
    expect(tsock.hunks[0].hiddenReason).toBeUndefined();
    expect(log.hunks[0].hiddenReason).toBe("docs / config");
    expect(conn.hunks[0].newStart).toBe(77);
    expect(conn.hunks[0].newEnd).toBe(113);
    expect(conn.path).toBe("src/urllib3/connection.py");
    const hashes = MOCK_FILES.flatMap((f) => f.hunks.map((h) => h.contentHash));
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(hashes[0]).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("hashHunkLines (shared)", () => {
  it("is stable and ignores whitespace but not content", () => {
    const a = [{ kind: "add" as const, text: "foo  bar" }];
    const b = [{ kind: "add" as const, text: "foo bar" }];
    const c = [{ kind: "add" as const, text: "foo baz" }];
    expect(hashHunkLines(a)).toBe(hashHunkLines(b));
    expect(hashHunkLines(a)).not.toBe(hashHunkLines(c));
  });
});
