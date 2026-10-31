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
import { MemoryRouter } from "react-router";
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
  const r = render(
    <MemoryRouter>
      <DiffView reviewId="demo" />
    </MemoryRouter>,
  );
  await screen.findByText("connection.py", {}, { timeout: 3000 });
  return r;
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";

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
    // The level lives on the hunk dot's own tooltip instead, and the
    // dot is an indicator, not a filter button (#325).
    const dot = document.querySelector('.dhunk-h .score-ind[data-score="substantive"]');
    expect(dot?.getAttribute("data-tip")).toBe("Substantive");
    // Owner follow-up (#325): the dot alone is visible — the level name
    // lives in the tooltip and the accessible name, not beside the dot.
    expect(dot?.getAttribute("aria-label")).toBe("Substantive");
    expect(dot?.textContent).toBe("");
    expect(document.querySelector("[data-scorepick]")).toBeNull();
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

  it("hides by score from the hide-level selector, with tooltip counts (#325)", async () => {
    await renderDiff();
    expect(document.querySelector("[data-scorepick]")).toBeNull();
    const selector = screen.getByRole("button", { name: /Hide level:/ });
    expect(selector.getAttribute("data-tip")).toBe("Hiding 3 of 8 hunks: 3 uninteresting");
    await fireEvent.click(selector);
    const listbox = screen.getByRole("listbox", { name: "Hide level" });
    expect(listbox.querySelectorAll('[role="option"]')).toHaveLength(5);
    expect(document.querySelector('[data-hidelevel="routine"] .score-dot')?.getAttribute("data-score")).toBe("routine");
    await fireEvent.click(document.querySelector('[data-hidelevel="substantive"]') as HTMLElement);
    expect(useReview.getState().snapshot?.viewPrefs.hideLevel).toBe("substantive");
    expect(document.getElementById(`F-${CONN}`)).not.toBeNull();
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    // Mechanical/routine hunks now sit in hidden rows: tconn run,
    // socket-level first hunk, and the changelog.
    expect(document.querySelectorAll("button.hid")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Hide level:/ }).getAttribute("data-tip")).toMatch(/^Hiding \d+ of 8 hunks:/);
    // Needs attention keeps the guide-cited connection hunk visible.
    await fireEvent.click(screen.getByRole("button", { name: /Hide level:/ }));
    await fireEvent.click(document.querySelector('[data-hidelevel="needs-attention"]') as HTMLElement);
    expect(document.querySelector(`[data-hunk="${CONN}:0"]`)).not.toBeNull();
    expect(screen.getByRole("button", { name: /Hide level:/ }).getAttribute("data-tip")).toContain("kept because cited");
  });

  it("combines plotline and hide level", async () => {
    await renderDiff();
    await fireEvent.click(document.querySelector('[data-plotpick="unfold-tests"]') as HTMLElement);
    // The import-only run in the tests file is unfold-tests too, so its
    // hidden row stays while Hide uninteresting is on.
    expect(document.querySelectorAll("button.hid")).toHaveLength(1);
    expect(document.getElementById(`F-${CONN}`)).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: /Hide level:/ }));
    await fireEvent.click(document.querySelector('[data-hidelevel="substantive"]') as HTMLElement);
    // Only the socket-level test hunk is unfold-tests + substantive.
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    expect(useReview.getState().snapshot?.diffFilter).toEqual({ plotline: "unfold-tests" });
    expect(useReview.getState().snapshot?.viewPrefs.hideLevel).toBe("substantive");
    // The test-connection hunks are below the level: one hidden row.
    expect(document.querySelectorAll("button.hid")).toHaveLength(1);
    expect(document.querySelector(`[data-hunk="${TSOCK}:1"]`)).not.toBeNull();
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
