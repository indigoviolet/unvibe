/**
 * Hunk-pass reply tolerance (issue #99): `parseHunkReply` accepts the
 * `{"hunk": …}` object fenced, unfenced, or as the whole reply, with or
 * without the leading Markdown line and trailing prose; recovers
 * `hiddenReason` in every accepted shape; and never yields JSON-looking
 * text as a summary.
 */
import { describe, expect, it } from "vitest";
import { looksLikeJson, parseHunkReply, truncateAtWordBoundary } from "../src/content/hunk.js";
import { splitReply } from "../src/content/split.js";

const SUMMARY = "Adds a fast path that skips values without CRLF.";
const HIDDEN = "import-only change";

function bare(summary: string, hidden: string | null): string {
  return `{"hunk": {"summary": ${JSON.stringify(summary)}, "hiddenReason": ${hidden === null ? "null" : JSON.stringify(hidden)}}}`;
}

/** Mirror of the runner: splitReply first, helper reads data + raw text. */
function parse(text: string): ReturnType<typeof parseHunkReply> {
  const split = splitReply(text);
  return parseHunkReply(text, split.ok ? split.data : null);
}

describe("parseHunkReply", () => {
  it("reads the canonical shape (md line + fenced json)", () => {
    expect(parse(`${SUMMARY}\n\n\`\`\`json\n${bare(SUMMARY, HIDDEN)}\n\`\`\`\n`)).toEqual({
      summary: SUMMARY,
      hiddenReason: HIDDEN,
    });
  });

  it("reads fenced json with no md line", () => {
    expect(parse(`\`\`\`json\n${bare(SUMMARY, HIDDEN)}\n\`\`\`\n`)).toEqual({ summary: SUMMARY, hiddenReason: HIDDEN });
  });

  it("reads an untagged fence with no md line", () => {
    expect(parse(`\`\`\`\n${bare(SUMMARY, null)}\n\`\`\`\n`)).toEqual({ summary: SUMMARY, hiddenReason: null });
  });

  it("reads bare json with no fence and no md line", () => {
    expect(parse(bare(SUMMARY, HIDDEN))).toEqual({ summary: SUMMARY, hiddenReason: HIDDEN });
  });

  it("reads bare json after an md line", () => {
    expect(parse(`${SUMMARY}\n${bare(SUMMARY, HIDDEN)}`)).toEqual({ summary: SUMMARY, hiddenReason: HIDDEN });
  });

  it("reads bare json with trailing prose after it", () => {
    expect(parse(`${bare(SUMMARY, HIDDEN)}\nHope this helps!\n`)).toEqual({ summary: SUMMARY, hiddenReason: HIDDEN });
  });

  it("reads fenced json with trailing prose after it", () => {
    expect(parse(`${SUMMARY}\n\n\`\`\`json\n${bare(SUMMARY, HIDDEN)}\n\`\`\`\nThanks!\n`)).toEqual({
      summary: SUMMARY,
      hiddenReason: HIDDEN,
    });
  });

  it("keeps a model-provided summary whole past 140 chars", () => {
    const long = `Adds ${"very ".repeat(40)}long handling.`;
    expect(long.length).toBeGreaterThan(140);
    expect(parse(bare(long, null)).summary).toBe(long);
  });

  it("recovers hiddenReason even when the summary must come from the md line", () => {
    // hunk object without a usable summary: hiddenReason still recovered.
    const r = parse(`${SUMMARY}\n${JSON.stringify({ hunk: { hiddenReason: HIDDEN } })}`);
    expect(r).toEqual({ summary: SUMMARY, hiddenReason: HIDDEN });
  });

  it("falls back to the md line as plain text, without link tokens", () => {
    const r = parse(`Fixes the fold [[diff:conn:80-82]] for good\n\n\`\`\`json\n{"other": true}\n\`\`\`\n`);
    expect(r.summary).toBe("Fixes the fold for good");
    expect(r.hiddenReason).toBeNull();
  });

  it("fallback keeps a concept label but drops a bare token", () => {
    const r = parse(`See [[concept:obs-fold|obsolete folding]] and [[diff:conn:80-82]]\n`);
    expect(r.summary).toBe("See obsolete folding and");
  });

  it("fallback skips fenced content and never returns it", () => {
    const r = parse(`\`\`\`python\nx = {"a": 1}\n\`\`\`\n`);
    expect(r.summary).toBeUndefined();
  });

  it("stores no summary when the reply is truncated json", () => {
    const r = parse(`{"hunk": {"summary": "Maps the Nav 2 Conversations item to the label`);
    expect(r.summary).toBeUndefined();
    expect(r.hiddenReason).toBeNull();
  });

  it("stores no summary for an empty reply", () => {
    expect(parse("").summary).toBeUndefined();
  });

  it("ignores non-string summary/hiddenReason types", () => {
    const r = parse(JSON.stringify({ hunk: { summary: 42, hiddenReason: 7 } }));
    expect(r.summary).toBeUndefined();
    expect(r.hiddenReason).toBeNull();
  });
});

describe("looksLikeJson", () => {
  it.each([
    [`{"hunk": {"summary": "cut`, true],
    [`   {"hunk": true}`, true],
    [`[1, 2]`, true],
    ["```json", true],
    ["```", true],
    ["Adds a fast path.", false],
    ["", false],
  ])("looksLikeJson(%j) is %s", (text, expected) => {
    expect(looksLikeJson(text)).toBe(expected);
  });
});

describe("truncateAtWordBoundary", () => {
  it("keeps short text whole", () => {
    expect(truncateAtWordBoundary("Adds a fast path.")).toBe("Adds a fast path.");
  });

  it("cuts on a word boundary with an ellipsis, never mid-word", () => {
    const long = `${"word ".repeat(40).trim()} tail`;
    const cut = truncateAtWordBoundary(long);
    expect(cut.endsWith("…")).toBe(true);
    const prefix = cut.slice(0, -1);
    expect(long.startsWith(prefix)).toBe(true);
    expect(long[prefix.length]).toBe(" ");
  });

  it("hard-cuts a single over-long word", () => {
    const word = "x".repeat(200);
    expect(truncateAtWordBoundary(word)).toBe(`${"x".repeat(140)}…`);
  });
});

describe("splitReply strictness is unchanged for other reply kinds", () => {
  it("bare json is still missing (not data) for generic callers", () => {
    const r = splitReply(bare(SUMMARY, null));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("missing");
  });

  it("a json-tagged fence that does not parse is still malformed", () => {
    const r = splitReply("Body.\n\n```json\n{nope\n```\n");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("malformed");
  });
});
