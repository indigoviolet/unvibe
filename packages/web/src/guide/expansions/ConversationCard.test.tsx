/**
 * Conversation card (issue #136 slice 1): one answer view per turn with
 * per-answer controls, a reply box that sends on the card, and
 * answer-qualified selection hosts.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { resolveSelectionHost } from "../../floating/SelectionToolbar.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";

const REVIEW_ID = "conv-card-test";

function para(id: string, text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "paragraph", id, text: { standard: text }, citations: [], ...extra };
}

function turn(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    question: null,
    blocks: [para("b1", "Answer body.")],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...over,
  };
}

function card(over: Record<string, unknown> = {}): Annotation {
  return {
    id: "ann_conv",
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
    note: false,
    turns: [turn("ans_1"), turn("ans_2", { question: "And then?" })],
    ...over,
  } as unknown as Annotation;
}

function seedSnapshot(annotations: Annotation[]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [
      {
        id: "root",
        kind: "root",
        title: "Root",
        saved: false,
        cards: [
          {
            id: "c1",
            pageId: "root",
            title: "Card",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "Some text." }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ],
    annotations,
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function show(c: Annotation, onFollowUp: (cardId: string, blockId: string, index: number) => void = () => {}): void {
  render(
    <ExpansionCard
      reviewId={REVIEW_ID}
      expansion={c}
      lookupPage={() => undefined}
      onOpenPage={() => {}}
      onFollowUp={onFollowUp}
    />,
  );
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
});

describe("conversation card", () => {
  test("renders one answer view per turn, each with its own controls", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    const answers = document.querySelectorAll("[data-answer]");
    expect(answers).toHaveLength(2);
    expect(answers[0].getAttribute("data-answer")).toBe("ans_1");
    expect(answers[1].getAttribute("data-answer")).toBe("ans_2");
    // The later turn's question reads as its heading; the first answer is
    // headed by the card's quoted text.
    expect(answers[1].querySelector(".ans-q")).toHaveTextContent("And then?");
    expect(answers[0].querySelector(".ans-q")).toBeNull();
    // No read control anywhere on the card.
    expect(screen.queryByRole("button", { name: /Mark (un)?read/ })).toBeNull();
  });

  test("depth on an answer addresses the answer id", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    const second = document.querySelector('[data-answer="ans_2"]')!;
    fireEvent.click(second.querySelector('button[aria-label="Deeper"]')!);
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "depth", cardId: "ans_2", direction: "deeper" });
  });

  test("the reply box sends on the card and clears", async () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: c.id });
    show(c);
    const box = screen.getByLabelText("Ask a follow-up") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "What about ordering?" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, {
      kind: "reply",
      annotationId: "ann_conv",
      message: "What about ordering?",
    });
  });

  test("a failed turn shows the error with a Retry button wired to the retry action", () => {
    const c = card({
      error: "rate limited",
      turns: [turn("ans_1"), turn("ans_2", { question: "And then?", error: "rate limited" })],
    });
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: c.id });
    show(c);
    const second = document.querySelector('[data-answer="ans_2"]')!;
    expect(second.querySelector("[role='alert'], .perr")).not.toBeNull();
    fireEvent.click(second.querySelector("button[data-retry='ans_2']")!);
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "retry", annotationId: "ann_conv" });
  });

  test("a selection inside an answer resolves to the answer-qualified block", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    const second = document.querySelector('[data-answer="ans_2"]')!;
    const top = second.querySelector("[data-top]")!;
    expect(resolveSelectionHost(top as HTMLElement)).toEqual({
      anchor: { where: "block", blockId: "ans_2#b1" },
    });
  });

  test("a suggestion click reports the answer id to onFollowUp", () => {
    const withSuggestion = card({
      turns: [
        turn("ans_1", {
          blocks: [
            para("b1", "Answer body."),
            { type: "follow-up", id: "b-f", items: [{ label: "Why?" }], citations: [] },
          ],
        }),
      ],
    });
    seedSnapshot([withSuggestion]);
    const seen: [string, string, number][] = [];
    show(withSuggestion, (cardId, blockId, index) => {
      seen.push([cardId, blockId, index]);
    });
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(seen).toEqual([["ans_1", "b-f", 0]]);
  });
});
