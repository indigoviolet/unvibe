/**
 * Floating conversation cards (issue #167): clicked cards float above the
 * content by default, pinning inserts them inline, hunk-hosted cards stay
 * inline, and floating cards are keyboard reachable + closable.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { hunkIndexForLine } from "./DiffExpansions.js";
import { shouldFloatConversation } from "./cardFloat.js";
import { ExpansionCard } from "./ExpansionCard.js";

const REVIEW_ID = "float-card-test";

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
    id: "ann_float",
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

describe("shouldFloatConversation", () => {
  test("block, description and diff-line cards float when unpinned", () => {
    const hosts = [
      { kind: "block", blockId: "c1#b1" },
      { kind: "description", paragraphId: "p1" },
      { kind: "diff-line", fileKey: "conn", line: 82 },
    ] as const;
    for (const host of hosts) {
      expect(shouldFloatConversation({ id: "a", anchor: { host } } as never, false)).toBe(true);
    }
  });

  test("a pinned card never floats", () => {
    expect(
      shouldFloatConversation({ id: "a", anchor: { host: { kind: "block", blockId: "c1#b1" } } } as never, true),
    ).toBe(false);
  });

  test("a hunk-hosted card never floats, even unpinned", () => {
    expect(
      shouldFloatConversation(
        { id: "a", anchor: { host: { kind: "hunk", fileKey: "conn", contentHash: "h" } } } as never,
        false,
      ),
    ).toBe(false);
  });
});

describe("floating conversation card", () => {
  test("an open card floats by default, with a pin control", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    const section = document.getElementById("B-ann_float")!;
    expect(section.className).toContain("floating");
    // Zero-height placeholder: the card takes no space in the flow.
    expect(section.parentElement?.className).toBe("exp-float");
    const pin = screen.getByRole("button", { name: "Pin into the page" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
  });

  test("pin inserts the card inline; unpin returns it to floating", () => {
    const c = card();
    seedSnapshot([c]);
    show(c);
    fireEvent.click(screen.getByRole("button", { name: "Pin into the page" }));
    const section = document.getElementById("B-ann_float")!;
    expect(section.className).not.toContain("floating");
    expect(section.parentElement?.className).not.toBe("exp-float");
    const unpin = screen.getByRole("button", { name: /Unpin/ });
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(unpin);
    expect(document.getElementById("B-ann_float")!.className).toContain("floating");
    expect(screen.getByRole("button", { name: "Pin into the page" })).toBeDefined();
  });

  test("a collapsed card floats too and keeps its pin control", () => {
    const c = card({ collapsed: true });
    seedSnapshot([c]);
    show(c);
    expect(document.getElementById("B-ann_float")!.className).toContain("floating");
    expect(screen.getByRole("button", { name: "Pin into the page" })).toBeDefined();
  });

  test("a hunk-hosted card is inline with no pin control", () => {
    const c = hunkCard();
    seedSnapshot([c]);
    show(c);
    const section = document.getElementById("B-ann_hunk")!;
    expect(section.className).not.toContain("floating");
    expect(section.parentElement?.className).not.toBe("exp-float");
    expect(screen.queryByRole("button", { name: /Pin into the page|Unpin/ })).toBeNull();
  });

  test("× closes a floating card as today", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "close", annotationId: "ann_float" });
  });

  test("Escape closes a floating card, but not from its reply box", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    const section = document.getElementById("B-ann_float")!;
    fireEvent.keyDown(section, { key: "Escape" });
    expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "close", annotationId: "ann_float" });
    spy.mockClear();
    const box = screen.getByLabelText("Ask a follow-up");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("a pinned card has no Escape-to-close (× still works)", () => {
    const c = card();
    seedSnapshot([c]);
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true });
    show(c);
    fireEvent.click(screen.getByRole("button", { name: "Pin into the page" }));
    fireEvent.keyDown(document.getElementById("B-ann_float")!, { key: "Escape" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("hunkIndexForLine", () => {
  const file = {
    fileKey: "conn",
    hunks: [
      { newStart: 10, newEnd: 20, oldStart: 10, oldEnd: 18 },
      { newStart: 40, newEnd: 50, oldStart: 38, oldEnd: 48 },
    ],
  } as never;

  test("finds the hunk by new-side lines", () => {
    expect(hunkIndexForLine(file, 12)).toBe(0);
    expect(hunkIndexForLine(file, 45)).toBe(1);
  });

  test("falls back to the old-side range, then the first hunk", () => {
    // Old-side-only line inside the second hunk's old range but outside
    // every new range.
    const del = {
      fileKey: "conn",
      hunks: [{ newStart: 10, newEnd: 12, oldStart: 10, oldEnd: 20 }],
    } as never;
    expect(hunkIndexForLine(del, 18)).toBe(0);
    expect(hunkIndexForLine(file, 999)).toBe(0);
  });

  test("null with no hunks", () => {
    expect(hunkIndexForLine({ fileKey: "x", hunks: [] } as never, 5)).toBeNull();
  });
});
