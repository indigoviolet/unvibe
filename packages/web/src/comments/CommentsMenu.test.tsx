/**
 * Comments menu "Already on GitHub" section (issues #168, #183): the
 * section follows the diff's show/hide setting — hidden collapses it to
 * its heading with a count and a click shows them again; while shown,
 * the heading folds the section alone, remembered in the view settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { CommentsMenu } from "./CommentsMenu.js";

// The view PATCH applies straight to the store snapshot, as the server
// echo would; everything else the menu touches is unused here.
vi.mock("../api/client.js", async () => {
  const { useReview: useStore } = await import("../state/store.js");
  return {
    api: {
      updateView: async (_id: string, body: Partial<ReviewSnapshot["viewPrefs"]>) => {
        const s = useStore.getState().snapshot;
        if (s) useStore.getState().setSnapshot({ ...s, viewPrefs: { ...s.viewPrefs, ...body } });
        return { ok: true };
      },
      updateComment: async () => ({ ok: true }),
      prComments: async () => ({ comments: [] }),
    },
    friendlyError: (e: unknown) => String(e),
  };
});

function snapshot(viewPrefs: ReviewSnapshot["viewPrefs"]): ReviewSnapshot {
  return {
    review: { id: "demo" },
    pages: [],
    files: [],
    annotations: [],
    jobs: [],
    existingComments: [
      {
        id: 1,
        path: "src/example.py",
        line: 3,
        side: "RIGHT",
        body: "A made-up existing comment.",
        bodyHtml: "<p>A made-up existing comment.</p>",
        author: "teammate",
        htmlUrl: "https://example.invalid/comment/1",
      },
    ],
    viewPrefs,
  } as unknown as ReviewSnapshot;
}

function renderMenu(prefs: ReviewSnapshot["viewPrefs"]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot(snapshot(prefs));
  render(
    <MemoryRouter>
      <CommentsMenu reviewId="demo" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Comments/ }));
}

beforeEach(() => {
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("Already on GitHub section", () => {
  it("hidden: heading carries the count; clicking shows the list and the setting", async () => {
    renderMenu({ showExistingComments: false, existingCommentsCollapsed: false });
    expect(screen.getByText("Already on GitHub · 1 hidden")).toBeVisible();
    expect(screen.queryByText("A made-up existing comment.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Already on GitHub/ }));
    await waitFor(() => expect(screen.getByText("A made-up existing comment.")).toBeVisible());
    expect(useReview.getState().snapshot?.viewPrefs.showExistingComments).toBe(true);
  });

  it("shown: the heading folds the section alone, remembered in the view settings", async () => {
    renderMenu({ showExistingComments: true, existingCommentsCollapsed: false });
    expect(screen.getByText("A made-up existing comment.")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Already on GitHub/ }));
    await waitFor(() => expect(screen.queryByText("A made-up existing comment.")).not.toBeInTheDocument());
    // Show/hide is untouched: only the menu section folded.
    expect(useReview.getState().snapshot?.viewPrefs).toEqual({
      showExistingComments: true,
      existingCommentsCollapsed: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /Already on GitHub/ }));
    await waitFor(() => expect(screen.getByText("A made-up existing comment.")).toBeVisible());
  });
});
