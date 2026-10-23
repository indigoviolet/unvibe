/**
 * Plotlines on the guide root (issue #169): the reader's named threads
 * sit between Contents and the cards, each jumping to its first hunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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
    expect(box?.textContent).toContain("Prove the unfolding works");
    expect(box?.textContent).toContain("Other");
    // Builds-on for each thread, with no explanation line and no
    // why-separate text.
    expect(box?.textContent).toContain("Builds on Unfold folded values");
    expect(box?.querySelector(".plnote")).toBeNull();
    // #242: no numbering, titles in full; the hunk count rides a chip
    // in the same trailing slot on every row.
    expect(box?.querySelector(".plorder")).toBeNull();
    const names = [...(box?.querySelectorAll(".plname") ?? [])].map((el) => el.textContent ?? "");
    expect(names).toEqual(["Unfold folded values", "Prove the unfolding works", "Other"]);
    const chips = [...(box?.querySelectorAll(".ui-row .ui-badge") ?? [])].map((el) => el.textContent ?? "");
    expect(chips.filter((c) => /hunks?$/.test(c))).toHaveLength(3);
    // #242: chips are bordered pills (the outline Badge, which reads on
    // the sunk card), including the builds-on target.
    for (const chip of box?.querySelectorAll(".ui-badge") ?? []) {
      expect(chip).toHaveAttribute("data-tone", "outline");
    }
    // Two plotlines + Other.
    expect(box?.querySelectorAll("li")).toHaveLength(3);
  });

  it("builds-on chip goes to the earlier plotline", async () => {
    await renderRoot();
    const box = document.querySelector(".plotlines")!;
    const chip = box.querySelector('[data-buildson="unfold"]')!;
    expect(chip.textContent).toContain("Unfold folded values");
    await fireEvent.click(chip);
    await vi.waitFor(() => {
      expect(useReview.getState().snapshot?.diffFilter?.plotline).toBe("unfold");
    });
    const pending = takePendingReveal();
    expect(pending?.ref).toMatch(/^diff:src-urllib3-connection\.py:\d+$/);
    expect(pending?.keepFilters).toBe(true);
  });

  it("jumps to the plotline's first hunk", async () => {
    await renderRoot();
    const box = document.querySelector(".plotlines")!;
    const first = box.querySelector('[data-plotpick="unfold"]')!;
    expect(first.textContent).toContain("Unfold folded values");
    await fireEvent.click(first);
    const pending = takePendingReveal();
    expect(pending?.ref).toMatch(/^diff:src-urllib3-connection\.py:\d+$/);
    // A plotline pick is a filter action: the jump keeps other filters.
    expect(pending?.keepFilters).toBe(true);
  });

  it("filters the diff to the plotline and reveals its first hunk", async () => {
    await renderRoot();
    const box = document.querySelector(".plotlines")!;
    const first = box.querySelector('[data-plotpick="unfold"]')!;
    await fireEvent.click(first);
    // The stored filter is set (DiffView echoes it) and the reveal queued.
    await vi.waitFor(() => {
      expect(useReview.getState().snapshot?.diffFilter?.plotline).toBe("unfold");
    });
    expect(first).toHaveAttribute("aria-pressed", "true");
    // Clicking the active entry again clears the filter.
    await fireEvent.click(first);
    await vi.waitFor(() => {
      expect(useReview.getState().snapshot?.diffFilter?.plotline).toBeUndefined();
    });
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
