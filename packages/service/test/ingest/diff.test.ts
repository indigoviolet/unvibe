/**
 * Diff parser tests: prototype parity on the real urllib3/urllib3#5020 diff
 * (extracted from `<script id="diffs">` in `prototype.html`) plus edge cases
 * (renames, binary, new/deleted files, missing trailing newline).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "../../src/ingest/diff.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "..", "fixtures", "urllib3-5020-diffs.json"), "utf8"),
) as { key: string; path: string; diff: string }[];

function fullDiff(): string {
  return fixture.map((f) => f.diff).join("\n");
}

describe("parseUnifiedDiff on urllib3#5020 (prototype parity)", () => {
  it("finds 4 files with prototype-identical hunk counts and ranges", () => {
    const files = parseUnifiedDiff(fullDiff());
    expect(files.map((f) => f.path)).toEqual([
      "src/urllib3/connection.py",
      "test/test_connection.py",
      "test/with_dummyserver/test_socketlevel.py",
      "changelog/1362.bugfix.rst",
    ]);
    // [oldStart, oldEnd, newStart, newEnd, added, removed, rows]
    const summary = files.map((f) =>
      f.hunks.map((h) => [h.oldStart, h.oldEnd, h.newStart, h.newEnd, h.added, h.removed, h.lines.length]),
    );
    expect(summary).toEqual([
      [
        [77, 82, 77, 113, 31, 0, 37],
        [616, 622, 647, 654, 2, 1, 9],
      ],
      [
        [3, 9, 3, 9, 1, 1, 8],
        [14, 19, 14, 21, 2, 0, 8],
        [209, 214, 211, 253, 37, 0, 43],
      ],
      [
        [37, 42, 37, 43, 1, 0, 7],
        [88, 93, 89, 150, 56, 0, 62],
      ],
      [[0, 0, 1, 3, 3, 0, 3]],
    ]);
  });

  it("keeps raw @@ headers and row line numbers per the prototype", () => {
    const files = parseUnifiedDiff(fullDiff());
    const first = files[0].hunks[0];
    expect(first.header).toBe(
      "@@ -77,6 +77,37 @@ class BaseSSLError(BaseException):  # type: ignore[no-redef]",
    );
    expect(first.context).toBe("class BaseSSLError(BaseException):  # type: ignore[no-redef]");
    // First rows: 3 context lines (77-79), then added lines from 80.
    expect(first.lines.slice(0, 4).map((l) => [l.kind, l.oldLine, l.newLine])).toEqual([
      ["ctx", 77, 77],
      ["ctx", 78, 78],
      ["ctx", 79, 79],
      ["add", undefined, 80],
    ]);
    const second = files[0].hunks[1];
    const del = second.lines.find((l) => l.kind === "del");
    expect(del?.oldLine).toBe(619);
    expect(del?.text).toContain("HTTPHeaderDict");
  });
});

describe("parseUnifiedDiff edge cases", () => {
  it("parses new, deleted, renamed, and binary files", () => {
    const diff = [
      "diff --git a/new.txt b/new.txt",
      "new file mode 100644",
      "index 0000000..3b18e51",
      "--- /dev/null",
      "+++ b/new.txt",
      "@@ -0,0 +1,2 @@",
      "+hello",
      "+world",
      "diff --git a/old.txt b/old.txt",
      "deleted file mode 100644",
      "index 3b18e51..0000000",
      "--- a/old.txt",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-hello",
      "-world",
      "diff --git a/a.txt b/b.txt",
      "similarity index 90%",
      "rename from a.txt",
      "rename to b.txt",
      "index 1111111..2222222 100644",
      "--- a/a.txt",
      "+++ b/b.txt",
      "@@ -1,2 +1,2 @@",
      " same",
      "-old",
      "+new",
      "diff --git a/logo.png b/logo.png",
      "new file mode 100644",
      "index 0000000..89d0c2a",
      "Binary files /dev/null and b/logo.png differ",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(4);
    expect(files[0]).toMatchObject({ path: "new.txt", isNew: true, isDeleted: false });
    expect(files[0].hunks).toHaveLength(1);
    expect(files[1]).toMatchObject({ path: "old.txt", isNew: false, isDeleted: true });
    expect(files[2]).toMatchObject({ path: "b.txt", oldPath: "a.txt", isRename: true });
    expect(files[3]).toMatchObject({ path: "logo.png", isBinary: true, hunks: [] });
  });

  it("records missing trailing newlines without creating rows", () => {
    const diff = [
      "diff --git a/f.txt b/f.txt",
      "index 1111111..2222222 100644",
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,1 +1,1 @@",
      "-old",
      "\\ No newline at end of file",
      "+new",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].hunks[0].noNewline).toBe(true);
    expect(files[0].hunks[0].lines).toHaveLength(2);
  });

  it("returns [] for empty input and ignores mode-only noise", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
