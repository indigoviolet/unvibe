// DISABLED(#188): covered by J1/J4
/**
 * Source-pane error boundary (issue #101): a throw in the tab body shows a
 * pane-sized notice while the tab bar stays usable.
 *
 * main-rc reconciliation: the seed is a PR review (prNumber set) so the
 * description tab keeps its "PR description" name under finding-22 naming
 * (issue #86); the "Commits" name for branch reviews is covered by
 * SourcePane.tabs.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { SourcePane } from "./SourcePane.js";

vi.mock("./diff/DiffView.js", () => ({
  DiffView: () => {
    throw new Error("diff boom");
  },
}));

const REVIEW_ID = "source-boundary-test";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", prNumber: 7, versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
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
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  vi.restoreAllMocks();
});

describe("SourcePane boundary", () => {
  test("a throw in the diff tab leaves the tab bar rendered", () => {
    render(
      <MemoryRouter>
        <SourcePane reviewId={REVIEW_ID} tab="diff" onTab={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Couldn't show the source pane: something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // The tabs survive, so the reader can switch to the description.
    expect(screen.getByRole("tab", { name: "PR description" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Diff" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/diff boom/);
  });
});
