/**
 * Plotlines on the guide root (issue #169): the reader's named threads
 * sit between Contents and the cards, each jumping to its first hunk.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useReview } from "../state/store.js";
import { mockApi, resetMockState, setMockLatency } from "../mock/index.js";
import { takePendingReveal } from "../source/diff/revealSource.js";
import { PageView } from "./PageView.js";

// jsdom has no matchMedia (as in DiagramView.test).
Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  configurable: true,
  writable: true,
});

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  setMockLatency(0);
  useReview.getState().clear();
});

afterEach(() => {
  setMockLatency(null);
  cleanup();
});

async function renderRoot() {
  const snap = await mockApi.review("demo");
  useReview.getState().setSnapshot(snap);
  const root = snap.pages.find((p) => p.kind === "root")!;
  const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
    useReview.getState().snapshot?.pages.find((p) => p.id === id);
  render(
    <MemoryRouter>
      <PageView reviewId="demo" page={root} lookupPage={lookupPage} onOpenPage={() => {}} onJumpToCard={() => {}} />
    </MemoryRouter>,
  );
}

describe("PageView plotlines", () => {
  it("lists the reader plotlines plus Other with hunk counts", async () => {
    await renderRoot();
    const box = document.querySelector(".plotlines");
    expect(box).not.toBeNull();
    expect(box?.textContent).toContain("Unfold folded values");
    expect(box?.textContent).toContain("Tests for unfolding");
    expect(box?.textContent).toContain("Other");
    // Two plotlines + Other.
    expect(box?.querySelectorAll("li")).toHaveLength(3);
  });

  it("jumps to the plotline's first hunk", async () => {
    await renderRoot();
    const box = document.querySelector(".plotlines")!;
    const first = box.querySelectorAll("li button")[0];
    expect(first.textContent).toContain("Unfold folded values");
    await fireEvent.click(first);
    const ref = takePendingReveal();
    expect(ref).toMatch(/^diff:src-urllib3-connection\.py:\d+$/);
  });

  it("stays off finding pages", async () => {
    const snap = await mockApi.review("demo");
    useReview.getState().setSnapshot(snap);
    const finding = snap.pages.find((p) => p.kind === "finding")!;
    const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
      useReview.getState().snapshot?.pages.find((p) => p.id === id);
    render(
      <MemoryRouter>
        <PageView reviewId="demo" page={finding} lookupPage={lookupPage} onOpenPage={() => {}} onJumpToCard={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Plotlines")).toBeNull();
  });
});
