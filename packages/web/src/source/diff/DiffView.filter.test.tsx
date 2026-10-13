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
  it("filters files by name", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    const input = screen.getByLabelText("Filter files by name");
    await fireEvent.change(input, { target: { value: "socketlevel" } });
    expect(document.getElementById(`F-${CONN}`)).toBeNull();
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    // Header plus the files-panel tree row both name the file.
    expect(document.querySelectorAll("button.fr:not(.dir)")).toHaveLength(1);
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
    // The filter button shows its active state (4 deselected categories +
    // hide reviewed = 5).
    const filter = screen.getByRole("button", { name: /File filters/ });
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(filter).toHaveTextContent("5");
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
    // Default: everything shown, no active badge.
    expect(filter).toHaveAttribute("aria-pressed", "false");
    expect(filter).not.toHaveTextContent("1");
    await fireEvent.click(filter);
    const menu = screen.getByRole("menu", { name: "File filters" });
    const tests = within(menu).getByRole("menuitemcheckbox", { name: /Tests/ });
    expect(tests).toHaveAttribute("aria-checked", "true");
    await fireEvent.click(tests);
    // Deselecting Tests filters its files and marks the button active.
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(document.getElementById(`F-${CONN}`)).not.toBeNull();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(filter).toHaveTextContent("1");
    await fireEvent.click(tests);
    expect(document.getElementById(`F-${TCONN}`)).not.toBeNull();
    expect(filter).toHaveAttribute("aria-pressed", "false");
  });

  it("filter dropdown toggles Reviewed and is keyboard-usable", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    const filter = screen.getByRole("button", { name: "File filters" });
    await fireEvent.click(filter);
    const menu = screen.getByRole("menu", { name: "File filters" });
    const rows = within(menu).getAllByRole("menuitemcheckbox");
    // Five categories plus Reviewed.
    expect(rows).toHaveLength(6);
    const reviewed = within(menu).getByRole("menuitemcheckbox", { name: /Reviewed/ });
    expect(reviewed).toHaveAttribute("aria-checked", "true");
    // ArrowDown moves focus down the rows.
    expect(document.activeElement).toBe(rows[0]);
    await fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
    // Enter toggles the focused row (Tests off).
    await fireEvent.click(document.activeElement as HTMLElement);
    expect(document.getElementById(`F-${TCONN}`)).toBeNull();
    expect(filter).toHaveTextContent("1");
    // Esc closes and returns focus to the button.
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "File filters" })).toBeNull();
    expect(document.activeElement).toBe(filter);
    // The Reviewed row maps onto the same hideReviewed pref.
    await fireEvent.click(filter);
    const menu2 = screen.getByRole("menu", { name: "File filters" });
    await fireEvent.click(within(menu2).getByRole("menuitemcheckbox", { name: /Reviewed/ }));
    const stored = JSON.parse(localStorage.getItem("unvibe.diff.prefs.v1") as string) as {
      hideReviewed: boolean;
    };
    expect(stored.hideReviewed).toBe(true);
  });
});

