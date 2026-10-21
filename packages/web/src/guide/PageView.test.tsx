/**
 * Default guide title display (issue #102): a root page whose stored title
 * is the default "Guide" shows "Guide".
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
  test("stored 'Guide' shows as 'Guide'", () => {
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

describe("page header bookmark (#118)", () => {
  test("a page with no type label has no eyebrow row; the bookmark sits on the title line", () => {
    show({ id: "root", kind: "root", title: "Guide", saved: false, cards: [] } as Page);
    expect(document.querySelector(".eyebrow")).toBeNull();
    const row = document.querySelector(".title-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector("h1.title")).toHaveTextContent("Guide");
    const save = screen.getByRole("button", { name: "Save to this repo" });
    expect(row?.contains(save)).toBe(true);
    expect(save).toHaveAttribute("aria-pressed", "false");
    expect(save).toHaveAttribute("data-save", "root");
  });

  test("a finding page keeps its type label above the title row", () => {
    show({
      id: "f-1",
      kind: "finding",
      title: "A finding",
      saved: false,
      confidence: "medium",
      cards: [],
    } as unknown as Page);
    expect(document.querySelector(".eyebrow")).toHaveTextContent("Agent finding · medium confidence");
    const row = document.querySelector(".title-row");
    expect(row?.querySelector("h1.title")).toHaveTextContent("A finding");
    expect(row?.contains(screen.getByRole("button", { name: "Save to this repo" }))).toBe(true);
  });

  test("a saved page keeps the pressed bookmark state and label", () => {
    show({ id: "c-x", kind: "concept", title: "A concept", saved: false, cards: [] } as Page);
    const save = screen.getByRole("button", { name: "Unsave from this repo" });
    expect(save).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".title-row")?.contains(save)).toBe(true);
  });
});
