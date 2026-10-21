/**
 * Unit tests for the pure guide logic: contents model, depth text
 * selection, link discovery (both `data-node` and `data-link` spellings),
 * concept resolution, anchor matching.
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
  jobForCard,
  linkedPages,
  lookupConceptPage,
  pageIdForLinkTarget,
  pagePreview,
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
  it("lists this page's cards and linked pages", () => {
    const target = mkPage("c-obs-fold", [mkCard("cc", "c-obs-fold")]);
    const root = mkPage("root", [
      mkCard("problem", "root"),
      {
        ...mkCard("central", "root"),
        blocks: [
          para("x", `See <a class="cx" data-link="concept:obs-fold">folding</a>.`),
          { type: "finding-link", id: "f1", pageId: "f-lf", citations: [] },
        ],
      },
    ], "root");
    const lookup = (id: string): Page | undefined =>
      id === "c-obs-fold" ? target : id === "f-lf" ? mkPage("f-lf", [mkCard("ev", "f-lf")], "finding") : undefined;
    const { cards, links } = contentsModel(root, lookup);
    expect(cards.map((c) => c.id)).toEqual(["problem", "central"]);
    expect(links.map((l) => l.id)).toEqual(["c-obs-fold", "f-lf"]);
  });

  it("lists the renamed decisions card and the Names card in order (#212)", () => {
    const root = mkPage("root", [
      mkCard("problem", "root", { title: "The problem" }),
      mkCard("central", "root", { title: "The central change" }),
      mkCard("buildup", "root", { title: "How it's built up" }),
      mkCard("decisions", "root", { title: "Decisions and questions" }),
      mkCard("names", "root", { title: "Names" }),
    ], "root");
    const { cards } = contentsModel(root, () => undefined);
    expect(cards.map((c) => [c.id, c.title])).toEqual([
      ["problem", "The problem"],
      ["central", "The central change"],
      ["buildup", "How it's built up"],
      ["decisions", "Decisions and questions"],
      ["names", "Names"],
    ]);
  });

  it("untitled cards fall back to their first sentence, never cut mid-word (#49)", () => {
    const page = mkPage("p", [mkCard("u", "p", { title: null })]);
    const { cards } = contentsModel(page, () => undefined);
    expect(cards[0].title).toBe("Body of u.");
  });

  it("long untitled bodies get a word-boundary fallback with an ellipsis (#49)", () => {
    const body =
      "A single microphone cannot tell who is speaking because the childrens voices all sound the same in this recording";
    const card = mkCard("u", "p", { title: null, blocks: [para("u-1", body)] });
    const { cards } = contentsModel(mkPage("p", [card]), () => undefined);
    expect(cards[0].title.endsWith("…")).toBe(true);
    // Word boundary: the stem is a body prefix and the next body char is a space.
    const stem = cards[0].title.slice(0, -1);
    expect(body.startsWith(stem)).toBe(true);
    expect(body[stem.length]).toBe(" ");
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

describe("anchor block ids", () => {
  it("splits card#block and matches both forms", () => {
    expect(splitAnchorBlockId("central#b4")).toEqual({ cardId: "central", block: "b4" });
    expect(splitAnchorBlockId("b4")).toEqual({ cardId: null, block: "b4" });
    expect(anchorMatchesBlock("central#b4", "central", "b4")).toBe(true);
    expect(anchorMatchesBlock("central#b4", "problem", "b4")).toBe(false);
  });

  it("matches exact owner and block only (#116)", () => {
    // Unqualified block IDs never match: b1 restarts in every card.
    expect(anchorMatchesBlock("b4", "central", "b4")).toBe(false);
    // No prefix matching.
    expect(anchorMatchesBlock("c1#b1", "c1", "b10")).toBe(false);
    expect(anchorMatchesBlock("c1#b10", "c1", "b1")).toBe(false);
    // An expansion host never matches its outer card, a sibling, or a
    // nested expansion reusing the block number.
    expect(anchorMatchesBlock("ann_parent#b2", "c1", "b2")).toBe(false);
    expect(anchorMatchesBlock("ann_parent#b2", "ann_sibling", "b2")).toBe(false);
    expect(anchorMatchesBlock("ann_parent#b2", "ann_child", "b2")).toBe(false);
    // ...but matches its own block.
    expect(anchorMatchesBlock("ann_parent#b2", "ann_parent", "b2")).toBe(true);
    expect(anchorMatchesBlock("ann_parent#b2", "ann_parent", "b3")).toBe(false);
  });
});

describe("jobForCard", () => {
  it("finds running or queued jobs for the card", () => {
    const jobs = [
      { id: "a", kind: "depth", model: "m", effort: "", priority: 1, state: "done", cardId: "c1" },
      { id: "b", kind: "go-deeper", model: "m", effort: "", priority: 1, state: "running", cardId: "c2" },
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
      detail: "Something went wrong while reading the change.",
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
