/**
 * Unique block IDs within one stored body (#116).
 *
 * `parseCards` numbers blocks per card, so flattening a multi-card reply
 * into an explanation / follow-up answer / second-opinion body repeats
 * IDs — and one anchor then matches two blocks. `dedupeBlockIds` runs
 * once at store time; `freshBlockId` picks collision-free inserted IDs.
 */
import { describe, expect, it } from "vitest";
import type { Block } from "../src/entities.js";
import { dedupeBlockIds, freshBlockId } from "../src/content/blocks.js";
import { parseCards } from "../src/content/parse.js";

const TWO_CARDS = `## First part

First paragraph about the folded header.

## Second part

Second paragraph about the folded header.

\`\`\`json
{}
\`\`\`
`;

function paragraph(id: string, text = "hi"): Block {
  return { type: "paragraph", id, text: { standard: text }, citations: [] };
}

function asideWithInner(id: string, innerId: string): Block {
  return {
    type: "aside",
    id,
    kind: "Example",
    inner: [{ type: "paragraph", id: innerId, text: { standard: "inner" }, citations: [] }],
    citations: [],
  };
}

function ids(blocks: Block[]): string[] {
  return blocks.map((b) => b.id);
}

describe("dedupeBlockIds", () => {
  it("leaves a single-card body untouched", () => {
    const body = parseCards(`A paragraph.\n\n\`\`\`json\n{}\n\`\`\`\n`).flatMap((c) => c.blocks);
    expect(dedupeBlockIds(body)).toEqual(body);
  });

  it("dedupes a flattened multi-card reply, first occurrence stable", () => {
    const flat = parseCards(TWO_CARDS).flatMap((c) => c.blocks);
    expect(ids(flat)).toEqual(["b1", "b1", "b2"]);
    expect(ids(dedupeBlockIds(flat))).toEqual(["b1", "b1-c2", "b2"]);
  });

  it("dedupes three repeats deterministically", () => {
    const out = dedupeBlockIds([paragraph("b1"), paragraph("b1"), paragraph("b1"), paragraph("b2")]);
    expect(ids(out)).toEqual(["b1", "b1-c2", "b1-c3", "b2"]);
  });

  it("re-prefixes aside inner IDs with the renamed parent", () => {
    const out = dedupeBlockIds([asideWithInner("b2", "b2-b1"), asideWithInner("b2", "b2-b1")]);
    expect(ids(out)).toEqual(["b2", "b2-c2"]);
    const second = out[1];
    expect(second.type).toBe("aside");
    if (second.type === "aside") {
      expect(second.inner.map((b) => b.id)).toEqual(["b2-c2-b1"]);
    }
  });

  it("preserves block content and order", () => {
    const flat = parseCards(TWO_CARDS).flatMap((c) => c.blocks);
    const out = dedupeBlockIds(flat);
    expect(out.map((b) => (b.type === "paragraph" ? b.text.standard : ""))).toEqual(
      flat.map((b) => (b.type === "paragraph" ? (b as { text: { standard: string } }).text.standard : "")),
    );
  });
});

describe("freshBlockId", () => {
  it("returns the base when free, else the next suffixed ID", () => {
    expect(freshBlockId([], "b-ex-x-0")).toBe("b-ex-x-0");
    const blocks = [paragraph("b-ex-x-0")];
    expect(freshBlockId(blocks, "b-ex-x-0")).toBe("b-ex-x-0-c2");
    const blocks2 = [paragraph("b-ex-x-0"), paragraph("b-ex-x-0-c2")];
    expect(freshBlockId(blocks2, "b-ex-x-0")).toBe("b-ex-x-0-c3");
  });
});
