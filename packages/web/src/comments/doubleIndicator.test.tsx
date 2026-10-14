/**
 * Double busy indicator (issue #97): while an Explain or Ask works, the
 * client-side placeholder (or composer) and the card or thread the service
 * created at once must never show together. One box, one fixed label.
 *
 * Explain is held with a pending action request while the working
 * expansion arrives by patch; Ask is held while the working thread
 * arrives. Both windows previously rendered two boxes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Annotation, Card, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { NEW_THREAD_EVENT } from "../floating/SelectionToolbar.js";
import { performAction } from "../guide/actions.js";
import { CardView } from "../guide/CardView.js";
import { useReview } from "../state/store.js";


const REVIEW_ID = "double-test";

function card(): Card {
  return {
    id: "c1",
    pageId: "root",
    title: "Card",
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: "Some text." }, citations: [] }],
    undoStack: [],
  } as unknown as Card;
}

function seedSnapshot(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards: [card()] }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function workingExpansion(): Annotation {
  return {
    id: "ann_x",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "c1#b1" },
      quotedText: "Some text.",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [],
    post: false,
    working: "Thinking…",
    turns: [
      {
        id: "ans_x1",
        question: null,
        blocks: [],
        level: "standard",
        revision: 1,
        undoStack: [],
        working: "Thinking…",
      },
    ],
  } as unknown as Annotation;
}

function workingConversation(): Annotation {
  return {
    id: "ann_t",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "c1#b1" },
      quotedText: "Some text.",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [],
    post: false,
    working: "Thinking…",
    turns: [
      {
        id: "ans_t1",
        question: "what's that",
        blocks: [],
        level: "standard",
        revision: 1,
        undoStack: [],
        working: "Thinking…",
      },
    ],
  } as unknown as Annotation;
}

function addAnnotations(annotations: Annotation[]): void {
  act(() => {
    const snap = useReview.getState().snapshot!;
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: snap.rev,
      headRev: snap.rev + 1,
      ops: [{ op: "replace", path: "/annotations", value: annotations }],
    });
  });
}

function holdAction(): { resolveAction: (res: Record<string, unknown>) => void; restore: () => void } {
  let resolveAction!: (res: Record<string, unknown>) => void;
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
  seedSnapshot();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
});

describe("issue #97: one box while working", () => {
  test("Explain: the placeholder gives way to the working card with one label", async () => {
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
      act(() => {
        void performAction(REVIEW_ID, {
          kind: "explain",
          quote: "Some text.",
          anchor: { where: "block", blockId: "c1#b1" },
        });
      });
      // Placeholder only, so far.
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Writing explanation…");
      // The service's working expansion lands before the request returns.
      addAnnotations([workingExpansion()]);
      // Exactly one working indicator, labelled for the Explain…
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Writing explanation…");
      // …and content-needing controls are not offered on the empty card.
      const exp = document.querySelector('[data-expansion="ann_x"]') as HTMLElement;
      expect(exp).not.toBeNull();
      expect(within(exp).getByRole("button", { name: "Use examples" })).toBeDisabled();
      expect(within(exp).getByRole("button", { name: "Simpler" })).toBeDisabled();
      // The request returns and retargets: still exactly one box.
      act(() => {
        held.resolveAction({ accepted: true, annotationId: "ann_x" });
      });
      await act(async () => {});
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Writing explanation…");
    } finally {
      held.restore();
    }
  });

  test("Ask: the composer gives way to the working card labelled as an Ask", async () => {
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
      act(() => {
        window.dispatchEvent(
          new CustomEvent(NEW_THREAD_EVENT, {
            detail: {
              anchor: { where: "block", blockId: "c1#b1" },
              quote: "Some text.",
              kind: "ask",
            },
          }),
        );
      });
      fireEvent.change(screen.getByLabelText("New comment"), { target: { value: "what's that" } });
      fireEvent.click(screen.getByRole("button", { name: "Ask" }));
      expect(screen.getByRole("status")).toHaveTextContent("Asking…");
      // The service's working card lands before the request returns.
      addAnnotations([workingConversation()]);
      // The question is shown once, with one Ask-labelled indicator.
      expect(screen.queryByLabelText("New comment")).toBeNull();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Asking…");
      // The request returns: still exactly one box.
      act(() => {
        held.resolveAction({ accepted: true, annotationId: "ann_t", turnId: "ans_t1" });
      });
      await act(async () => {});
      expect(screen.queryByLabelText("New comment")).toBeNull();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent("Asking…");
    } finally {
      held.restore();
    }
  });
});
