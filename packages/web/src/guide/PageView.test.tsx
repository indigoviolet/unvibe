/**
 * Default guide title display (issue #102): a root page whose stored title
 * is the legacy "Guided review" shows "Guide", like a new review does.
 */
import { afterEach, describe, expect, test } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Page, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { PageView } from "./PageView.js";

afterEach(() => {
  useReview.getState().clear();
  cleanup();
});

function show(title: string): void {
  const page: Page = { id: "root", kind: "root", title, saved: false, cards: [] };
  useReview.getState().setSnapshot({
    review: { id: "title-test", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [page],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
  render(
    <MemoryRouter>
      <PageView
        reviewId="title-test"
        page={page}
        lookupPage={(id) => (id === "root" ? page : undefined)}
        onOpenPage={() => {}}
        onJumpToCard={() => {}}
      />
    </MemoryRouter>,
  );
}

describe("default guide title display", () => {
  test("legacy stored 'Guided review' shows as 'Guide'", () => {
    show("Guided review");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guide");
  });

  test("new stored 'Guide' shows as 'Guide'", () => {
    show("Guide");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guide");
  });

  test("a real title is shown unchanged", () => {
    show("Unfold obsolete folded response headers");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Unfold obsolete folded response headers",
    );
  });
});
