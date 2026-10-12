/**
 * Hunk-token plumbing tests (issue #23). The real Shiki tokenizer is
 * injected in `shiki.test.ts`; here a fake stands in so side-splitting,
 * alignment, caps and the colour→class map are tested without loading
 * grammars.
 */
import { describe, expect, it } from "vitest";
import type { Hunk, HunkLine } from "@unvibe/shared";
import {
  cacheKey,
  classForColor,
  MAX_LINE_CHARS,
  splitHunkSides,
  toSegments,
  tokenizeHunk,
  type RawToken,
} from "./tokenize.js";

function line(kind: "add" | "del" | "ctx", text: string, n?: number): HunkLine {
  return {
    kind,
    oldLine: kind === "add" ? undefined : n,
    newLine: kind === "del" ? undefined : n,
    text,
  };
}

function hunk(lines: HunkLine[]): Hunk {
  return {
    contentHash: "abc123",
    header: "@@ -1,2 +1,2 @@",
    newStart: 1,
    newEnd: 2,
    oldStart: 1,
    oldEnd: 2,
    added: 1,
    removed: 1,
    lines,
  };
}

/** Fake tokenizer: one token per line, echoing the text. */
async function fake(texts: string[]): Promise<RawToken[][]> {
  return texts.map((t) => [{ content: t, color: "var(--shk-foreground)" }]);
}

describe("splitHunkSides", () => {
  it("splits old (del+ctx) and new (add+ctx) sequences in hunk order", () => {
    const lines = [
      line("ctx", "one", 1),
      line("del", "two", undefined),
      line("add", "TWO", 2),
      line("ctx", "three", 3),
    ];
    expect(splitHunkSides(lines)).toEqual({
      oldTexts: ["one", "two", "three"],
      newTexts: ["one", "TWO", "three"],
    });
  });
});

describe("tokenizeHunk", () => {
  it("aligns token rows back to hunk lines per side", async () => {
    const h = hunk([line("ctx", "one", 1), line("del", "two"), line("add", "TWO", 2)]);
    const out = await tokenizeHunk(h, fake);
    expect(out?.old.map((r) => r?.[0]?.text ?? null)).toEqual(["one", "two", null]);
    expect(out?.new.map((r) => r?.[0]?.text ?? null)).toEqual(["one", null, "TWO"]);
  });

  it("returns null when the tokenizer row count mismatches", async () => {
    const h = hunk([line("ctx", "one", 1)]);
    const out = await tokenizeHunk(h, async () => []);
    expect(out).toBeNull();
  });

  it("renders over-long lines plain (null) instead of failing", async () => {
    const big = "x".repeat(MAX_LINE_CHARS + 1);
    const h = hunk([line("add", big, 1), line("add", "small", 2)]);
    const out = await tokenizeHunk(h, fake);
    expect(out?.new[0]).toBeNull();
    expect(out?.new[1]?.[0]?.text).toBe("small");
  });

  it("skips absurd sides entirely", async () => {
    let called = false;
    const h = hunk([line("add", "x".repeat(100_001), 1)]);
    const out = await tokenizeHunk(h, async (t) => {
      called = true;
      return fake(t);
    });
    expect(out).toBeNull();
    expect(called).toBe(false);
  });
});

describe("classForColor", () => {
  it("maps css-variable colours to shk-* classes", () => {
    expect(classForColor("var(--shk-token-keyword)")).toBe("shk-kw");
    expect(classForColor("var(--shk-token-string)")).toBe("shk-str");
    expect(classForColor("var(--shk-token-string-expression)")).toBe("shk-str");
    expect(classForColor("var(--shk-token-comment)")).toBe("shk-com");
    expect(classForColor("var(--shk-token-function)")).toBe("shk-fn");
    expect(classForColor("var(--shk-token-constant)")).toBe("shk-const");
    expect(classForColor("var(--shk-token-parameter)")).toBe("shk-param");
  });

  it("leaves foreground/punctuation/unknown colours plain (no span)", () => {
    expect(classForColor("var(--shk-foreground)")).toBeNull();
    expect(classForColor("var(--shk-token-punctuation)")).toBeNull();
    expect(classForColor("#D73A49")).toBeNull();
    expect(classForColor(undefined)).toBeNull();
  });
});

describe("toSegments", () => {
  it("keeps plain runs spanless and flags bold/italic", () => {
    const segs = toSegments([
      { content: "def", color: "var(--shk-token-keyword)" },
      { content: " ", color: "var(--shk-foreground)" },
      { content: "x", color: "var(--shk-foreground)", fontStyle: 3 },
    ]);
    expect(segs).toEqual([
      { text: "def", cls: "shk-kw", bold: false, italic: false },
      { text: " ", cls: null, bold: false, italic: false },
      { text: "x", cls: null, bold: true, italic: true },
    ]);
  });

  it("drops empty tokens", () => {
    expect(toSegments([{ content: "" }, { content: "a" }])).toHaveLength(1);
  });
});

describe("cacheKey", () => {
  it("keys on language + content hash", () => {
    expect(cacheKey("abc", "python")).toBe("python:abc");
    expect(cacheKey("abc", "python")).not.toBe(cacheKey("abc", "typescript"));
  });
});
