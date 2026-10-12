/**
 * Unit tests for the pure guide logic: read roll-up, contents model,
 * depth text selection, link discovery (both `data-node` and `data-link`
 * spellings), concept resolution, anchor matching.
 */
import { describe, expect, it } from "vitest";
import type { Card, Job, Page } from "@unvibe/shared";
import {
  anchorMatchesBlock,
  blockCitations,
  cardPreview,
  contentsModel,
  depthText,
  emptyGuideState,
  isPageRead,
  jobForCard,
  linkedPages,
  lookupConceptPage,
  markKnownLinks,
  pageIdForLinkTarget,
  pagePreview,
  readCount,
  readableCards,
  splitAnchorBlockId,
} from "./guideUtils.js";

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

function mkPage(id: string, cards: Card[], kind: Page["kind"] = "concept"): Page {
  return { id, kind, title: `Title ${id}`, saved: false, parent: "root", cards };
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
    const target = mkPage("c-obs-fold", [mkCard("cc", "c-obs-fold", { read: true })]);
    const root = mkPage("root", [
      mkCard("problem", "root"),
      {
        ...mkCard("central", "root", { read: true }),
        blocks: [
          para("x", `See <a class="cx" data-link="concept:obs-fold">folding</a>.`),
          { type: "finding-link", id: "f1", pageId: "f-lf", citations: [] },
        ],
      },
    ], "root");
    const lookup = (id: string): Page | undefined =>
      id === "c-obs-fold" ? target : id === "f-lf" ? mkPage("f-lf", [mkCard("ev", "f-lf")], "finding") : undefined;
    const { cards, links } = contentsModel(root, lookup);
    expect(cards.map((c) => [c.id, c.read])).toEqual([
      ["problem", false],
      ["central", true],
    ]);
    expect(links.map((l) => [l.id, l.read])).toEqual([
      ["c-obs-fold", true],
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
  it("finds data-link concept links and legacy data-node ids", () => {
    const page = mkPage("root", [
      mkCard("a", "root", {
        blocks: [
          para("x", `<a class="cx" data-link="concept:obs-fold">x</a> <a class="cx" data-node="c-other">y</a> <a class="cx" data-link="page:root">self</a>`),
        ],
      }),
    ], "root");
    const found = linkedPages(
      page,
      (id) => (id === "c-obs-fold" || id === "c-other" ? mkPage(id, []) : undefined),
    );
    expect(found.map((p) => p.id).sort()).toEqual(["c-obs-fold", "c-other"]);
  });

  it("lists expansion-opened child pages under linked pages", () => {
    const root = mkPage("root", [mkCard("a", "root")], "root");
    const opened = { ...mkPage("p-x", [mkCard("c", "p-x")]), kind: "opened-expansion" as const, parent: "root" };
    const lookup = (id: string): Page | undefined => (id === "p-x" ? opened : undefined);
    const { links } = contentsModel(root, lookup, [root, opened]);
    expect(links.map((l) => l.id)).toContain("p-x");
  });
});

describe("concept resolution", () => {
  it("maps concept: slugs to c-<slug> pages", () => {
    const lookup = (id: string): Page | undefined =>
      id === "c-obs-fold" ? mkPage(id, []) : undefined;
    expect(lookupConceptPage(lookup, "obs-fold")?.id).toBe("c-obs-fold");
    expect(lookupConceptPage(lookup, "nope")).toBeUndefined();
    expect(pageIdForLinkTarget("concept:obs-fold", lookup)).toBe("c-obs-fold");
    expect(pageIdForLinkTarget("page:f-lf", lookup)).toBeNull();
  });
});

describe("known links", () => {
  it("mutes links to fully read pages with the check mark class", () => {
    const read = mkPage("c-obs-fold", [mkCard("cc", "c-obs-fold", { read: true })]);
    const unread = mkPage("c-other", [mkCard("cc", "c-other")]);
    const html =
      `<a class="cx" data-link="concept:obs-fold">A</a> ` +
      `<a class="cx" data-node="c-other">B</a> <a class="cx" data-link="concept:nope">C</a>`;
    expect(markKnownLinks(html, [read, unread])).toBe(
      `<a class="cx known" data-link="concept:obs-fold">A</a> ` +
        `<a class="cx" data-node="c-other">B</a> <a class="cx" data-link="concept:nope">C</a>`,
    );
  });
});

describe("anchor block ids", () => {
  it("splits card#block and matches both forms", () => {
    expect(splitAnchorBlockId("central#b4")).toEqual({ cardId: "central", block: "b4" });
    expect(splitAnchorBlockId("b4")).toEqual({ cardId: null, block: "b4" });
    expect(anchorMatchesBlock("central#b4", "central", "b4")).toBe(true);
    expect(anchorMatchesBlock("central#b4", "problem", "b4")).toBe(false);
    expect(anchorMatchesBlock("b4", "central", "b4")).toBe(true);
  });
});

describe("jobForCard", () => {
  it("finds running or queued jobs for the card", () => {
    const jobs = [
      { id: "a", kind: "depth", model: "m", priority: 1, state: "done", cardId: "c1" },
      { id: "b", kind: "go-deeper", model: "m", priority: 1, state: "running", cardId: "c2" },
    ] as const;
    expect(jobForCard([...jobs], "c1")).toBeUndefined();
    expect(jobForCard([...jobs], "c2")?.id).toBe("b");
    expect(jobForCard([...jobs], "c9")).toBeUndefined();
  });
});

describe("emptyGuideState (issue #44)", () => {
  const job = (state: string, extra: object = {}) =>
    ({ id: "j", kind: "reader", model: "m", priority: 1, state, ...extra }) as Job;

  it("is building while a job is live or a stage is running", () => {
    expect(emptyGuideState(undefined, [job("queued")])).toEqual({ kind: "building", detail: "reader" });
    expect(emptyGuideState({ stages: { reader: "done", base: "running" } }, [job("done")])).toEqual({
      kind: "building",
      detail: "base",
    });
    expect(emptyGuideState({ stages: { reader: "done", base: "pending" } }, [])).toEqual({ kind: "building" });
  });

  it("reports the stage error, falling back to the failed job", () => {
    expect(
      emptyGuideState({ stages: { reader: "error", base: "pending" }, errors: { reader: "agent exited" } }, []),
    ).toEqual({ kind: "error", detail: "agent exited" });
    expect(emptyGuideState(undefined, [job("error", { error: "no login" })])).toEqual({
      kind: "error",
      detail: "no login",
    });
    expect(emptyGuideState({ stages: { reader: "error" } }, [])).toEqual({
      kind: "error",
      detail: "The reader stage failed.",
    });
  });

  it("is idle when nothing has started", () => {
    expect(emptyGuideState(undefined, [])).toEqual({ kind: "idle" });
    expect(emptyGuideState({ stages: { reader: "pending", base: "pending" } }, [])).toEqual({ kind: "idle" });
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
      blockCitations(para("x", "t", ["diff:conn:82", "desc:d-p1"])).map((c) => c.target),
    ).toEqual(["diff:conn:82", "desc:d-p1"]);
    expect(
      blockCitations({ type: "finding-link", id: "f", pageId: "p", citations: [] }),
    ).toEqual([]);
  });
});
