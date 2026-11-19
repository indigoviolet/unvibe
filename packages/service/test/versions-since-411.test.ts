/**
 * Since cards with bodies (issue #411).
 *
 * - A model Since card with no body blocks is a failed card: the shared
 *   builder drops it (like a blockless finding in `criticApplyAll`),
 *   never storing a title-only card.
 * - `excerpt` trims at a sentence boundary within the limit, else at a
 *   word boundary, with an ellipsis — never mid-word or mid-sentence,
 *   and never with a trailing space before the ellipsis.
 *
 * Pure unit tests: no repos, no agents, no live spend.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import {
  buildSinceSectionCards,
  excerpt,
  resolveSinceAnswers,
  type SinceCardDraftWithRefs,
} from "../src/versions/since.js";

function snap(): ReviewSnapshot {
  return {
    review: { currentVersion: 2 },
    pages: [{ id: "p", kind: "root", title: "G", cards: [] }],
  } as unknown as ReviewSnapshot;
}

function bodyCard(id: string): SinceCardDraftWithRefs {
  return {
    id,
    pageId: "since",
    title: "Delta",
    collapsed: false,
    revision: 1,
    undoStack: [],
    blocks: [{ type: "paragraph", id: `b-${id}`, text: "Alpha now returns 111.", citations: [] }],
  } as unknown as SinceCardDraftWithRefs;
}

describe("issue #411: bodyless model Since cards are failed cards", () => {
  it("drops cards with empty or missing blocks, keeps the rest", () => {
    const cards = buildSinceSectionCards(snap(), [
      { ...bodyCard("good"), id: "good" },
      {
        id: "empty",
        pageId: "since",
        title: "Title only",
        collapsed: false,
        revision: 1,
        undoStack: [],
        blocks: [],
      } as unknown as SinceCardDraftWithRefs,
      {
        id: "missing",
        pageId: "since",
        title: "No blocks key",
        collapsed: false,
        revision: 1,
        undoStack: [],
      } as unknown as SinceCardDraftWithRefs,
    ]);
    expect(cards.map((c) => c.id)).toEqual(["good"]);
    expect(cards[0].blocks).toHaveLength(1);
  });

  it("a wholly bodyless reply builds no cards (callers store no section)", () => {
    const cards = buildSinceSectionCards(snap(), [
      {
        id: "empty",
        pageId: "since",
        title: "Title only",
        collapsed: false,
        revision: 1,
        undoStack: [],
        blocks: [],
      } as unknown as SinceCardDraftWithRefs,
    ]);
    expect(cards).toEqual([]);
  });
});

describe("issue #411: excerpt trimming", () => {
  it("leaves short text untouched", () => {
    expect(excerpt("Short text.", 160)).toBe("Short text.");
    expect(excerpt("a".repeat(160), 160)).toBe("a".repeat(160));
  });

  it("cuts at the last sentence boundary within the limit", () => {
    expect(excerpt(`First. ${"x ".repeat(100)}`, 160)).toBe("First.…");
    expect(excerpt(`Alpha returns 111 now. ${"y ".repeat(100)}`, 160)).toBe("Alpha returns 111 now.…");
  });

  it("falls back to the last word boundary when no sentence ends in range", () => {
    expect(excerpt("word ".repeat(40), 160)).toBe(`${"word ".repeat(31)}word…`);
  });

  it("never leaves a trailing space before the ellipsis", () => {
    const cut = excerpt(`Done.  ${"y ".repeat(100)}`, 160);
    expect(cut).toBe("Done.…");
    expect(cut).not.toContain(" …");
    const wordCut = excerpt("word ".repeat(40), 160);
    expect(wordCut.endsWith(" …")).toBe(false);
    expect(wordCut.endsWith("…")).toBe(true);
  });

  it("a long review-comment body resolves to a boundary-cut excerpt", () => {
    const body = `Should return 111 here. ${"The surrounding code already assumes the new value everywhere it matters. ".repeat(4)}`;
    expect(body.length).toBeGreaterThan(160);
    const s = {
      existingComments: [
        {
          id: 7,
          path: "a.py",
          line: 11,
          body,
          bodyHtml: body,
          author: "reviewer",
          createdAt: "2026-11-04T00:00:00.000Z",
          htmlUrl: "https://example.test/pr/1#issuecomment-7",
        },
      ],
      annotations: [],
      prConversation: [],
      commits: [],
    } as unknown as ReviewSnapshot;
    const links = resolveSinceAnswers(s, [{ kind: "comment", id: "7" }]);
    expect(links).toHaveLength(1);
    // The second sentence ends inside the cap, the fifth does not: the
    // excerpt keeps whole sentences only, with no cut mid-sentence.
    expect(links[0].excerpt).toBe(
      "Should return 111 here. The surrounding code already assumes the new value everywhere it matters.…",
    );
  });
});
