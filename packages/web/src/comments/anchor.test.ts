import { describe, expect, test } from "vitest";
import { locateQuoteSegments, splitOnQuote } from "./anchor.js";

describe("locateQuoteSegments", () => {
  test("finds a quote inside one node", () => {
    expect(locateQuoteSegments(["hello world"], "world")).toEqual([
      { node: 0, start: 6, end: 11 },
    ]);
  });

  test("returns null when the anchor text is gone (marker fallback)", () => {
    expect(locateQuoteSegments(["hello world"], "missing")).toBeNull();
    expect(locateQuoteSegments(["hello"], "")).toBeNull();
  });

  test("spans inline code across text nodes", () => {
    // `before <code>foo</code> bar after` -> texts ["before ", "foo", " bar after"]
    const texts = ["before ", "foo", " bar after"];
    expect(locateQuoteSegments(texts, "foo bar")).toEqual([
      { node: 1, start: 0, end: 3 },
      { node: 2, start: 0, end: 4 },
    ]);
  });

  test("first occurrence wins when several threads share a block", () => {
    const segments = locateQuoteSegments(["fast path and fast path"], "fast path");
    expect(segments?.[0]).toEqual({ node: 0, start: 0, end: 9 });
  });
});

describe("splitOnQuote", () => {
  test("splits around the quote", () => {
    expect(splitOnQuote("a fast path b", "fast path")).toEqual({
      before: "a ",
      match: "fast path",
      after: " b",
    });
  });

  test("null when absent", () => {
    expect(splitOnQuote("abc", "z")).toBeNull();
  });
});
