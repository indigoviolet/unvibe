/**
 * Issue #252: the reader-result parser stores only trailing-JSON fields
 * the prompt requested, keyed off the prompt text itself. A reply that
 * carries `glossary` when the prompt didn't ask for one must not store it.
 */
import { describe, expect, it } from "vitest";
import { readerApply, requestedReaderFields } from "../src/pipeline/apply.js";

// Minimal bodies standing in for the two prompt generations: the JSON
// example names the requested fields quoted, exactly like the real
// `prompts/reader.md` output-shape blocks do.
const MAIN_BODY = `... {"pendingCards": [{"id": "g-flow", "label": "...", "why": "..."}],
 "plotlines": [{"id": "retry-logic", "name": "...", "hunks": ["h:conn:h111"]}]} ...`;

const BRANCH_BODY = `... {"pendingCards": [{"id": "g-flow", "label": "...", "why": "..."}],
 "plotlines": [{"id": "retry-logic", "name": "...", "hunks": ["h:conn:h111"]}],
 "glossary": [{"name": "HTTPHeaderDict", "definition": "...", "citation": "diff:conn:650-651"}]} ...`;

const DATA = {
  cardIds: ["problem", "central"],
  pendingCards: [{ id: "g-flow", label: "Flow", why: "follow it" }],
  plotlines: [{ id: "unfold", name: "Unfold", description: "d", hunks: [] as string[] }],
  glossary: [{ name: "HTTPHeaderDict", definition: "Headers view.", citation: "diff:conn:650-651" }],
};

const CARDS = [
  { title: "The problem", blocks: [] as never[] },
  { title: "The central idea", blocks: [] as never[] },
];

describe("requestedReaderFields (#252)", () => {
  it("reads the request off the prompt: main asks pendingCards+plotlines, branch adds glossary", () => {
    expect(requestedReaderFields(MAIN_BODY)).toEqual(["pendingCards", "plotlines"]);
    expect(requestedReaderFields(BRANCH_BODY)).toEqual(["pendingCards", "plotlines", "glossary"]);
  });

  it("stores glossary when the prompt asked for it", () => {
    const applied = readerApply(CARDS, DATA as unknown as Record<string, unknown>, BRANCH_BODY);
    expect(applied.plotlines).toHaveLength(1);
    expect(applied.glossary).toEqual(DATA.glossary);
    expect(applied.pendingCards).toHaveLength(1);
  });

  it("ignores glossary (and other unrequested fields) when the prompt did not ask", () => {
    const applied = readerApply(CARDS, DATA as unknown as Record<string, unknown>, MAIN_BODY);
    expect(applied.plotlines).toHaveLength(1);
    expect(applied.pendingCards).toHaveLength(1);
    expect(applied.glossary).toEqual([]);
    // cardIds is requested by neither generation: ids fall back to the
    // deterministic title/position rule, so streaming and final apply agree.
    expect(applied.cards.map((c) => c.id)).toEqual(["problem", "central"]);
  });
});
