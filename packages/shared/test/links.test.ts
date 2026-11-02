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

  it("finds tokens whose paths contain brackets (issue #332)", () => {
    const cases: [string, string][] = [
      [
        "[[code:src/app/(group)/items/[id]/page.tsx:433-492]]",
        "code:src/app/(group)/items/[id]/page.tsx:433-492",
      ],
      ["[[code:dir/[...slug]/route.ts:1-5]]", "code:dir/[...slug]/route.ts:1-5"],
      ["[[code:pkg/@scope/x.ts:10-20]]", "code:pkg/@scope/x.ts:10-20"],
      ["[[code:a+b/c~d.ts:3]]", "code:a+b/c~d.ts:3"],
      ["[[code:src/app/(group)/a{[b]}c.ts:1-2]]", "code:src/app/(group)/a{[b]}c.ts:1-2"],
      ["[[diff:conn(1)/x[2].py:4-6]]", "diff:conn(1)/x[2].py:4-6"],
    ];
    for (const [raw, idText] of cases) {
      const toks = tokenizeLinks(`see ${raw} done`);
      expect(toks.map((t) => t.idText)).toEqual([idText]);
      expect(toks[0].raw).toBe(raw);
      expect(toks[0].start).toBe(4);
      expect(toks[0].end).toBe(4 + raw.length);
    }
  });

  it("finds bracket-path tokens with labels and inside markdown brackets (#332)", () => {
    const id = "code:src/app/(group)/items/[id]/page.tsx:433-492";
    const [labelled] = tokenizeLinks(`[[${id}|the page]]`);
    expect(labelled.idText).toBe(id);
    expect(labelled.label).toBe("the page");
    for (const s of [`see [the page [[${id}]]] done`, `([[${id}]])`, `[a [[${id}]] b]`]) {
      expect(tokenizeLinks(s).map((t) => t.idText)).toEqual([id]);
    }
  });

  it("leaves bracketed non-ids literal (issue #332)", () => {
    expect(tokenizeLinks("[[1,2],[3,4]]")).toEqual([]);
    expect(tokenizeLinks("[[foo [bar]]")).toEqual([]);
    expect(tokenizeLinks("[[page:a|b]c]]")).toEqual([]);
  });

  it("rescans nested opens instead of swallowing the inner token", () => {
    expect(tokenizeLinks("[[page:a [[page:b]]").map((t) => t.idText)).toEqual(["page:b"]);
  });
});

describe("replaceLinkTokens", () => {
  it("replaces tokens and keeps surrounding text", () => {
    const out = replaceLinkTokens("hi [[page:a]] bye", (t) => `<${t.idText}>`);
    expect(out).toBe("hi <page:a> bye");
  });
});
