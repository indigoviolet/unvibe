/**
 * Required reader-guide shape (issue #430): pure check over parsed cards
 * plus the trailing data's pendingCards.
 */
import { describe, expect, it } from "vitest";
import { parseCards } from "../src/content/index.js";
import {
  checkReaderShape,
  READER_MIN_GO_DEEPER,
  shapeBlockHasContent,
} from "../src/reader-shape.js";
import type { Block } from "../src/entities.js";

function cardsOf(markdown: string): { title: string | null; blocks: Block[] }[] {
  return parseCards(markdown).map((c) => ({ title: c.title, blocks: c.blocks }));
}

const PROBLEM = `## The problem\n\nOld servers split one header across lines. [[desc:d-p1]]\n`;
const CENTRAL = `## The central idea\n\nUnfold every fold right after parsing. [[diff:conn:80-88]]\n`;
const DECISIONS = `## Decisions and questions\n\n**Decisions**\n- **Normalize in getresponse.** Chosen over cleaning the copy. [[diff:conn:102-108]]\n`;
const THREE_DIRECTIONS = [
  { id: "g-a", label: "A", why: "why a" },
  { id: "g-b", label: "B", why: "why b" },
  { id: "g-c", label: "C", why: "why c" },
];

describe("checkReaderShape", () => {
  it("a full reply (problem + central + 3 directions) is complete", () => {
    const shape = checkReaderShape(cardsOf(`${PROBLEM}\n${CENTRAL}\n${DECISIONS}`), THREE_DIRECTIONS);
    expect(shape.complete).toBe(true);
    expect(shape.missing).toEqual([]);
    expect(shape.goDeeperHave).toBe(3);
  });

  it("the #430 one-card reply misses the central card and the directions", () => {
    const shape = checkReaderShape(cardsOf(PROBLEM), [{ id: "g-a", label: "A", why: "why" }]);
    expect(shape.complete).toBe(false);
    expect(shape.missingProblem).toBe(false);
    expect(shape.missingCentral).toBe(true);
    expect(shape.missing).toEqual(["The central idea", "Go deeper directions (1 of at least 3)"]);
  });

  it("an empty reply misses everything", () => {
    const shape = checkReaderShape([], undefined);
    expect(shape.complete).toBe(false);
    expect(shape.missing).toEqual([
      "The problem",
      "The central idea",
      `Go deeper directions (0 of at least ${READER_MIN_GO_DEEPER})`,
    ]);
  });

  it("a card with only empty placeholders still misses its body", () => {
    const shape = checkReaderShape(cardsOf("## The problem\n\n"), THREE_DIRECTIONS);
    expect(shape.missingProblem).toBe(true);
    expect(shape.missing).toContain("The problem");
  });

  it("extra directions (4–5) stay complete", () => {
    const shape = checkReaderShape(cardsOf(`${PROBLEM}\n${CENTRAL}`), [...THREE_DIRECTIONS, { id: "g-d", label: "D", why: "why d" }]);
    expect(shape.complete).toBe(true);
  });

  it("a non-array or missing pendingCards counts as zero directions", () => {
    for (const pending of [undefined, null, {}, "g-a"]) {
      const shape = checkReaderShape(cardsOf(`${PROBLEM}\n${CENTRAL}`), pending);
      expect(shape.goDeeperHave).toBe(0);
      expect(shape.complete).toBe(false);
    }
  });

  it("requireGoDeeper false skips the directions (unrequested persona field)", () => {
    const shape = checkReaderShape(cardsOf(`${PROBLEM}\n${CENTRAL}`), undefined, { requireGoDeeper: false });
    expect(shape.complete).toBe(true);
  });

  it("the legacy central-change title counts as the central card", () => {
    const shape = checkReaderShape(
      cardsOf(`## The problem\n\nBody with a citation. [[desc:d-p1]]\n\n## The central change\n\nOther body. [[diff:conn:1-2]]\n`),
      THREE_DIRECTIONS,
    );
    expect(shape.complete).toBe(true);
  });

  it("titles match case-insensitively with surrounding space", () => {
    const shape = checkReaderShape(cardsOf(`##   THE PROBLEM\n\nBody. [[desc:d-p1]]\n\n## the Central Idea\n\nBody. [[diff:conn:1-2]]\n`), THREE_DIRECTIONS);
    expect(shape.complete).toBe(true);
  });

  it("an untitled first section is not the problem card", () => {
    const shape = checkReaderShape(cardsOf(`Preamble without a heading.\n\n${CENTRAL}`), THREE_DIRECTIONS);
    expect(shape.missingProblem).toBe(true);
    expect(shape.missingCentral).toBe(false);
  });
});

describe("shapeBlockHasContent", () => {
  it("empty placeholders carry no content", () => {
    const empty: Block[] = cardsOf("## The problem\n\n").flatMap((c) => c.blocks);
    expect(empty.length).toBe(0);
    const mk = (b: Block): boolean => shapeBlockHasContent(b);
    expect(mk({ type: "paragraph", id: "b1", text: "   ", citations: [] })).toBe(false);
    expect(mk({ type: "paragraph", id: "b1", text: "<p><br></p>", citations: [] })).toBe(false);
    expect(mk({ type: "list", id: "b1", ordered: false, items: [], citations: [] })).toBe(false);
    expect(mk({ type: "code", id: "b1", code: "\n  \n", citations: [] })).toBe(false);
    expect(mk({ type: "diagram", id: "b1", source: "", caption: undefined, citations: [] })).toBe(false);
    expect(mk({ type: "follow-up", id: "b1", items: [], citations: [] })).toBe(false);
    expect(
      mk({ type: "aside", id: "b1", kind: "Background", inner: [{ type: "paragraph", id: "b2", text: " ", citations: [] }], citations: [] }),
    ).toBe(false);
  });

  it("real blocks carry content", () => {
    const mk = (b: Block): boolean => shapeBlockHasContent(b);
    expect(mk({ type: "paragraph", id: "b1", text: "Words. [[desc:d-p1]]", citations: [] })).toBe(true);
    expect(mk({ type: "list", id: "b1", ordered: false, items: [{ html: "one", citations: [] }], citations: [] })).toBe(true);
    expect(mk({ type: "code", id: "b1", code: "x = 1", citations: [] })).toBe(true);
    expect(mk({ type: "follow-up", id: "b1", items: [{ label: "Why?" }], citations: [] })).toBe(true);
  });
});
