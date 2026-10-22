/**
 * Page cards moved mid-fill (issue #152): a conversation opened as a
 * page while its answer is still being written keeps the turn on the
 * link annotation, and the page card resolves the working/error state
 * through the promoted-turn mapping until the fill settles.
 */
import { afterEach, describe, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Annotation, Card, Job, ReviewSnapshot, Turn } from "@unvibe/shared";
import { CardView } from "./CardView.js";
import { useReview } from "../state/store.js";

const REVIEW_ID = "card-promoted-test";

function card(): Card {
  return {
    id: "c-mock-0",
    pageId: "p-mock-1",
    title: "fast path",
    level: "standard",
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
  } as unknown as Card;
}

function turn(over: Partial<Turn> = {}): Turn {
  return {
    id: "ans_1",
    question: null,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    working: "Thinking…",
    ...over,
  } as unknown as Turn;
}

function link(turns: Turn[]): Annotation {
  return {
    id: "ann_1",
    type: "link",
    anchor: {
      host: { kind: "block", blockId: "central#b1" },
      quotedText: "fast path",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [],
    post: false,
    promotedToPage: "p-mock-1",
    promotedTurns: [{ turnId: "ans_1", cardId: "c-mock-0" }],
    turns,
  } as unknown as Annotation;
}

function seed(cards: Card[], annotations: Annotation[], jobs: Job[] = []): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "p-mock-1", kind: "opened-expansion", title: "fast path", parent: "root", cards }],
    annotations,
    hunkStates: [],
    jobs,
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function show(c: Card): void {
  render(
    <CardView
      reviewId={REVIEW_ID}
      card={c}
      lookupPage={() => undefined}
      onOpenPage={() => {}}
      onFollowUp={() => {}}
    />,
  );
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("CardView promoted fill states (issue #152)", () => {
  test("a filling promoted turn shows its working state on the page card", () => {
    seed([card()], [link([turn()])]);
    show(card());
    expect(screen.getByRole("status")).toHaveTextContent("Thinking…");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  test("a failed promoted turn shows the error with Retry on the page card", () => {
    seed([card()], [link([turn({ working: null, error: "boom" })])]);
    show(card());
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't get an answer. Retry, or see Debug for details.");
    // The raw reason never reaches the card.
    expect(screen.getByRole("alert").textContent).not.toContain("boom");
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.getAttribute("data-retry")).toBe("ans_1");
  });

  test("a live job on the card wins over the mapped turn state", () => {
    const job = {
      id: "j1",
      kind: "ask",
      model: "mock-main",
      priority: 100,
      state: "running",
      cardId: "c-mock-0",
    } as unknown as Job;
    seed([card()], [link([turn()])], [job]);
    show(card());
    // One working indicator only (the job's), never stacked with the turn's.
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Asking…");
  });

  test("a settled card shows neither working nor error", () => {
    seed([card()], [link([turn({ working: null })])]);
    show(card());
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
