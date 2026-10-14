/**
 * Paragraph-by-paragraph streaming splitter (issue #126, experiment):
 * completed paragraphs only, never half sentences; fences, directives
 * and the trailing JSON block stay held back.
 */
import { describe, expect, test } from "vitest";
import { splitStreamText } from "../src/content/stream.js";

describe("splitStreamText", () => {
  test("empty and single incomplete paragraph stay held", () => {
    expect(splitStreamText("")).toEqual({ completed: [], rest: "" });
    expect(splitStreamText("half a sent")).toEqual({ completed: [], rest: "half a sent" });
  });

  test("a paragraph completes at the blank line after it", () => {
    expect(splitStreamText("First para.\n\nSecond, still")).toEqual({
      completed: ["First para."],
      rest: "Second, still",
    });
  });

  test("multiple completed paragraphs accumulate in order", () => {
    expect(splitStreamText("One.\n\nTwo.\n\nThree..")).toEqual({
      completed: ["One.", "Two."],
      rest: "Three..",
    });
  });

  test("multi-line lists hold until their blank line", () => {
    expect(splitStreamText("- a\n- b")).toEqual({ completed: [], rest: "- a\n- b" });
    expect(splitStreamText("- a\n- b\n\nnext")).toEqual({ completed: ["- a\n- b"], rest: "next" });
  });

  test("an unclosed fence holds everything from its opener", () => {
    expect(splitStreamText("Text.\n\n```js\nconst a = 1;")).toEqual({
      completed: ["Text."],
      rest: "```js\nconst a = 1;",
    });
  });

  test("a closed fence completes at its closing line", () => {
    expect(splitStreamText("Text.\n\n```js\nconst a = 1;\n```\n\nMore")).toEqual({
      completed: ["Text.", "```js\nconst a = 1;\n```"],
      rest: "More",
    });
  });

  test("blank lines inside fences never cut", () => {
    expect(splitStreamText("```js\nline one\n\nline two\n```\n\nAfter")).toEqual({
      completed: ["```js\nline one\n\nline two\n```"],
      rest: "After",
    });
  });

  test("a directive block completes at its close", () => {
    expect(splitStreamText("::: simple\nShorter form.\n:::\n\nNext")).toEqual({
      completed: ["::: simple\nShorter form.\n:::"],
      rest: "Next",
    });
  });

  test("an unclosed directive holds", () => {
    expect(splitStreamText("Done.\n\n::: simple\nShorter")).toEqual({
      completed: ["Done."],
      rest: "::: simple\nShorter",
    });
  });

  test("a trailing json fence is never shown", () => {
    const buf =
      "Answer para.\n\n```json\n{\"title\": \"T\", \"anchor\": {}}\n```\n";
    expect(splitStreamText(buf)).toEqual({
      completed: ["Answer para."],
      rest: "```json\n{\"title\": \"T\", \"anchor\": {}}\n```\n",
    });
  });

  test("an unclosed json fence holds from its opener", () => {
    expect(splitStreamText("Answer para.\n\n```json\n{\"title\": \"T\"")).toEqual({
      completed: ["Answer para."],
      rest: "```json\n{\"title\": \"T\"",
    });
  });

  test("splitting is monotone: growth only moves rest to completed", () => {
    const a = splitStreamText("First para.\n\nSecond, st");
    const b = splitStreamText("First para.\n\nSecond, still going\n\nThird");
    expect(a).toEqual({ completed: ["First para."], rest: "Second, st" });
    expect(b.completed[0]).toBe("First para.");
    expect(b).toEqual({ completed: ["First para.", "Second, still going"], rest: "Third" });
  });

  test("a realistic answer streams paragraph by paragraph", () => {
    const full =
      "Requests builds its cookie jar from `response._original_response.msg`. [[diff:tsock:139-146]]\n" +
      "\n" +
      "That's why the PR rewrites the original message in place instead of only cleaning the dict it builds.\n" +
      "\n" +
      "```json\n{\"title\": \"T\"}\n```\n";
    // Mid-stream: first paragraph out, second held, trailer held.
    const mid = splitStreamText(full.slice(0, full.indexOf("That's") + 20));
    expect(mid.completed).toHaveLength(1);
    expect(mid.completed[0]).toContain("cookie jar");
    // Whole buffer: both paragraphs out, trailer held.
    const end = splitStreamText(full);
    expect(end.completed).toHaveLength(2);
    expect(end.completed[1]).toContain("rewrites the original");
    expect(end.rest).toContain("```json");
  });
});
