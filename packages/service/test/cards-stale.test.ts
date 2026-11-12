/**
 * `markStaleAnchors` checks the card's current text (issue #72, #387).
 *
 * Quote present → not stale; quote missing after a rewrite → stale with
 * the footnote flag; quote returning → flag cleared.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { markStaleAnchors } from "../src/interaction/cards.js";

function snapshot(text: string): ReviewSnapshot {
  return {
    review: { id: "r", repoId: "demo", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [
      {
        id: "root",
        kind: "root",
        title: "Root",
        cards: [
          {
            id: "central",
            pageId: "root",
            title: "Central",
            collapsed: false,
            revision: 1,
            blocks: [
              {
                type: "paragraph",
                id: "b-p",
                text,
                citations: [],
              },
            ],
            undoStack: [],
          },
        ],
      },
    ],
    annotations: [
      {
        id: "ann1",
        type: "thread",
        anchor: {
          host: { kind: "block", blockId: "central#b-p" },
          quotedText: "fast path",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        replies: [],
        post: false,
        note: false,
      },
    ],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot;
}

describe("markStaleAnchors current text", () => {
  it("quote missing after a rewrite is stale", () => {
    const draft = snapshot("The USB stream stays at 48 kHz, rewritten slowly.") as unknown as Parameters<
      typeof markStaleAnchors
    >[0];
    const stale = markStaleAnchors(draft, "central");
    expect(stale).toContain("ann1");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBe(true);
  });

  it("quote returning clears stale", () => {
    const draft = snapshot("The USB stream stays at 48 kHz, rewritten slowly.") as unknown as Parameters<
      typeof markStaleAnchors
    >[0];
    markStaleAnchors(draft, "central");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBe(true);
    // Simulate undo: the card shows the original text again.
    const card = (
      draft.pages as unknown as { cards: { blocks: { type: string; text: string }[] }[] }[]
    )[0].cards[0];
    card.blocks[0] = { ...card.blocks[0], text: "The USB stream stays at 48 kHz with the fast path." };
    const stale = markStaleAnchors(draft, "central");
    expect(stale).not.toContain("ann1");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBeUndefined();
  });

  it("quote in the current text is not stale", () => {
    const draft = snapshot("The USB stream stays at 48 kHz with the fast path.") as unknown as Parameters<
      typeof markStaleAnchors
    >[0];
    const stale = markStaleAnchors(draft, "central");
    expect(stale).not.toContain("ann1");
  });
});
