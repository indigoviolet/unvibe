/**
 * Diff file-filter behaviour against the mock API (`VITE_MOCK=1`): split
 * out of DiffView.test.tsx (issue #119) so the parts run on separate
 * vitest workers. Name filter, stored prefs, active-state badge, dropdown
 * keyboard use.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

async function renderDiff(extra?: { lineSlots?: Record<string, React.ReactNode>; commentedLines?: ReadonlySet<string>; onLineClick?: (f: string, l: number) => void }) {
  const r = render(<DiffView reviewId="demo" lineSlots={extra?.lineSlots} commentedLines={extra?.commentedLines} onLineClick={extra?.onLineClick} />);
  await screen.findByText("connection.py", {}, { timeout: 3000 });
  return r;
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";


describe("DiffView file filters", () => {
  it("reviewed progress is the toolbar's bottom line with counts only in its label (#184)", async () => {
    await renderDiff();
    const bar = screen.getByRole("progressbar");
    // The demo seeds one reviewed hunk of eight.
    expect(bar).toHaveAttribute("aria-label", "1 of 8 hunks reviewed");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "8");
    expect(bar.getAttribute("data-tip")).toBe("1 of 8 hunks reviewed");
    const fill = bar.querySelector("i") as HTMLElement;
    expect(fill.style.width).toBe("12.5%");
    // No text line for it anywhere in the file list.
    expect(document.querySelector(".prog")).toBeNull();
  });

  it("filters files by name", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    const input = screen.getByLabelText("Filter files by name");
    await fireEvent.change(input, { target: { value: "socketlevel" } });
    expect(document.getElementById(`F-${CONN}`)).toBeNull();
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    // Header plus the files-panel tree row both name the file.
    expect(document.querySelectorAll(".fr:not(.dir)")).toHaveLength(1);
  });

  it("applies stored filter prefs (categories + hide reviewed) after the dropdown change", async () => {
    // Presentation change only: values stored by the old chips UI keep
    // working unchanged.
    localStorage.setItem(
      "unvibe.diff.prefs.v1",
      JSON.stringify({
        view: "unified",
        hideUninteresting: true,
        hideReviewed: true,
        cats: ["source"],
        filesOpen: false,
      }),
    );
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    // Only the source file shows; the tests/docs files are filtered out.
    expect(document.getElementById(`F-${CONN}`)).not.toBeNull();
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(document.getElementById(`F-${TSOCK}`)).toBeNull();
    // No count badge: the active state is aria-pressed (accent + dot),
    // and the tooltip stays action-only (#225).
    const filter = screen.getByRole("button", { name: /File filters/ });
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(filter.getAttribute("data-tip")).toBe("Filter files by type");
    expect(filter.querySelector("[data-filter-active]")).not.toBeNull();
    const reviewFilter = screen.getByRole("button", { name: /Review filters/ });
    expect(reviewFilter).toHaveAttribute("aria-pressed", "true");
    expect(reviewFilter.getAttribute("data-tip")).toBe("Reviewed and GitHub comment filters");
    expect(reviewFilter.querySelector("[data-filter-active]")).not.toBeNull();
    // Stored prefs survive the render untouched.
    const stored = JSON.parse(localStorage.getItem("unvibe.diff.prefs.v1") as string) as {
      hideReviewed: boolean;
      cats: string[];
    };
    expect(stored.hideReviewed).toBe(true);
    expect(stored.cats).toEqual(["source"]);
  });

  it("filter button shows its active state and toggles categories", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    const filter = screen.getByRole("button", { name: "File filters" });
    // Default: everything shown, no active state.
    expect(filter).toHaveAttribute("aria-pressed", "false");
    await fireEvent.click(filter);
    const menu = screen.getByRole("menu", { name: "File filters" });
    const tests = within(menu).getByRole("menuitemcheckbox", { name: /Tests/ });
    expect(tests).toHaveAttribute("aria-checked", "true");
    await fireEvent.click(tests);
    // Deselecting Tests filters its files and marks the button active.
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(document.getElementById(`F-${CONN}`)).not.toBeNull();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(filter.getAttribute("data-tip")).toBe("Filter files by type");
    expect(filter.querySelector("[data-filter-active]")).not.toBeNull();
    await fireEvent.click(tests);
    expect(document.getElementById(`F-${TCONN}`)).not.toBeNull();
    expect(filter).toHaveAttribute("aria-pressed", "false");
  });

  it("file filter menu is types-only and keyboard-usable; Reviewed lives in the review filter", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    const filter = screen.getByRole("button", { name: "File filters" });
    await fireEvent.click(filter);
    const menu = screen.getByRole("menu", { name: "File filters" });
    const rows = within(menu).getAllByRole("menuitemcheckbox");
    // File types only: no Reviewed, no GitHub comments (issue #184).
    expect(rows).toHaveLength(5);
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /Reviewed/ })).toBeNull();
    expect(within(menu).queryByRole("menuitemcheckbox", { name: /GitHub/ })).toBeNull();
    // ArrowDown moves focus down the rows.
    expect(document.activeElement).toBe(rows[0]);
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    // Enter toggles the focused row (Tests off).
    await fireEvent.click(document.activeElement as HTMLElement);
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(filter.getAttribute("data-tip")).toBe("Filter files by type");
    expect(filter.querySelector("[data-filter-active]")).not.toBeNull();
    // Esc closes and returns focus to the button.
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "File filters" })).toBeNull();
    expect(document.activeElement).toBe(filter);
    // The Reviewed row maps onto the same hideReviewed pref, from the
    // toolbar's review filter.
    const reviewFilter = screen.getByRole("button", { name: "Review filters" });
    await fireEvent.click(reviewFilter);
    const menu2 = screen.getByRole("menu", { name: "Review filters" });
    expect(within(menu2).getAllByRole("menuitemcheckbox")).toHaveLength(2);
    await fireEvent.click(within(menu2).getByRole("menuitemcheckbox", { name: /Reviewed/ }));
    const stored = JSON.parse(localStorage.getItem("unvibe.diff.prefs.v1") as string) as {
      hideReviewed: boolean;
    };
    expect(stored.hideReviewed).toBe(true);

  });
});

