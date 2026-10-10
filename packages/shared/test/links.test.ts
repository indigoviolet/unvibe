import { describe, expect, it } from "vitest";
import { replaceLinkTokens, tokenizeLinks } from "../src/links.js";

describe("tokenizeLinks", () => {
  it("finds PRD §10 example tokens", () => {
    const text =
      "see [[diff:sp:147-152]], [[code:src/x.py:10-20]], [[desc:d-table]], " +
      "[[card:central#p-rule]], [[page:f-522]], [[concept:idempotency|idempotency]]";
    const toks = tokenizeLinks(text);
    expect(toks.map((t) => t.idText)).toEqual([
      "diff:sp:147-152",
      "code:src/x.py:10-20",
      "desc:d-table",
      "card:central#p-rule",
      "page:f-522",
      "concept:idempotency",
    ]);
    expect(toks.at(-1)?.label).toBe("idempotency");
    expect(toks[0].label).toBeUndefined();
  });

  it("returns positions that slice back to the raw token", () => {
    const text = "a [[diff:sp:1]] b";
    const [t] = tokenizeLinks(text);
    expect(text.slice(t.start, t.end)).toBe(t.raw);
    expect(t.raw).toBe("[[diff:sp:1]]");
  });

  it("ignores empty and unclosed tokens", () => {
    expect(tokenizeLinks("empty [[]] here")).toEqual([]);
    expect(tokenizeLinks("unclosed [[diff:sp:1 here")).toEqual([]);
    expect(tokenizeLinks("no tokens")).toEqual([]);
  });

  it("splits labels on the first pipe only", () => {
    const [t] = tokenizeLinks("[[card:c|a|b]]");
    expect(t.idText).toBe("card:c");
    expect(t.label).toBe("a|b");
  });

  it("finds adjacent tokens", () => {
    const toks = tokenizeLinks("[[page:a]][[page:b]]");
    expect(toks).toHaveLength(2);
  });
});

describe("replaceLinkTokens", () => {
  it("replaces tokens and keeps surrounding text", () => {
    const out = replaceLinkTokens("hi [[page:a]] bye", (t) => `<${t.idText}>`);
    expect(out).toBe("hi <page:a> bye");
  });
});
