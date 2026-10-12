/**
 * Block walker (issue #71): the diagrams route must find diagram blocks
 * wherever the data model can hold them. One case per live container, plus
 * the deliberate exclusions (undo stacks, thread HTML).
 */
import { describe, expect, it } from "vitest";
import type { Annotation, Block, DiagramBlock, Page } from "../src/entities.js";
import {
  allDiagramBlocks,
  findDiagramByHash,
  findDiagramBySource,
  liveBlockLists,
} from "../src/content/blocks.js";

function diagram(source: string, hash: string): DiagramBlock {
  return { type: "diagram", id: `b-${hash}`, source, citations: [], render: { hash, status: "unavailable" } };
}

function aside(id: string, inner: Block[]): Block {
  return { type: "aside", id, kind: "Example", inner, citations: [] };
}

function paragraph(id: string): Block {
  return { type: "paragraph", id, text: { standard: "hi" }, citations: [] };
}

const CARD_HASH = "card-top-00000001";
const CARD_ASIDE_HASH = "card-aside-000002";
const CARD_NESTED_HASH = "card-nested-00003";
const CARD_SO_HASH = "card-so-00000004";
const EXP_HASH = "exp-top-00000005";
const EXP_ASIDE_HASH = "exp-aside-0000006";
const EXP_SO_HASH = "exp-so-000000007";
const UNDO_HASH = "undo-stale-0000008";

const SRC: Record<string, string> = {
  [CARD_HASH]: "card-top-a -> card-top-b",
  [CARD_ASIDE_HASH]: "card-aside-a -> card-aside-b",
  [CARD_NESTED_HASH]: "card-nested-a -> card-nested-b",
  [CARD_SO_HASH]: "card-so-a -> card-so-b",
  [EXP_HASH]: "exp-top-a -> exp-top-b",
  [EXP_ASIDE_HASH]: "exp-aside-a -> exp-aside-b",
  [EXP_SO_HASH]: "exp-so-a -> exp-so-b",
  [UNDO_HASH]: "undo-a -> undo-b",
};

function snapshot(): { pages: Page[]; annotations: Annotation[] } {
  const pages = [
    {
      id: "root",
      kind: "root",
      title: "Root",
      saved: false,
      cards: [
        {
          id: "central",
          pageId: "root",
          title: null,
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          blocks: [
            paragraph("b1"),
            diagram(SRC[CARD_HASH], CARD_HASH),
            aside("a1", [diagram(SRC[CARD_ASIDE_HASH], CARD_ASIDE_HASH)]),
            aside("a2", [aside("a2-inner", [diagram(SRC[CARD_NESTED_HASH], CARD_NESTED_HASH)])]),
          ],
          undoStack: [{ blocks: [diagram(SRC[UNDO_HASH], UNDO_HASH)], level: "standard" }],
          secondOpinions: [
            {
              id: "so-central-blind",
              cardId: "central",
              mode: "blind",
              provider: "p",
              model: "m",
              verdict: "agrees",
              reasoning: "fine",
              blocks: [diagram(SRC[CARD_SO_HASH], CARD_SO_HASH)],
              version: 1,
              createdAt: 1,
            },
          ],
        },
      ],
    },
  ] as unknown as Page[];
  const annotations = [
    {
      id: "ann_exp",
      type: "expansion",
      anchor: {
        host: { kind: "block", blockId: "central#b1" },
        quotedText: "q",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [],
      post: false,
      note: false,
      expansion: {
        blocks: [
          diagram(SRC[EXP_HASH], EXP_HASH),
          aside("ea1", [diagram(SRC[EXP_ASIDE_HASH], EXP_ASIDE_HASH)]),
        ],
        level: "standard",
        read: false,
        collapsed: false,
        revision: 2,
        undoStack: [],
        secondOpinions: [
          {
            id: "so-exp-blind",
            cardId: "ann_exp",
            mode: "blind",
            provider: "p",
            model: "m",
            verdict: "partly",
            reasoning: "mostly",
            blocks: [paragraph("so-p"), diagram(SRC[EXP_SO_HASH], EXP_SO_HASH)],
            version: 1,
            createdAt: 1,
          },
        ],
      },
    },
    {
      // Ask thread: the agent's diagram arrives as raw HTML, not a block.
      id: "ann_thread",
      type: "thread",
      anchor: {
        host: { kind: "block", blockId: "central#b1" },
        quotedText: "q",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: true,
      messages: [{ who: "ai", html: '<pre class="d2">thread-a -&gt; thread-b</pre>' }],
      post: false,
      note: false,
    },
  ] as unknown as Annotation[];
  return { pages, annotations };
}

describe("liveBlockLists", () => {
  it("enumerates card, second-opinion and expansion lists", () => {
    const lists = liveBlockLists(snapshot());
    // card blocks + card second-opinion blocks + expansion blocks +
    // expansion second-opinion blocks.
    expect(lists).toHaveLength(4);
  });
});

describe("findDiagramByHash", () => {
  it.each([
    ["page card", CARD_HASH],
    ["card aside", CARD_ASIDE_HASH],
    ["nested aside in card", CARD_NESTED_HASH],
    ["card second opinion", CARD_SO_HASH],
    ["expansion", EXP_HASH],
    ["expansion aside", EXP_ASIDE_HASH],
    ["expansion second opinion", EXP_SO_HASH],
  ])("finds a diagram in a %s", (_label, hash) => {
    const hit = findDiagramByHash(snapshot(), hash);
    expect(hit?.source).toBe(SRC[hash]);
  });

  it("returns null for unknown hashes, undo history and thread HTML", () => {
    const snap = snapshot();
    expect(findDiagramByHash(snap, "deadbeefdeadbeef")).toBeNull();
    // Undo-stack revisions are stale, never rendered: not addressable.
    expect(findDiagramByHash(snap, UNDO_HASH)).toBeNull();
  });
});

describe("findDiagramBySource", () => {
  it("matches canonically in every container", () => {
    const snap = snapshot();
    expect(findDiagramBySource(snap, "exp-top-a -> exp-top-b\r\n")?.render?.hash).toBe(EXP_HASH);
    expect(findDiagramBySource(snap, SRC[CARD_ASIDE_HASH])?.render?.hash).toBe(CARD_ASIDE_HASH);
    expect(findDiagramBySource(snap, SRC[EXP_SO_HASH])?.render?.hash).toBe(EXP_SO_HASH);
    expect(findDiagramBySource(snap, "nothing -> here")).toBeNull();
  });
});

describe("allDiagramBlocks", () => {
  it("collects every live diagram exactly once", () => {
    const hashes = allDiagramBlocks(snapshot()).map((d) => d.render?.hash).sort();
    expect(hashes).toEqual(
      [CARD_HASH, CARD_ASIDE_HASH, CARD_NESTED_HASH, CARD_SO_HASH, EXP_HASH, EXP_ASIDE_HASH, EXP_SO_HASH].sort(),
    );
  });

  it("is empty on an empty snapshot", () => {
    expect(allDiagramBlocks({ pages: [], annotations: [] })).toEqual([]);
  });
});
