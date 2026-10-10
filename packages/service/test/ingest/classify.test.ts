/**
 * File classification (language-agnostic) + rule-based uninteresting
 * pre-classification + stable file keys.
 */
import { describe, expect, it } from "vitest";
import { classifyFile, fileKeyForPath } from "../../src/ingest/classify.js";
import { uninterestingReason } from "../../src/ingest/uninteresting.js";
import type { ParsedHunk } from "../../src/ingest/diff.js";

function hunk(texts: { kind: "add" | "del" | "ctx"; text: string }[]): ParsedHunk {
  return {
    header: "@@ -1 +1 @@",
    oldStart: 1,
    oldEnd: 1,
    newStart: 1,
    newEnd: 1,
    added: texts.filter((t) => t.kind === "add").length,
    removed: texts.filter((t) => t.kind === "del").length,
    lines: texts.map((t) => ({ ...t })),
    noNewline: false,
  };
}

describe("classifyFile", () => {
  it.each([
    ["src/app.ts", "source"],
    ["src/main.py", "source"],
    ["lib/foo.go", "source"],
    ["test/test_connection.py", "tests"],
    ["tests/unit/spec.ts", "tests"],
    ["__tests__/app.test.tsx", "tests"],
    ["src/foo.spec.js", "tests"],
    ["e2e/login.spec.ts", "tests"],
    ["README.md", "docs"],
    ["changelog/1362.bugfix.rst", "docs"],
    ["docs/guide.md", "docs"],
    ["package.json", "config"],
    ["tsconfig.json", "config"],
    ["pyproject.toml", "config"],
    [".github/workflows/ci.yml", "config"],
    ["Dockerfile", "config"],
    ["src/app.min.js", "generated"],
    ["dist/bundle.js", "generated"],
    ["src/logo.map", "generated"],
  ])("%s → %s", (path, expected) => {
    expect(classifyFile(path)).toBe(expected);
  });

  it("honours linguist-generated", () => {
    expect(classifyFile("src/big.ts", { linguistGenerated: new Set(["src/big.ts"]) })).toBe(
      "generated",
    );
  });
});

describe("fileKeyForPath", () => {
  it("is stable, unique per path, and ID-safe", () => {
    const a = fileKeyForPath("src/urllib3/connection.py");
    expect(a).toBe(fileKeyForPath("src/urllib3/connection.py"));
    expect(a).not.toContain("/");
    expect(a).not.toContain(":");
    expect(a).not.toContain("@");
    expect(fileKeyForPath("test/test_connection.py")).not.toBe(a);
  });
});

describe("uninterestingReason", () => {
  const imports = hunk([
    { kind: "add", text: "from http.client import HTTPMessage" },
    { kind: "add", text: "from .x import (" },
    { kind: "add", text: "    Alpha," },
    { kind: "add", text: "    Beta," },
    { kind: "add", text: ")" },
  ]);
  const code = hunk([
    { kind: "add", text: "import os" },
    { kind: "add", text: "x = compute(1)" },
  ]);
  const singleImport = hunk([{ kind: "add", text: "import os" }]);

  it("flags import-only hunks", () => {
    expect(uninterestingReason(imports, { category: "source" })).toBe("imports");
  });

  it("leaves real code alone", () => {
    expect(uninterestingReason(code, { category: "source" })).toBeUndefined();
  });

  it("never hides one-line changes", () => {
    expect(uninterestingReason(singleImport, { category: "source" })).toBeUndefined();
  });

  it("flags generated and docs/config hunks", () => {
    expect(uninterestingReason(code, { category: "generated" })).toBe("generated");
    expect(uninterestingReason(code, { category: "docs" })).toBe("docs / config");
    expect(uninterestingReason(code, { category: "config" })).toBe("docs / config");
  });

  it("never hides one-line changes even in generated files", () => {
    expect(uninterestingReason(singleImport, { category: "generated" })).toBeUndefined();
  });
});
