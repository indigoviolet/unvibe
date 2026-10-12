/**
 * Card immediate feedback (issue #46) against the mock API (`VITE_MOCK=1`):
 * Generate on a pending card and follow-up chips react on click — the
 * request is held open so the immediate state is asserted before it
 * returns.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Card, Job, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { performFollowUp } from "./actions.js";
import { CardView } from "./CardView.js";

const REVIEW_ID = "card-test";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    pageId: "root",
    title: "Card",
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
    ...over,
  } as unknown as Card;
}

function seedSnapshot(cards: Card[], jobs: Job[] = []): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards }],
    annotations: [],
    hunkStates: [],
    jobs,
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function holdAction(): {
  resolveAction: (res: { accepted: boolean }) => void;
  restore: () => void;
} {
  let resolveAction!: (res: { accepted: boolean }) => void;
  const spy = vi.spyOn(api, "action").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve as never;
      }),
  );
  return { resolveAction: (res) => resolveAction(res), restore: () => spy.mockRestore() };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("CardView immediate feedback", () => {
  test("Generate on a pending card shows Writing… on click", () => {
    const pending = card({ pending: { label: "Go deeper", why: "More to say" } });
    seedSnapshot([pending]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={pending}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      // The Generate button is replaced by the placeholder indicator.
      expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("Writing…");
    } finally {
      held.restore();
    }
  });

  test("a follow-up chip goes disabled/busy on click with an answer placeholder", () => {
    const withFollow = card({
      blocks: [
        { type: "paragraph", id: "b-p", text: { standard: "Some text." }, citations: [] },
        { type: "follow-up", id: "b-f", items: [{ label: "Why?" }], citations: [] },
      ],
    });
    seedSnapshot([withFollow]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={withFollow}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={(cardId, blockId, i) => performFollowUp(REVIEW_ID, cardId, blockId, i)}
        />,
      );
      const chip = screen.getByRole("button", { name: "Why?" });
      fireEvent.click(chip);
      // The clicked chip cannot be double-clicked; the answer placeholder
      // shows where the expansion will land.
      expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent("Writing answer…");
    } finally {
      held.restore();
    }
  });

  test("a live card job with no in-flight entry still shows busy (reload mid-rewrite)", () => {
    const live = {
      id: "job-depth-1",
      kind: "depth",
      provider: "claude",
      model: "m",
      reviewId: REVIEW_ID,
      priority: 100,
      state: "running",
      cardId: "c1",
    } as Job;
    seedSnapshot([card()], [live]);
    expect(useReview.getState().inflight).toEqual({});
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={card()}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    expect(document.getElementById("C-c1")?.className).toMatch(/rewriting/);
    expect(screen.getByRole("status")).toHaveTextContent("Rewriting…");
    expect(screen.getByRole("button", { name: "Use examples" })).toBeDisabled();
  });

  test("depth marks the card as rewriting on click", () => {
    seedSnapshot([card()]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={card()}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Deeper" }));
      const section = document.getElementById("C-c1");
      expect(section?.className).toMatch(/rewriting/);
      expect(section?.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("status")).toHaveTextContent("Rewriting…");
      // Conflicting controls go disabled; the local read toggle stays on.
      expect(screen.getByRole("button", { name: "Use examples" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Mark read" })).toBeEnabled();
    } finally {
      held.restore();
    }
  });
});
