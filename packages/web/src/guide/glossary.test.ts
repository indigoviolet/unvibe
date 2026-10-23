import { describe, expect, it } from "vitest";
import type { Block } from "@unvibe/shared";
import { linkCardBlocks } from "./glossary.js";

const TERMS = [
  { name: "HTTPHeaderDict", definition: "Headers view.", citation: "diff:conn:1" },
  { name: "_OBSOLETE_FOLD_RE", definition: "Pattern.", citation: "diff:conn:2" },
];

function para(id: string, html: string): Block {
  return { type: "paragraph", id, text: { standard: html }, citations: [] };
}

describe("linkCardBlocks", () => {
  it("links the first mention per card only", () => {
    const blocks: Block[] = [
      para("b1", "Uses HTTPHeaderDict here."),
      para("b2", "Again HTTPHeaderDict here."),
    ];
    const out = linkCardBlocks(blocks, TERMS, "standard");
    expect(out[0].type === "paragraph" && out[0].text.standard).toContain('data-glossary="HTTPHeaderDict"');
    expect(out[1].type === "paragraph" && out[1].text.standard).not.toContain("data-glossary");
  });

  it("does not link inside existing links", () => {
    const blocks: Block[] = [para("b1", 'See <a class="cx" data-link="concept:x">HTTPHeaderDict</a>.')];
    const out = linkCardBlocks(blocks, TERMS, "standard");
    expect(out[0].type === "paragraph" && out[0].text.standard).not.toContain("data-glossary");
  });

  it("leaves fenced code blocks alone", () => {
    const blocks: Block[] = [
      { type: "code", id: "b1", code: "HTTPHeaderDict", citations: [] },
      para("b2", "Uses HTTPHeaderDict here."),
    ];
    const out = linkCardBlocks(blocks, TERMS, "standard");
    expect(out[0].type).toBe("code");
    expect(out[1].type === "paragraph" && out[1].text.standard).toContain('data-glossary="HTTPHeaderDict"');
  });
});
