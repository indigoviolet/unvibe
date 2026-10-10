import { describe, expect, test } from "vitest";
import {
  normalizeQuote,
  parseLineElementId,
  snapWordOffsets,
  validSelectionQuote,
} from "./selection.js";

describe("snapWordOffsets", () => {
  test("trims leading and trailing spaces", () => {
    expect(snapWordOffsets("  hello world  ", 0, 15)).toEqual([2, 13]);
  });

  test("grows a partial word at the start to its boundary", () => {
    const text = "hello world";
    // Selection starts inside "hello" (offset 2) and ends at its end.
    expect(snapWordOffsets(text, 2, 5)).toEqual([0, 5]);
  });

  test("grows a partial word at the end to its boundary", () => {
    const text = "hello world";
    // "hello wo" -> "hello world".
    expect(snapWordOffsets(text, 0, 8)).toEqual([0, 11]);
  });

  test("a boundary start does not grow into the previous word", () => {
    const text = "hello world";
    expect(snapWordOffsets(text, 6, 11)).toEqual([6, 11]);
  });

  test("apostrophes count as word characters", () => {
    const text = "don't stop";
    expect(snapWordOffsets(text, 1, 4)).toEqual([0, 5]);
  });

  test("collapses to empty when only whitespace is selected", () => {
    const [so, eo] = snapWordOffsets("   ", 0, 3);
    expect(eo).toBeLessThanOrEqual(so);
  });
});

describe("normalizeQuote / validSelectionQuote", () => {
  test("trims and collapses whitespace", () => {
    expect(normalizeQuote("  foo\n  bar\tbaz ")).toBe("foo bar baz");
  });

  test("length bounds match the prototype (2..300)", () => {
    expect(validSelectionQuote("x")).toBe(false);
    expect(validSelectionQuote("xy")).toBe(true);
    expect(validSelectionQuote("x".repeat(300))).toBe(true);
    expect(validSelectionQuote("x".repeat(301))).toBe(false);
  });
});

describe("parseLineElementId", () => {
  test("parses canonical keys with dashes and dots", () => {
    expect(parseLineElementId("L-src-urllib3-connection.py-91")).toEqual({
      fileKey: "src-urllib3-connection.py",
      line: 91,
    });
  });

  test("rejects non-line ids", () => {
    expect(parseLineElementId("F-conn")).toBeNull();
    expect(parseLineElementId("L-conn-0")).toBeNull();
    expect(parseLineElementId("L-conn-x")).toBeNull();
  });
});
