/**
 * Pinned conversation cards (issue #204, revising #167): Explain/Ask
 * cards open pinned inline in the flow; there is no floating open state
 * and no pin/unpin control. Floating survives only as the hover peek on
 * a closed card's mark (HoverPopover). Close collapses to the mark and
 * Delete removes the card (the mark goes with its annotation).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { ExpansionCard } from "./ExpansionCard.js";

const REVIEW_ID = "pinned-card-test";

function para(id: string, text: string): Record<string, unknown> {
  return { type: "paragraph", id, text: { standard: text }, citations: [] };
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
    id: "ann_pin",
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
    pinned: true,
    messages: [],
    post: false,
    turns: [turn("ans_1")],
    ...over,
  } as unknown as Annotation;
}

function hunkCard(): Annotation {
  return card({
    id: "ann_hunk",
    anchor: {
      host: { kind: "hunk", fileKey: "conn", contentHash: "abc123" },
      quotedText: "summary text",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
  });
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

function show(c: Annotation): void {
  render(
    <ExpansionCard
      reviewId={REVIEW_ID}
      expansion={c}
      lookupPage={() => undefined}
      onOpenPage={() => {}}
      onFollowUp={() => {}}
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

describe("pinned conversation card (#204)", () => {
  test("an open card renders inline with no pin or unpin control", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    const section = document.getElementById("B-ann_pin")!;
    expect(section.className).not.toContain("floating");
    expect(section.parentElement?.className).not.toBe("exp-float");
    expect(screen.queryByRole("button", { name: /Pin into the page|Unpin/ })).toBeNull();
  });

  test("a card stored unpinned (pre-#204 data) also renders inline when open", () => {
    const c = card({ pinned: false });
    seedSnapshot([c]);
    show(c);
    const section = document.getElementById("B-ann_pin")!;
    expect(section.className).not.toContain("floating");
    expect(section.parentElement?.className).not.toBe("exp-float");
    expect(screen.queryByRole("button", { name: /Pin into the page|Unpin/ })).toBeNull();
  });

  test("a collapsed card is inline too and keeps its expand control", () => {
    const c = card({ collapsed: true });
    seedSnapshot([c]);
    show(c);
    expect(document.getElementById("B-ann_pin")!.className).not.toContain("floating");
    expect(screen.getByRole("button", { name: "Expand" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Pin into the page|Unpin/ })).toBeNull();
  });

  test("a hunk-hosted card is inline with no pin control", () => {
    const c = hunkCard();
    seedSnapshot([c]);
    show(c);
    const section = document.getElementById("B-ann_hunk")!;
    expect(section.className).not.toContain("floating");
    expect(screen.queryByRole("button", { name: /Pin into the page|Unpin/ })).toBeNull();
  });

  test("× closes the card (it collapses back to its mark)", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "close", annotationId: "ann_pin" });
  });

  test("Delete removes the card through the delete action", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "delete", targetId: "ann_pin" });
  });
});
