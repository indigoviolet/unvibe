/**
 * Expand-by-lines behaviour tests against the mock API (`VITE_MOCK=1`):
 * step controls above/below hunks, gap show-all with continuity, collapse,
 * split alignment, and no comment start on revealed lines.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

async function renderDiff(): Promise<void> {
  render(<DiffView reviewId="demo" />);
  await screen.findByText("connection.py", {}, { timeout: 3000 });
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";

function connSection(): HTMLElement {
  const el = document.getElementById(`F-${CONN}`);
  if (!el) throw new Error(`missing #F-${CONN}`);
  return el;
}

function revealedRows(root: ParentNode = document): Element[] {
  return [...root.querySelectorAll("tr[data-revealed]")];
}

async function waitForRevealed(root: ParentNode, n: number): Promise<void> {
  await waitFor(() => expect(revealedRows(root)).toHaveLength(n), { timeout: 3000 });
}

describe("DiffView expansion", () => {
  it("expands above a hunk in 20-line steps", async () => {
    await renderDiff();
    const conn = within(connSection());
    // Top region is lines 1-76: one step reveals 57-76.
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    expect(await conn.findByText("RefusedConnectionError")).toBeInTheDocument();
    expect(revealedRows(connSection())).toHaveLength(20);
    expect(document.getElementById(`L-${CONN}-76`)).not.toBeNull();
    expect(document.getElementById(`L-${CONN}-56`)).toBeNull();
    // A second step continues upward.
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    expect(await conn.findByText("DummyConnection")).toBeInTheDocument();
    expect(revealedRows(connSection())).toHaveLength(40);
  });

  it("collapses a region back", async () => {
    await renderDiff();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    await conn.findByText("RefusedConnectionError");
    expect(revealedRows(connSection())).toHaveLength(20);
    await fireEvent.click(conn.getByRole("button", { name: "Hide shown lines" }));
    expect(revealedRows(connSection())).toHaveLength(0);
  });

  it("reveals a whole gap so the hunks read as continuous", async () => {
    await renderDiff();
    // The tconn import hunks hide first; show them to reach the gap.
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 3 hidden · imports/));
    await screen.findByText("Hunk 1 of 3");
    const tconn = within(document.getElementById(`F-${TCONN}`)!);
    await fireEvent.click(tconn.getByRole("button", { name: "Show all 4 lines" }));
    const section = document.getElementById(`F-${TCONN}`)!;
    // Lines 10-13 sit between the two import hunks (highlighting may
    // split the text across spans, so assert rows + ids, not text).
    await waitForRevealed(section, 4);
    for (let n = 10; n <= 13; n++) {
      expect(document.getElementById(`L-${TCONN}-${n}`)).not.toBeNull();
    }
    // Fully revealed: this gap's show-all is gone, only the slim hide.
    expect(tconn.queryByRole("button", { name: "Show all 4 lines" })).toBeNull();
    await fireEvent.click(tconn.getByRole("button", { name: "Hide shown lines" }));
    expect(revealedRows(section)).toHaveLength(0);
  });

  it("keeps both sides aligned in split view", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Split" }));
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    // Both halves carry the same text (one match per side).
    expect(await conn.findAllByText("RefusedConnectionError")).toHaveLength(2);
    const row = document.getElementById(`L-${CONN}-76`);
    expect(row).not.toBeNull();
    // Context pairs both halves: two number cells with the same numbers.
    const nums = row!.querySelectorAll("td.n:not(.empty)");
    expect(nums).toHaveLength(2);
    expect(nums[0].textContent).toBe("76");
    expect(nums[1].textContent).toBe("76");
  });

  it("offers no comment start on revealed lines", async () => {
    const seen: { fileKey: string; line: number }[] = [];
    cleanup();
    render(<DiffView reviewId="demo" onLineClick={(f, l) => seen.push({ fileKey: f, line: l })} />);
    await screen.findByText("connection.py", {}, { timeout: 3000 });
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    await conn.findByText("RefusedConnectionError");
    // Revealed number cells carry no comment affordance…
    const row = document.getElementById(`L-${CONN}-76`)!;
    expect(row.querySelector("td.n.new")).toBeNull();
    expect(row.querySelector("td.n[data-line]")).toBeNull();
    // …and clicking one starts no comment.
    const numCell = row.querySelectorAll("td.n")[1];
    await fireEvent.click(numCell);
    expect(seen).toEqual([]);
  });
});
