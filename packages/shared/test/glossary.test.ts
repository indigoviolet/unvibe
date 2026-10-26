import { describe, expect, it } from "vitest";
import { formatGlossaryForPrompt, linkGlossaryInHtml, normalizeGlossary } from "../src/glossary.js";

describe("normalizeGlossary", () => {
  it("accepts exact names with code/hunk citations", () => {
    const out = normalizeGlossary([
      { name: "HTTPHeaderDict", definition: "Headers view.", citation: "diff:conn:650-651" },
      { name: "_OBSOLETE_FOLD_RE", definition: "Pattern.", citation: "code:src/a.py:1-3" },
      { name: "fold", definition: "Thing.", citation: "h:conn:abc123" },
    ]);
    expect(out.terms).toHaveLength(3);
    expect(out.dropped).toEqual({ empty: 0, invalidCitation: 0, duplicates: 0, extra: 0 });
  });

  it("drops empties, bad grammar and duplicates, caps at 20", () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      name: `T${i}`,
      definition: "d",
      citation: "diff:conn:1",
    }));
    const out = normalizeGlossary([
      { name: "", definition: "d", citation: "diff:conn:1" },
      { name: "A", definition: "", citation: "diff:conn:1" },
      { name: "B", definition: "d", citation: "desc:d-p1" },
      { name: "C", definition: "d", citation: "bogus" },
      { name: "D", definition: "d", citation: "diff:conn:1" },
      { name: "D", definition: "other", citation: "diff:conn:2" },
      ...many,
    ]);
    expect(out.dropped.empty).toBe(2);
    expect(out.dropped.invalidCitation).toBe(2);
    expect(out.dropped.duplicates).toBe(1);
    expect(out.terms).toHaveLength(20);
    expect(out.dropped.extra).toBeGreaterThan(0);
  });

  it("formats a compact prompt block", () => {
    const text = formatGlossaryForPrompt([
      { name: "HTTPHeaderDict", definition: "Headers view.", citation: "diff:conn:1" },
    ]);
    expect(text).toContain("## Glossary");
    expect(text).toContain("Use these exact terms");
    expect(text).toContain("`HTTPHeaderDict` — Headers view.");
  });

  it("formats empty as empty string", () => {
    expect(formatGlossaryForPrompt([])).toBe("");
  });
});

describe("linkGlossaryInHtml", () => {
  const terms = [
    { name: "HTTPHeaderDict", definition: "Headers view.", citation: "diff:conn:1" },
    { name: "HTTP", definition: "Short.", citation: "diff:conn:2" },
  ];

  it("links only the first mention per card", () => {
    const seen = new Set<string>();
    const first = linkGlossaryInHtml("Uses HTTPHeaderDict here.", terms, seen);
    expect(first.html).toContain('data-glossary="HTTPHeaderDict"');
    expect(first.linked).toEqual(["HTTPHeaderDict"]);
    const second = linkGlossaryInHtml("Again HTTPHeaderDict here.", terms, seen);
    expect(second.html).not.toContain("data-glossary");
    expect(second.linked).toEqual([]);
  });

  it("prefers the longest name and respects word boundaries", () => {
    const seen = new Set<string>();
    const out = linkGlossaryInHtml("HTTPHeaderDict and HTTP and HTTPHeaderDicts.", terms, seen);
    expect(out.html).toContain('data-glossary="HTTPHeaderDict"');
    // HTTPHeaderDicts is a larger identifier: no link inside it.
    expect(out.html).not.toContain('HTTPHeaderDicts</a>');
  });

  it("skips existing links", () => {
    const seen = new Set<string>();
    const html = 'See <a class="cx" data-link="concept:x">HTTPHeaderDict</a> here.';
    const out = linkGlossaryInHtml(html, terms, seen);
    expect(out.html).not.toContain("data-glossary");
    expect(out.linked).toEqual([]);
  });

  it("links inside inline code spans", () => {
    const seen = new Set<string>();
    const out = linkGlossaryInHtml("Uses <code>HTTPHeaderDict</code> here.", terms, seen);
    expect(out.html).toContain('data-glossary="HTTPHeaderDict"');
  });
});
