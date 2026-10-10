/**
 * Shared diff pipeline: sync SHA-256 matches `node:crypto`, and the
 * parse → classify → hash → hide assembly behaves (service ingest and the
 * web mock both build through it).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildReviewFiles,
  classifyFile,
  fileKeyForPath,
  hashHunkLines,
  hunkHashInput,
  parseUnifiedDiff,
  sha256HexUtf8,
  uninterestingReason,
} from "../src/diff.js";

describe("sha256HexUtf8", () => {
  const vectors = [
    "",
    "abc",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", // 56 bytes: padding edge
    "a".repeat(64), // exactly one block after padding rules
    "header_items = _normalize_header_values(httplib_response.msg)",
    "Set-Cookie: a=1 \r\n two — ünïcödé ✓",
  ];
  for (const v of vectors) {
    it(`matches node:crypto for ${JSON.stringify(v.slice(0, 24))}`, () => {
      expect(sha256HexUtf8(v)).toBe(createHash("sha256").update(v, "utf8").digest("hex"));
    });
  }
});

describe("hashHunkLines", () => {
  const lines = [
    { kind: "ctx" as const, oldLine: 1, newLine: 1, text: "a" },
    { kind: "del" as const, oldLine: 2, text: "b" },
    { kind: "add" as const, newLine: 2, text: "c" },
  ];
  it("equals node:crypto over the canonical input (service parity)", () => {
    const expected = createHash("sha256").update(hunkHashInput(lines), "utf8").digest("hex").slice(0, 16);
    expect(hashHunkLines(lines)).toBe(expected);
  });
});

describe("pipeline", () => {
  const diff = [
    "diff --git a/src/a.py b/src/a.py",
    "index 1111111..2222222 100644",
    "--- a/src/a.py",
    "+++ b/src/a.py",
    "@@ -1,3 +1,4 @@ def f",
    " ctx",
    "-old",
    "+new1",
    "+new2",
    " end",
    "diff --git a/one.py b/one.py",
    "new file mode 100644",
    "index 0000000..3333333",
    "--- /dev/null",
    "+++ b/one.py",
    "@@ -0,0 +1 @@",
    "+only",
    "",
  ].join("\n");

  it("assembles ReviewFiles like ingest", () => {
    const files = buildReviewFiles(parseUnifiedDiff(diff));
    expect(files.map((f) => f.fileKey)).toEqual(["src-a.py", "one.py"]);
    expect(files[0].category).toBe("source");
    expect(files[0].hunks[0].added).toBe(2);
    expect(files[0].hunks[0].lines).toHaveLength(5);
    expect(files[0].hunks[0].contentHash).toMatch(/^[0-9a-f]{16}$/);
    expect(files[1].isNew).toBe(true);
    // Single added row: never hidden.
    expect(files[1].hunks[0].hiddenReason).toBeUndefined();
  });

  it("classifies and keys paths", () => {
    expect(classifyFile("test/x_test.py")).toBe("tests");
    expect(classifyFile("changelog/1.bugfix.rst")).toBe("docs");
    expect(classifyFile("a:b@c/d")).toBe("source");
    expect(fileKeyForPath("a:b@c/d")).toBe("a-b-c-d");
  });

  it("never hides one-line changes", () => {
    expect(
      uninterestingReason({ lines: [{ kind: "add", text: "import os" }] }, { category: "source" }),
    ).toBeUndefined();
  });
});
