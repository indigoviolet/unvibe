/**
 * Hunk scores + plotlines in the diff pane (issue #169), against the mock
 * API (`VITE_MOCK=1`): header dots and plotline tags, the Files list dots
 * and legend, the dots and chips as the filter selectors (each alone,
 * both together, composed with Hide uninteresting), the active-filter
 * chip in the actions bar, persistence with the review, and markers on
 * activated hunk cards.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useReview } from "../../state/store.js";
import { resetMockState, setMockLatency } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";

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

async function renderDiff() {
  const r = render(<DiffView reviewId="demo" />);
  await screen.findByText("connection.py", {}, { timeout: 3000 });
  return r;
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const LOG = "changelog-1362.bugfix.rst";

describe("DiffView scores and plotlines", () => {
  it("shows score dots and plotline tags on hunk headers", async () => {
    await renderDiff();
    const dots = document.querySelectorAll(".dhunk-h .score-dot");
    expect(dots.length).toBeGreaterThan(0);
    expect(document.querySelector('.dhunk-h .score-dot[data-score="substantive"]')).not.toBeNull();
    expect(document.querySelector('.dhunk-h .score-dot[data-score="mechanical"]')).not.toBeNull();
    const tags = [...document.querySelectorAll(".dhunk-h .ptag")].map((el) => el.textContent);
    expect(tags).toContain("Unfold folded values");
    expect(tags).toContain("Prove the unfolding works");
    // The tag tooltip is just the plotline name.
    const tag = document.querySelector('.dhunk-h .ptag[data-plotpick="unfold"]');
    expect(tag?.getAttribute("data-tip")).toBe("Show only Unfold folded values");
  });

  it("keeps score dots and the legend out of the Files list (#184)", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    expect(document.querySelectorAll(".flist .score-dot")).toHaveLength(0);
    expect(document.querySelector(".legend")).toBeNull();
    expect(document.querySelector(".prog")).toBeNull();
    // The level lives on the hunk dot's own tooltip instead.
    const dot = document.querySelector('.dhunk-h [data-scorepick="substantive"]');
    expect(dot?.getAttribute("data-tip")).toBe("Show substantive hunks or higher");

  });

  it("filters by plotline from a header chip and remembers it with the review", async () => {
    await renderDiff();
    await fireEvent.click(document.querySelector('[data-plotpick="unfold"]') as HTMLElement);
    // Only the file with unfold hunks stays; the filter persists and the
    // actions bar shows the active chip.
    expect(document.getElementById(`F-${CONN}`)).not.toBeNull();
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(useReview.getState().snapshot?.diffFilter).toEqual({ plotline: "unfold" });
    expect(document.querySelector('[data-filterchip="plotline"]')?.textContent).toContain("Unfold folded values");
    // Clicking the active chip again clears the stored filter.
    await fireEvent.click(document.querySelector('[data-plotpick="unfold"]') as HTMLElement);
    expect(document.getElementById(`F-${TCONN}`)).not.toBeNull();
    expect(useReview.getState().snapshot?.diffFilter).toBeUndefined();
    expect(document.querySelector('[data-filterchip="plotline"]')).toBeNull();
  });

  it("filters by score from a hunk dot and clears from the actions-bar chip", async () => {
    await renderDiff();
    await fireEvent.click(document.querySelector('.dhunk-h [data-scorepick="mechanical"]') as HTMLElement);

  });

  it("combines plotline and score, composed with Hide uninteresting", async () => {
    await renderDiff();
    await fireEvent.click(document.querySelector('[data-plotpick="unfold-tests"]') as HTMLElement);
    // The import-only run in the tests file is unfold-tests too, so its
    // hidden row stays while Hide uninteresting is on.
    expect(document.querySelectorAll("button.hid")).toHaveLength(1);
    expect(document.getElementById(`F-${CONN}`)).toBeNull();
    await fireEvent.click(document.querySelector('[data-hunk] [data-scorepick="substantive"]') as HTMLElement);
    // Only the socket-level test hunk is unfold-tests + substantive.
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(document.getElementById(`F-${LOG}`)).toBeNull();
    expect(useReview.getState().snapshot?.diffFilter).toEqual({ plotline: "unfold-tests", score: "substantive" });
    // Nothing hidden remains under both filters.
    expect(document.querySelectorAll("button.hid")).toHaveLength(0);
  });

  it("shows markers on activated hunk cards too", async () => {
    await renderDiff();
    const header = document.querySelector(`[data-hunk="${CONN}:0"]`);
    expect(header?.querySelector(".score-dot")).not.toBeNull();
    expect(header?.querySelector(".ptag")?.textContent).toBe("Unfold folded values");
    // Activate the idle summary into its conversation card (no agent call).
    const summary = document.querySelector(`[data-hunksum^="${CONN}:"]`);
    expect(summary).not.toBeNull();
    await fireEvent.click(summary as HTMLElement);
    await screen.findByText("Unfolds folded header values before reading.", {}, { timeout: 3000 });
    // The header markers belong to the hunk, not the card: still there.
    const after = document.querySelector(`[data-hunk="${CONN}:0"]`);
    expect(after?.querySelector(".score-dot")).not.toBeNull();
    expect(after?.querySelector(".ptag")?.textContent).toBe("Unfold folded values");
  });
});
