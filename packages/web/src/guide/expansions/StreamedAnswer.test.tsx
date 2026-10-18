/**
 * Paragraph-by-paragraph answers (issue #126, experiment): completed
 * paragraphs from the live stream render while the turn fills, half
 * sentences stay held, and the stored turn (or an error) replaces the
 * provisional content.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";
import { streamingEnabled } from "./streamedAnswer.js";

const REVIEW_ID = "stream-test";

function turn(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    question: null,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    working: "Writing explanation…",
    ...over,
  };
}

function card(over: Record<string, unknown> = {}): Annotation {
  return {
    id: "ann_stream",
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
    turns: [turn("ans_1")],
    ...over,
  } as unknown as Annotation;
}

function seedSnapshot(annotations: Annotation[]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations,
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function show(c: Annotation): { rerender: (next: Annotation) => void } {
  const renderCard = (card: Annotation): React.JSX.Element => (
    <ExpansionCard
      reviewId={REVIEW_ID}
      expansion={card}
      lookupPage={() => undefined}
      onOpenPage={() => {}}
      onFollowUp={() => {}}
    />
  );
  const rendered = render(renderCard(c));
  return {
    rerender: (next: Annotation) => {
      act(() => {
        rendered.rerender(renderCard(next));
      });
    },
  };
}

function streamText(annotationId: string, jobId: string, delta: string): void {
  act(() => {
    useReview.getState().applyEvent({ type: "text", jobId, annotationId, delta });
  });
}

function reseed(annotations: Annotation[]): void {
  act(() => {
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations });
  });
}

beforeEach(() => {
  vi.useRealTimers();
  try {
    localStorage.removeItem("unvibe:no-stream-paragraphs");
  } catch {
    // ignore (no storage in this env)
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
  try {
    localStorage.removeItem("unvibe:no-stream-paragraphs");
  } catch {
    // ignore
  }
});

describe("provisional streamed paragraphs", () => {
  test("a completed paragraph renders while the turn fills, marked as still writing", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    streamText("ann_stream", "job-1", "First paragraph is done.\n\nSecond, still");
    const exp = document.querySelector(".exp-b.streaming")!;
    expect(exp).not.toBeNull();
    expect(exp.textContent).toContain("First paragraph is done.");
    expect(exp.textContent).not.toContain("Second, still");
    expect(screen.getByText("Still writing…")).toBeInTheDocument();
    // The fixed working label stays alongside the streamed content.
    expect(document.querySelector(".working")).not.toBeNull();
  });

  test("half sentences never show: no completed paragraph, no provisional", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    streamText("ann_stream", "job-1", "Half a sent");
    expect(document.querySelector(".exp-b.streaming")).toBeNull();
    expect(document.querySelector(".exp-b")?.textContent ?? "").not.toContain("Half a sent");
  });

  test("the stored turn replaces the provisional content and clears the stream", () => {
    const c = card();
    seedSnapshot([c]);
    const { rerender } = show(c);
    streamText("ann_stream", "job-1", "First paragraph is done.\n\nSecond, still");
    expect(document.querySelector(".exp-b.streaming")).not.toBeNull();
    // The done patch lands validated blocks; provisional vanishes.
    // (Parents pass the fresh annotation from the store; the test
    // re-renders with it, like a snapshot patch does.)
    const stored = card({
      turns: [
        turn("ans_1", {
          blocks: [
            { type: "paragraph", id: "b1", text: { standard: "Final validated answer." }, citations: [] },
          ],
          working: null,
        }),
      ],
    });
    reseed([stored]);
    rerender(stored);
    expect(document.querySelector(".exp-b.streaming")).toBeNull();
    expect(document.querySelector(".exp-b")?.textContent ?? "").toContain("Final validated answer.");
    expect(document.querySelector(".exp-b")?.textContent ?? "").not.toContain("First paragraph is done.");
    expect(useReview.getState().streams["ann_stream"]).toBeUndefined();
  });

  test("a turn error replaces the provisional content (retry path intact)", () => {
    const c = card();
    seedSnapshot([c]);
    const { rerender } = show(c);
    streamText("ann_stream", "job-1", "First paragraph is done.\n\nSecond, still");
    expect(document.querySelector(".exp-b.streaming")).not.toBeNull();
    const failed = card({
      turns: [turn("ans_1", { working: null, error: "rate limited" })],
    });
    reseed([failed]);
    rerender(failed);
    expect(document.querySelector(".exp-b.streaming")).toBeNull();
    expect(document.querySelector("[role='alert']")).not.toBeNull();
    expect(useReview.getState().streams["ann_stream"]).toBeUndefined();
  });

  test("a new attempt (repair or retry) starts a clean buffer", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    streamText("ann_stream", "job-1", "First paragraph is done.\n\nSecond, still");
    expect(document.querySelector(".exp-b.streaming")).not.toBeNull();
    // Repair streams under a new job id: the old provisional is replaced,
    // never appended to.
    streamText("ann_stream", "job-2", "Repaired opening.\n\nRest");
    const exp = document.querySelector(".exp-b.streaming")!;
    expect(exp.textContent).toContain("Repaired opening.");
    expect(exp.textContent).not.toContain("First paragraph is done.");
  });

  test("the kill switch restores all-at-once answers", () => {
    try {
      localStorage.setItem("unvibe:no-stream-paragraphs", "1");
    } catch {
      // ignore
    }
    expect(streamingEnabled()).toBe(false);
    const c = card();
    seedSnapshot([c]);
    show(c);
    streamText("ann_stream", "job-1", "First paragraph is done.\n\nSecond, still");
    expect(document.querySelector(".exp-b.streaming")).toBeNull();
    expect(document.querySelector(".exp-b")?.textContent ?? "").not.toContain("First paragraph");
  });

  test("provisional citations render inside the pending wrapper", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    streamText("ann_stream", "job-1", "The helper replaces each fold. [[diff:conn:82]]\n\nMore coming");
    const exp = document.querySelector(".exp-b.streaming")!;
    expect(exp.textContent).toContain("The helper replaces each fold.");
    // Without a snapshot file the citation carries no chip; the pending
    // treatment is the wrapper itself (CSS dims chips when they resolve).
    expect(exp.classList.contains("streaming")).toBe(true);
  });
});
