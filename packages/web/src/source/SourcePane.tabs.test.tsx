/**
 * Description tab naming (issue #86, finding 22): "Commits" for a
 * branch review (no PR), "PR description" for a PR review.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import type { ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { SourcePane } from "./SourcePane.js";

function seed(prNumber?: number): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: {
      id: "r1",
      repoId: "r",
      branch: "b",
      ...(prNumber !== undefined ? { prNumber } : {}),
      versions: [],
      currentVersion: 1,
      createdAt: 0,
    },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    description: {
      html: '<div class="desc"><p class="para" id="d-p1">Body.</p></div>',
      rev: "1",
      source: prNumber === undefined ? "commits" : "pr",
      editable: false,
    },
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function renderPane(): void {
  render(
    <MemoryRouter initialEntries={["/review/r1"]}>
      <Routes>
        <Route path="/review/:reviewId/*" element={<SourcePane reviewId="r1" tab="desc" onTab={() => {}} />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useReview.getState().clear();
});

describe("SourcePane description tab (finding 22)", () => {
  it("reads PR description for a PR review", () => {
    seed(12);
    renderPane();
    expect(screen.getByRole("tab", { name: "PR description" })).toBeInTheDocument();
  });

  it("reads Commits for a branch review", () => {
    seed();
    renderPane();
    expect(screen.getByRole("tab", { name: "Commits" })).toBeInTheDocument();
  });
});
