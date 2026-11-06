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
    expect(chips.filter((c) => /^\d+\/\d+$/.test(c))).toHaveLength(3);
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

  it("#324 shares sum to the total, Other included, hidden hunks counted", async () => {
    const snap = await mockApi.review("demo");
    const total = snap.files.reduce((n, f) => n + f.hunks.length, 0);
    expect(total).toBeGreaterThan(0);
    await renderRoot();
    const box = document.querySelector(".plotlines")!;
    const shares = [...box.querySelectorAll(".ui-row .ui-badge")]
      .map((el) => el.textContent ?? "")
      .filter((c) => /^\d+\/\d+$/.test(c))
      .map((c) => c.split("/").map(Number) as [number, number]);
    expect(shares).toHaveLength(3); // two plotlines + Other
    for (const [, den] of shares) expect(den).toBe(total);
    expect(shares.reduce((n, [num]) => n + num, 0)).toBe(total);
    // One stacked bar, segments in row order summing to full width.
    const segs = [...box.querySelectorAll(".plshare-seg")] as HTMLElement[];
    expect(segs).toHaveLength(3);
    expect(box.querySelector(".plshare")).toHaveAttribute("aria-label", expect.stringContaining(`of ${total}`));
  });

  it("#324 without Other, shares still sum to the total", async () => {
    const snap = await mockApi.review("demo");
    const first = snap.plotlines![0]!.id;
    snap.hunkStates = snap.hunkStates.map((s) => ({ ...s, plotline: first }));
    const covered = new Set(snap.hunkStates.map((s) => s.contentHash));
    for (const f of snap.files)
      for (const h of f.hunks)
        if (!covered.has(h.contentHash))
          snap.hunkStates.push({ contentHash: h.contentHash, folded: false, reviewed: false, plotline: first });
    const total = snap.files.reduce((n, f) => n + f.hunks.length, 0);
    useReview.getState().setSnapshot(snap);
    const root = snap.pages.find((p) => p.kind === "root")!;
    const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
      useReview.getState().snapshot?.pages.find((p) => p.id === id);
    render(
      <MemoryRouter>
        <PageView reviewId="demo" page={root} lookupPage={lookupPage} onOpenPage={() => {}} onJumpToCard={() => {}} />
      </MemoryRouter>,
    );
    const box = document.querySelector(".plotlines")!;
    expect(box.textContent).not.toContain("Other");
    const shares = [...box.querySelectorAll(".ui-row .ui-badge")]
      .map((el) => el.textContent ?? "")
      .filter((c) => /^\d+\/\d+$/.test(c))
      .map((c) => c.split("/").map(Number) as [number, number]);
    expect(shares.length).toBeGreaterThan(0);
    expect(shares.reduce((n, [num]) => n + num, 0)).toBe(total);
  });

  describe("plotline reviewed (#343)", () => {
    const plotBox = (id: string): HTMLInputElement =>
      document.querySelector(`[data-plotreviewed="${id}"]`) as HTMLInputElement;

    it("starts unchecked, partial, unchecked across the three rows", async () => {
      await renderRoot();
      const unfold = plotBox("unfold");
      expect(unfold).not.toBeChecked();
      expect(unfold.indeterminate).toBe(false);
      expect(unfold).toHaveAttribute("aria-label", "Mark plotline reviewed");
      const tests = plotBox("unfold-tests");
      expect(tests).not.toBeChecked();
      expect(tests.indeterminate).toBe(true);
      const other = plotBox("other");
      expect(other).not.toBeChecked();
      expect(other.indeterminate).toBe(false);
    });

    it("checking a plotline marks its hunks reviewed and folded without filtering", async () => {
      await renderRoot();
      // Drain any reveal an earlier test queued; the check itself queues none.
      takePendingReveal();
      await fireEvent.click(plotBox("unfold"));
      await vi.waitFor(() => {
        expect(plotBox("unfold")).toBeChecked();
      });
      expect(plotBox("unfold")).toHaveAttribute("aria-label", "Mark plotline unreviewed");
      const snap = useReview.getState().snapshot!;
      const unfoldHashes = new Set(
        snap.files
          .filter((f) => f.path === "src/urllib3/connection.py")
          .flatMap((f) => f.hunks.map((h) => h.contentHash)),
      );
      expect(unfoldHashes.size).toBeGreaterThan(0);
      for (const s of snap.hunkStates) {
        if (unfoldHashes.has(s.contentHash)) {
          expect(s.reviewed).toBe(true);
          expect(s.folded).toBe(true);
        }
      }
      // The row's filter action is untouched: no filter set, no jump queued.
      expect(snap.diffFilter?.plotline).toBeUndefined();
      expect(takePendingReveal()).toBeNull();
    });

    it("unchecking reverts reviewed and folded", async () => {
      await renderRoot();
      await fireEvent.click(plotBox("unfold"));
      await vi.waitFor(() => {
        expect(plotBox("unfold")).toBeChecked();
      });
      await fireEvent.click(plotBox("unfold"));
      await vi.waitFor(() => {
        expect(plotBox("unfold")).not.toBeChecked();
      });
      const snap = useReview.getState().snapshot!;
      for (const s of snap.hunkStates.filter((x) => x.plotline === "unfold")) {
        expect(s.reviewed).toBe(false);
        expect(s.folded).toBe(false);
      }
    });

    it("unmarking one hunk of a checked plotline shows partial", async () => {
      await renderRoot();
      await fireEvent.click(plotBox("unfold"));
      await vi.waitFor(() => {
        expect(plotBox("unfold")).toBeChecked();
      });
      const snap = useReview.getState().snapshot!;
      const hash = snap.files.find((f) => f.path === "src/urllib3/connection.py")!.hunks[0]!.contentHash;
      await mockApi.updateHunk("demo", hash, { reviewed: false, folded: false });
      await vi.waitFor(() => {
        expect(plotBox("unfold").indeterminate).toBe(true);
      });
      expect(plotBox("unfold")).not.toBeChecked();
      expect(plotBox("unfold")).toHaveAttribute("aria-label", "Mark plotline reviewed");
    });

    it("Other marks its unclaimed hunks", async () => {
      await renderRoot();
      await fireEvent.click(plotBox("other"));
      await vi.waitFor(() => {
        expect(plotBox("other")).toBeChecked();
      });
      const snap = useReview.getState().snapshot!;
      const others = snap.hunkStates.filter((x) => (x.plotline ?? "other") === "other");
      expect(others.length).toBeGreaterThan(0);
      for (const s of others) {
        expect(s.reviewed).toBe(true);
        expect(s.folded).toBe(true);
      }
    });

    it("disables with the read-only tooltip on older versions", async () => {
      window.history.replaceState({}, "", "/review/demo?version=2");
      try {
        await renderRoot();
        for (const id of ["unfold", "unfold-tests", "other"]) {
          const box = plotBox(id);
          expect(box).toBeDisabled();
          expect(box).toHaveAttribute("aria-label", "Viewing an older version · read-only");
        }
      } finally {
        window.history.replaceState({}, "", "/");
      }
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
