/**
 * versions/anchors: remapping fixtures.
 *
 * - Moved: exact hash hit shifts with the hunk.
 * - Edited nearby: quote + context still found → moved (unchanged hunk).
 * - Deleted: quote gone → outdated.
 * - Duplicated text: ambiguous tie → outdated; nearest-to-expected wins.
 * - Changed hunk → outdated with a successor link even when found.
 * - Rename → moved to the new fileKey.
 */
import { describe, expect, it } from "vitest";
import type { Anchor } from "@unvibe/shared";
import { compareHunks } from "../src/versions/compare.js";
import { remapAnchor, searchQuote } from "../src/versions/anchors.js";
import type { ReviewFile } from "@unvibe/shared";

function hunk(
  hash: string,
  newStart: number,
  lines: { kind: "add" | "del" | "ctx"; text: string }[],
): ReviewFile["hunks"][number] {
  let ns = newStart;
  let os = newStart;
  const rows = lines.map((l) => {
    if (l.kind === "add") return { kind: l.kind, newLine: ns++, text: l.text };
    if (l.kind === "del") return { kind: l.kind, oldLine: os++, text: l.text };
    const row = { kind: l.kind, oldLine: os, newLine: ns, text: l.text };
    os += 1;
    ns += 1;
    return row;
  });
  return {
    contentHash: hash,
    header: "@@",
    newStart,
    newEnd: ns - 1,
    oldStart: newStart,
    oldEnd: os - 1,
    added: 0,
    removed: 0,
    lines: rows as ReviewFile["hunks"][number]["lines"],
  };
}

function file(key: string, p: string, hunks: ReviewFile["hunks"][number][], extra?: Partial<ReviewFile>): ReviewFile {
  return { fileKey: key, path: p, category: "source", hunks, ...extra };
}

function diffAnchor(fileKey: string, line: number, quote: string, hunkHash?: string): Anchor {
  return {
    host: { kind: "diff-line", fileKey, line },
    quotedText: quote,
    prefix: "",
    suffix: "",
    position: line,
    version: 1,
    ...(hunkHash ? { hunkHash } : {}),
  };
}

describe("searchQuote", () => {
  it("finds a moved quote with context", () => {
    const lines = ["x = 1", "y = 2", "z = 3", "w = 4"];
    const hit = searchQuote("y = 2", "x = 1", "z = 3", lines, 2);
    expect(hit?.startLine).toBe(2);
    expect(hit!.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns null for duplicated text with no expected line to break the tie", () => {
    const lines = ["same", "other", "same"];
    expect(searchQuote("same", "", "", lines)).toBeNull();
  });

  it("breaks ties toward the expected line", () => {
    const lines = ["same", "other", "same"];
    expect(searchQuote("same", "", "", lines, 3)?.startLine).toBe(3);
    expect(searchQuote("same", "", "", lines, 1)?.startLine).toBe(1);
  });
});

describe("remapAnchor", () => {
  it("exact hash hit moves with the line shift", () => {
    const oldF = [file("a-py", "a.py", [hunk("h1", 10, [{ kind: "add", text: "y = 2" }])])];
    const newF = [file("a-py", "a.py", [hunk("h1", 15, [{ kind: "add", text: "y = 2" }])])];
    newF[0].hunks[0].newStart = 15;
    newF[0].hunks[0].newEnd = 15;
    const cmp = compareHunks(oldF, newF);
    const out = remapAnchor(diffAnchor("a-py", 10, "y = 2", "h1"), {
      comparison: cmp,
      newContents: new Map([["a-py", Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)]]),
      newVersion: 2,
    });
    // Hash hit wins without needing file text.
    expect(out.remap).toMatchObject({ status: "moved", newLine: 15, lineShift: 5 });
    expect(out.newAnchor?.host).toMatchObject({ kind: "diff-line", fileKey: "a-py", line: 15 });
    expect(out.newAnchor?.version).toBe(2);
  });

  it("edited nearby but same hunk content: quote search moves the anchor", () => {
    const h = hunk("h1", 10, [{ kind: "ctx", text: "x = 1" }, { kind: "add", text: "y = 2" }]);
    const oldF = [file("a-py", "a.py", [h])];
    const newF = [file("a-py", "a.py", [h])];
    const cmp = compareHunks(oldF, newF);
    // No hunkHash on the anchor → quote search path.
    const lines = ["head", "x = 1", "y = 2", "tail"];
    const out = remapAnchor(
      { host: { kind: "diff-line", fileKey: "a-py", line: 3 }, quotedText: "y = 2", prefix: "x = 1", suffix: "tail", position: 3, version: 1 },
      { comparison: cmp, newContents: { "a-py": lines }, newVersion: 2 },
    );
    expect(out.remap.status).toBe("moved");
    if (out.remap.status === "moved") expect(out.remap.newLine).toBe(3);
  });

  it("deleted quote → outdated", () => {
    const oldF = [file("a-py", "a.py", [hunk("h1", 1, [{ kind: "add", text: "gone = 1" }])])];
    const newF = [file("a-py", "a.py", [hunk("h2", 1, [{ kind: "add", text: "other = 2" }])])];
    const cmp = compareHunks(oldF, newF);
    const out = remapAnchor(diffAnchor("a-py", 1, "gone = 1", "h1"), {
      comparison: cmp,
      newContents: new Map([["a-py", ["other = 2"]]]),
      newVersion: 2,
    });
    expect(out.remap.status).toBe("outdated");
  });

  it("changed hunk with the quote still present → outdated with successor", () => {
    const oldF = [file("a-py", "a.py", [hunk("h1", 1, [{ kind: "add", text: "y = 2" }, { kind: "add", text: "z = 3" }])])];
    const newF = [file("a-py", "a.py", [hunk("h1b", 1, [{ kind: "add", text: "y = 2" }, { kind: "add", text: "z = 99" }])])];
    const cmp = compareHunks(oldF, newF);
    expect(cmp.changed).toHaveLength(1);
    const out = remapAnchor(diffAnchor("a-py", 1, "y = 2", "h1"), {
      comparison: cmp,
      newContents: new Map([["a-py", ["y = 2", "z = 99"]]]),
      newVersion: 2,
    });
    expect(out.remap).toMatchObject({ status: "outdated" });
    expect(out.successor?.host).toMatchObject({ line: 1 });
  });

  it("rename moves the anchor to the new fileKey", () => {
    const oldF = [file("old-py", "old.py", [hunk("h1", 5, [{ kind: "add", text: "y = 2" }])])];
    const newF = [file("new-py", "new.py", [hunk("h1", 5, [{ kind: "add", text: "y = 2" }])], { oldPath: "old.py", isRename: true })];
    const cmp = compareHunks(oldF, newF);
    const out = remapAnchor(diffAnchor("old-py", 5, "y = 2", "h1"), {
      comparison: cmp,
      newContents: new Map([["new-py", ["a", "b", "c", "d", "y = 2"]]]),
      newVersion: 2,
    });
    expect(out.remap.status).toBe("moved");
    expect(out.newAnchor?.host).toMatchObject({ kind: "diff-line", fileKey: "new-py" });
  });

  it("non-diff anchors stay moved", () => {
    const cmp = compareHunks([], []);
    const anchor: Anchor = { host: { kind: "block", blockId: "b1" }, quotedText: "q", prefix: "", suffix: "", position: 7, version: 1 };
    expect(remapAnchor(anchor, { comparison: cmp, newContents: new Map(), newVersion: 2 }).remap.status).toBe("moved");
  });
});
