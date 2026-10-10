/**
 * versions/compare: pure hunk-by-hunk comparison fixtures.
 *
 * - Rebase without conflicts → all unchanged (hash equality).
 * - Amend changing one hunk → one changed pair, rest unchanged.
 * - New file + shifted lines → unchanged with line shifts, added hunks.
 * - Rename → unchanged with renamed=true + renames entry.
 * - Dropped commit → removed hunks.
 */
import { describe, expect, it } from "vitest";
import type { ReviewFile } from "@unvibe/shared";
import { compareHunks, hunkSimilarity } from "../src/versions/compare.js";

function hunk(
  hash: string,
  newStart: number,
  lines: { kind: "add" | "del" | "ctx"; text: string }[],
  newEnd?: number,
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
    header: `@@ -${newStart} +${newStart} @@`,
    newStart,
    newEnd: newEnd ?? ns - 1,
    oldStart: newStart,
    oldEnd: os - 1,
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "del").length,
    lines: rows as ReviewFile["hunks"][number]["lines"],
  };
}

function file(fileKey: string, filePath: string, hunks: ReviewFile["hunks"][number][], extra?: Partial<ReviewFile>): ReviewFile {
  return { fileKey, path: filePath, category: "source", hunks, ...extra };
}

describe("compareHunks", () => {
  it("rebase without conflicts: identical diffs compare as all unchanged", () => {
    const oldF = [file("a-py", "a.py", [hunk("aaa", 10, [{ kind: "ctx", text: "x = 1" }, { kind: "add", text: "y = 2" }])])];
    const newF = [file("a-py", "a.py", [hunk("aaa", 10, [{ kind: "ctx", text: "x = 1" }, { kind: "add", text: "y = 2" }])])];
    const c = compareHunks(oldF, newF);
    expect(c.unchanged).toHaveLength(1);
    expect(c.changed).toHaveLength(0);
    expect(c.removed).toHaveLength(0);
    expect(c.added).toHaveLength(0);
    expect(c.unchanged[0].lineShift).toBe(0);
  });

  it("whitespace-only changes still hash equal (caller hashes), similarity is 1", () => {
    const a = hunk("x", 1, [{ kind: "add", text: "y=2" }]);
    const b = hunk("y", 1, [{ kind: "add", text: "y = 2" }]);
    expect(hunkSimilarity(a, b)).toBe(1);
  });

  it("amend changing one hunk: that pair is changed, the other unchanged", () => {
    const oldF = [
      file("a-py", "a.py", [
        hunk("h1", 10, [{ kind: "ctx", text: "x = 1" }, { kind: "add", text: "y = 2" }]),
        hunk("h2", 30, [{ kind: "ctx", text: "z = 0" }, { kind: "add", text: "w = 4" }]),
      ]),
    ];
    const newF = [
      file("a-py", "a.py", [
        hunk("h1b", 10, [{ kind: "ctx", text: "x = 1" }, { kind: "add", text: "y = 3" }]),
        hunk("h2", 30, [{ kind: "ctx", text: "z = 0" }, { kind: "add", text: "w = 4" }]),
      ]),
    ];
    const c = compareHunks(oldF, newF);
    expect(c.unchanged.map((u) => u.oldId)).toEqual(["h:a-py:h2"]);
    expect(c.changed).toHaveLength(1);
    expect(c.changed[0].oldId).toBe("h:a-py:h1");
    expect(c.changed[0].newId).toBe("h:a-py:h1b");
    expect(c.changed[0].similarity).toBeGreaterThan(0.3);
  });

  it("new commit shifting lines: unchanged with the right offset, new file added", () => {
    const oldF = [file("a-py", "a.py", [hunk("h1", 10, [{ kind: "add", text: "y = 2" }])])];
    const newF = [
      file("a-py", "a.py", [hunk("h1", 15, [{ kind: "add", text: "y = 2" }], 15)]),
      file("b-py", "b.py", [hunk("hb", 1, [{ kind: "add", text: "new = True" }])]),
    ];
    // Fix the shifted hunk's range explicitly.
    newF[0].hunks[0].newStart = 15;
    newF[0].hunks[0].newEnd = 15;
    const c = compareHunks(oldF, newF);
    expect(c.unchanged).toHaveLength(1);
    expect(c.unchanged[0].lineShift).toBe(5);
    expect(c.added.map((a) => a.id)).toEqual(["h:b-py:hb"]);
    expect(c.removed).toHaveLength(0);
  });

  it("rename: same hashes compare unchanged with renamed flag", () => {
    const oldF = [file("old-py", "old.py", [hunk("h1", 5, [{ kind: "add", text: "y = 2" }])])];
    const newF = [
      file("new-py", "new.py", [hunk("h1", 5, [{ kind: "add", text: "y = 2" }])], { oldPath: "old.py", isRename: true }),
    ];
    const c = compareHunks(oldF, newF);
    expect(c.renames).toEqual([{ oldPath: "old.py", newPath: "new.py", fileKey: "new-py" }]);
    expect(c.unchanged).toHaveLength(1);
    expect(c.unchanged[0].renamed).toBe(true);
    expect(c.unchanged[0].oldId).toBe("h:old-py:h1");
    expect(c.unchanged[0].newId).toBe("h:new-py:h1");
  });

  it("dropped commit: its hunks are removed, survivors unchanged", () => {
    const oldF = [
      file("a-py", "a.py", [
        hunk("h1", 10, [{ kind: "add", text: "y = 2" }]),
        hunk("h2", 20, [{ kind: "add", text: "z = 3" }]),
      ]),
    ];
    const newF = [file("a-py", "a.py", [hunk("h1", 10, [{ kind: "add", text: "y = 2" }])])];
    const c = compareHunks(oldF, newF);
    expect(c.unchanged.map((u) => u.oldId)).toEqual(["h:a-py:h1"]);
    expect(c.removed.map((r) => r.id)).toEqual(["h:a-py:h2"]);
    expect(c.added).toHaveLength(0);
  });

  it("duplicate hashes disambiguate by file", () => {
    const dup = [{ kind: "add", text: "same" } as const];
    const oldF = [file("a-py", "a.py", [hunk("dup", 1, dup)]), file("b-py", "b.py", [hunk("dup", 1, dup)])];
    const newF = [file("a-py", "a.py", [hunk("dup", 1, dup)]), file("b-py", "b.py", [hunk("dup", 1, dup)])];
    const c = compareHunks(oldF, newF);
    expect(c.unchanged).toHaveLength(2);
    for (const u of c.unchanged) expect(u.oldHunk.fileKey).toBe(u.newHunk.fileKey);
  });
});
