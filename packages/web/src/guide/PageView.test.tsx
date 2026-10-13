/**
 * Default guide title display (issue #102): a root page whose stored title
 * is the legacy "Guided review" shows "Guide", like a new review does.
 *
 * Card error boundaries (issue #101): a component that throws inside one
 * card shows that card's fallback and leaves the other cards rendered.
 * The throw below is a real `CardView` render failure (missing
 * follow-up items), not a mock.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Card, Page, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { PageView } from "./PageView.js";

const REVIEW_ID = "page-test";

function seedSnapshot(page: Page): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
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
}

function show(page: Page): void {
  seedSnapshot(page);
  render(
    <MemoryRouter>
      <PageView
        reviewId={REVIEW_ID}
        page={page}
        lookupPage={(id) => (id === "root" ? page : undefined)}
        onOpenPage={() => {}}
        onJumpToCard={() => {}}
      />
    </MemoryRouter>,
  );
}

function card(id: string, title: string): Card {
  return {
    id,
    pageId: "root",
    title,
    level: "standard",
    read: false,
    collapsed: false,
    revision: 1,
    blocks: [{ type: "paragraph", id: `b-${id}`, text: { standard: `Text of ${title}.` }, citations: [] }],
    undoStack: [],
  } as unknown as Card;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  vi.restoreAllMocks();
});

describe("default guide title display", () => {
  test("legacy stored 'Guided review' shows as 'Guide'", () => {
    show({ id: "root", kind: "root", title: "Guided review", saved: false, cards: [] } as Page);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guide");
  });

  test("new stored 'Guide' shows as 'Guide'", () => {
    show({ id: "root", kind: "root", title: "Guide", saved: false, cards: [] } as Page);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Guide");
  });

  test("a real title is shown unchanged", () => {
    show({
      id: "root",
      kind: "root",
      title: "Unfold obsolete folded response headers",
      saved: false,
      cards: [],
    } as Page);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Unfold obsolete folded response headers",
    );
  });
});

describe("PageView card boundaries", () => {
  test("a throw in one card leaves the other cards rendered", () => {
    const good1 = card("c1", "First card");
    // `linkedPages` ignores follow-up blocks but `BlockView` reads
    // `items.length`, so this throws inside `CardView`, not above it.
    const bad = {
      ...card("c2", "Second card"),
      blocks: [{ type: "follow-up", id: "b-c2", items: undefined }],
    } as unknown as Card;
    const good3 = card("c3", "Third card");
    show({
      id: "root",
      kind: "root",
      title: "Root",
      saved: false,
      cards: [good1, bad, good3],
    } as unknown as Page);
    // The good cards render as before (once in Contents, once as the
    // card itself)…
    expect(screen.getAllByText("First card")).toHaveLength(2);
    expect(screen.getAllByText("Third card")).toHaveLength(2);
    expect(screen.getByText("Text of First card.")).toBeInTheDocument();
    expect(screen.getByText("Text of Third card.")).toBeInTheDocument();
    // …and the broken one shows a card-sized notice with a retry.
    expect(screen.getByText("Couldn't show this card: something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // No raw stack leaks into the page.
    expect(document.body.textContent).not.toMatch(/TypeError/);
  });
});
