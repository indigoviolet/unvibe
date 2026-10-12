/**
 * Guide-page error boundary (issue #101): a throw in the page view shows a
 * guide-sized notice (the version switcher above it survives) and the
 * boundary resets when the review changes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { GuidePage } from "./GuidePage.js";

let failPage = true;

vi.mock("./PageView.js", () => ({
  PageView: () => {
    if (failPage) throw new Error("page boom");
    return <div>page ok</div>;
  },
}));

const REVIEW_ID = "guide-boundary-test";

function snapshot(): ReviewSnapshot {
  return {
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot;
}

beforeEach(() => {
  failPage = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(api, "review").mockResolvedValue(snapshot());
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  vi.restoreAllMocks();
});

function renderGuide(reviewId: string): void {
  render(
    <MemoryRouter initialEntries={[`/review/${reviewId}`]}>
      <GuidePage reviewId={reviewId} />
    </MemoryRouter>,
  );
}

describe("GuidePage boundary", () => {
  test("a throw in the page view shows the guide fallback", async () => {
    renderGuide(REVIEW_ID);
    expect(await screen.findByText("Couldn't show the guide: something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/page boom/);
  });

  test("the boundary resets when the review changes", async () => {
    renderGuide(REVIEW_ID);
    expect(await screen.findByText("Couldn't show the guide: something went wrong")).toBeInTheDocument();
    cleanup();
    failPage = false;
    renderGuide("another-review");
    expect(await screen.findByText("page ok")).toBeInTheDocument();
  });
});
