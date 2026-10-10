/**
 * Unit tests for the pure guide logic: read roll-up, contents model,
 * depth text selection, link discovery, known-link marking, previews.
 */
import { describe, expect, it } from "vitest";
import type { Card, Page } from "@unvibe/shared";
import {
  blockCitations,
  cardPreview,
  contentsModel,
  depthText,
  isPageRead,
  linkedPages,
  markKnownLinks,
  pagePreview,
  readCount,
  readableCards,
} from "../src/guide/guideUtils.js";

function para(id: string, standard: string, citations: string[] = []): Card["blocks"][number] {
  return {
    type: "paragraph",
    id,
    text: { standard },
    citations: citations.map((target) => ({ target })),
  };
}

function mkCard(id: string, pageId: string, opts?: Partial<Card>): Card {
  return {
    id,
    pageId,
    title: id,
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [para(`${id}-1`, `Body of ${id}.`)],
    undoStack: [],
    ...opts,
  };
}

function mkPage(id: string, cards: Card[]): Page {
  return { id, kind: "concept", title: `Title ${id}`, saved: false, parent: "root", cards };
}

describe("read roll-up (PRD §4.4)", () => {
  it("a page is read when all its cards are", () => {
    const page = mkPage("p", [mkCard("a", "p"), mkCard("b", "p")]);
    expect(isPageRead(page)).toBe(false);
    page.cards[0].read = true;
    expect(isPageRead(page)).toBe(false);
    expect(readCount(page)).toBe(1);
    page.cards[1].read = true;
    expect(isPageRead(page)).toBe(true);
  });

  it("pending cards do not count toward read state", () => {
    const pending: Card = {
      ...mkCard("g", "p"),
      title: null,
      blocks: [],
      pending: { label: "Go deeper", why: "why" },
    };
    const page = mkPage("p", [pending]);
    expect(readableCards(page)).toHaveLength(0);
    expect(isPageRead(page)).toBe(false);
  });

  it("an empty page is never read", () => {
    expect(isPageRead(mkPage("p", []))).toBe(false);
  });
});

describe("depth text selection (PRD §4.4)", () => {
  const text = { simple: "simple", standard: "standard", deep: "deep" };
  it("picks the level text, falling back to standard", () => {
    expect(depthText(text, "simple")).toBe("simple");
    expect(depthText(text, "standard")).toBe("standard");
    expect(depthText(text, "deep")).toBe("deep");
    expect(depthText({ standard: "only" }, "deep")).toBe("only");
  });
});

describe("contents model (PRD §4.3)", () => {
  it("lists this page's cards and linked pages, muting read items", () => {
    const target = mkPage("c-fold", [mkCard("cc", "c-fold", { read: true })]);
    const root = mkPage("root", [
      mkCard("problem", "root"),
      {
        ...mkCard("central", "root", { read: true }),
        blocks: [
          para("x", `See <a class="cx" data-node="c-fold">folding</a>.`),
          { type: "finding-link", id: "f1", pageId: "f-lf", citations: [] },
        ],
      },
    ]);
    const lookup = (id: string): Page | undefined =>
      id === "c-fold" ? target : id === "f-lf" ? mkPage("f-lf", [mkCard("ev", "f-lf")]) : undefined;
    const { cards, links } = contentsModel(root, lookup);
    expect(cards.map((c) => [c.id, c.read])).toEqual([
      ["problem", false],
      ["central", true],
    ]);
    // Linked pages: concept (fully read → muted) + finding (unread).
    expect(links.map((l) => [l.id, l.read])).toEqual([
      ["c-fold", true],
      ["f-lf", false],
    ]);
  });

  it("untitled cards fall back to their first line", () => {
    const page = mkPage("p", [mkCard("u", "p", { title: null })]);
    const { cards } = contentsModel(page, () => undefined);
    expect(cards[0].title).toBe("Body of u.");
  });
});

describe("linked pages", () => {
  it("finds inline concept links, skips self and unknown ids", () => {
    const page = mkPage("root", [
      mkCard("a", "root", {
        blocks: [
          para("x", `<a class="cx" data-node="c-fold">x</a> <a class="cx" data-node="root">self</a> <a class="cx" data-node="nope">?</a>`),
        ],
      }),
    ]);
    const found = linkedPages(page, (id) => (id === "c-fold" ? mkPage("c-fold", []) : undefined));
    expect(found.map((p) => p.id)).toEqual(["c-fold"]);
  });
});

describe("known links", () => {
  it("mutes links to fully read pages with the check mark class", () => {
    const html = `<a class="cx" data-node="a">A</a> <a class="cx" data-node="b">B</a>`;
    expect(markKnownLinks(html, (id) => id === "a")).toBe(
      `<a class="cx known" data-node="a">A</a> <a class="cx" data-node="b">B</a>`,
    );
  });
});

describe("previews", () => {
  it("card preview uses the first text block, stripped", () => {
    const card = mkCard("c", "p", {
      title: null,
      blocks: [para("c-1", `<b>Hello</b>   world <code>x</code>.`)],
    });
    expect(cardPreview(card)).toBe("Hello world x .");
  });

  it("page preview returns the first paragraph text", () => {
    const page = mkPage("p", [mkCard("c", "p")]);
    expect(pagePreview(page)).toBe("Body of c.");
    expect(pagePreview(mkPage("q", []))).toBe("");
  });
});

describe("block citations", () => {
  it("returns citations for content blocks, none for structural ones", () => {
    expect(
      blockCitations(para("x", "t", ["diff:conn:82", "desc:d-intro"])).map((c) => c.target),
    ).toEqual(["diff:conn:82", "desc:d-intro"]);
    expect(
      blockCitations({ type: "finding-link", id: "f", pageId: "p", citations: [] }),
    ).toEqual([]);
  });
});
