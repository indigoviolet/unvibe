/**
 * Guide explain placeholder (issue #46): an explain started from a
 * selection on the block shows a placeholder where the expansion will
 * land, and only for explains (ask turns keep their composer).
 */
import { afterEach, describe, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { Card, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { GuideBlockThreads } from "./GuideThreads.js";

const REVIEW_ID = "threads-test";

function seedSnapshot(): void {
  useReview.getState().clear();
  const card = {
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
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", cards: [card] }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("GuideBlockThreads explain placeholder", () => {
  test("an explain entry shows a placeholder; clearing removes it", () => {
    seedSnapshot();
    render(<GuideBlockThreads reviewId={REVIEW_ID} cardId="c1" blockId="b1" />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => {
      useReview.getState().beginInflight("explain:block:b1", "explain");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Writing explanation…");
    act(() => {
      useReview.getState().clearInflight("explain:block:b1");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("card-qualified anchor spellings match too", () => {
    seedSnapshot();
    render(<GuideBlockThreads reviewId={REVIEW_ID} cardId="c1" blockId="b1" />);
    act(() => {
      useReview.getState().beginInflight("explain:block:c1#b1", "explain");
    });
    expect(screen.getByRole("status")).toHaveTextContent("Writing explanation…");
  });

  test("ask entries show no placeholder (the composer owns them)", () => {
    seedSnapshot();
    render(<GuideBlockThreads reviewId={REVIEW_ID} cardId="c1" blockId="b1" />);
    act(() => {
      useReview.getState().beginInflight("ask:block:b1", "ask");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
