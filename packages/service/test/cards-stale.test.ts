/**
 * `markStaleAnchors` checks the visible depth level (issue #72).
 *
 * Quote present at standard, absent at deep, card at deep → stale;
 * switching back to standard → not stale. A quote present in a hidden
 * level must not count as found.
 */
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { markStaleAnchors } from "../src/interaction/cards.js";

function snapshot(level: "simple" | "standard" | "deep"): ReviewSnapshot {
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
            level,
            collapsed: false,
            revision: 1,
            blocks: [
              {
                type: "paragraph",
                id: "b-p",
                text: {
                  standard: "The USB stream stays at 48 kHz with the fast path.",
                  deep: "The USB stream stays at 48 kHz with formal proofs.",
                },
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
        type: "conversation",
        anchor: {
          host: { kind: "block", blockId: "central#b-p" },
          quotedText: "fast path",
          prefix: "",
          suffix: "",
          position: 0,
          version: 1,
        },
        open: false,
        messages: [],
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

describe("markStaleAnchors visible level", () => {
  it("quote only in standard is stale when the card shows deep", () => {
    const draft = snapshot("deep") as unknown as Parameters<typeof markStaleAnchors>[0];
    const stale = markStaleAnchors(draft, "central");
    expect(stale).toContain("ann1");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBe(true);
  });

  it("switching back to standard clears stale", () => {
    const draft = snapshot("deep") as unknown as Parameters<typeof markStaleAnchors>[0];
    markStaleAnchors(draft, "central");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBe(true);
    // Simulate switching back: the card shows standard again.
    const card = (draft.pages as unknown as { cards: { level: string }[] }[])[0].cards[0];
    card.level = "standard";
    const stale = markStaleAnchors(draft, "central");
    expect(stale).not.toContain("ann1");
    expect((draft.annotations as unknown as { anchorStale?: boolean }[])[0].anchorStale).toBeUndefined();
  });

  it("quote in the visible level is not stale", () => {
    const draft = snapshot("standard") as unknown as Parameters<typeof markStaleAnchors>[0];
    const stale = markStaleAnchors(draft, "central");
    expect(stale).not.toContain("ann1");
  });

  it("deep fallback to standard counts when the level text is missing", () => {
    const base = snapshot("deep");
    const card = base.pages[0].cards[0];
    const para = card.blocks[0];
    if (para.type === "paragraph") {
      // No deep text: renderer falls back to standard, so the quote counts.
      delete (para.text as { deep?: string }).deep;
    }
    const draft = base as unknown as Parameters<typeof markStaleAnchors>[0];
    const stale = markStaleAnchors(draft, "central");
    expect(stale).not.toContain("ann1");
  });
});
