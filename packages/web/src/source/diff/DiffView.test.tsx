/**
 * Behaviour tests for the diff pane against the mock API (`VITE_MOCK=1`,
 * see `package.json` test script): fold/unfold, mark reviewed, hide
 * uninteresting, files filter, line clicks/slots, notes, summarize, and
 * `revealSource` on a hidden + a folded hunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useReview } from "../../state/store.js";
import { resetMockState } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";
import { revealSource } from "./revealSource.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
});

afterEach(() => {
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

function connSection(): HTMLElement {
  const el = document.getElementById(`F-${CONN}`);
  if (!el) throw new Error(`missing #F-${CONN}`);
  return el;
}

describe("DiffView", () => {
  it("renders the four fixture files with hidden-uninteresting rows", async () => {
    await renderDiff();
    expect(screen.getByText("connection.py")).toBeInTheDocument();
    expect(screen.getByText("test_connection.py")).toBeInTheDocument();
    expect(screen.getByText("test_socketlevel.py")).toBeInTheDocument();
    expect(screen.getByText("1362.bugfix.rst")).toBeInTheDocument();
    // Two hidden runs: tconn imports (2 hunks) and the changelog. The tsock
    // import hunk is a one-line change, which PRD §4.13 never hides.
    expect(document.querySelectorAll("button.hid")).toHaveLength(2);
    expect(screen.getByText(/Hunks 1–2 of 3 hidden · imports/)).toBeInTheDocument();
  });

  it("folds and unfolds a hunk, keeping its card", async () => {
    await renderDiff();
    const conn = within(connSection());
    // The second conn hunk carries the seeded note, so its card is visible unfolded.
    expect(conn.getByText("Only call site; everything else is the helper.")).toBeInTheDocument();
    await fireEvent.click(conn.getAllByRole("button", { name: "Fold code" })[1]);
    expect(await conn.findByText("3 changed lines folded · show")).toBeInTheDocument();
    // The card survives folding.
    expect(conn.getByText("Only call site; everything else is the helper.")).toBeInTheDocument();
    await fireEvent.click(conn.getByText("3 changed lines folded · show"));
    expect(conn.queryByText("3 changed lines folded · show")).not.toBeInTheDocument();
  });

  it("marks a hunk reviewed (greys + folds) and advances progress", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show files panel" }));
    expect(await screen.findByText("1/8 hunks reviewed")).toBeInTheDocument();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Mark reviewed" })[0]);
    expect(await screen.findByText("2/8 hunks reviewed")).toBeInTheDocument();
  });

  it("toggles Hide uninteresting off and on", async () => {
    await renderDiff();
    const toggle = screen.getByRole("button", { name: "Hide uninteresting" });
    expect(document.querySelectorAll("button.hid")).toHaveLength(2);
    await fireEvent.click(toggle);
    expect(document.querySelectorAll("button.hid")).toHaveLength(0);
    await fireEvent.click(toggle);
    expect(document.querySelectorAll("button.hid")).toHaveLength(2);
  });

  it("expands a hidden run on click", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 3 hidden · imports/));
    expect(await screen.findByText("Hunk 1 of 3")).toBeInTheDocument();
    expect(document.querySelectorAll("button.hid")).toHaveLength(1);
  });

  it("filters files by name", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show files panel" }));
    const input = screen.getByLabelText("Filter files by name");
    await fireEvent.change(input, { target: { value: "socketlevel" } });
    expect(document.getElementById(`F-${CONN}`)).toBeNull();
    expect(document.getElementById(`F-${TSOCK}`)).not.toBeNull();
    // Header plus the files-panel tree row both name the file.
    expect(document.querySelectorAll("button.fr:not(.dir)")).toHaveLength(1);
  });

  it("emits line-number clicks and renders slots with comment icons", async () => {
    const onLineClick = vi.fn();
    // Comment threads provide both the slot and the commented-lines entry
    // (M4: expansion slots render their row without the comment icon).
    await renderDiff({
      lineSlots: { [`${CONN}:77`]: <span>inline thread</span> },
      commentedLines: new Set([`${CONN}:77`]),
      onLineClick,
    });
    const cell = document.querySelector(`[data-line="${CONN}:77"]`);
    expect(cell).not.toBeNull();
    expect(cell!.classList.contains("hc")).toBe(true);
    expect(screen.getByText("inline thread")).toBeInTheDocument();
    await fireEvent.click(cell!);
    expect(onLineClick).toHaveBeenCalledWith(CONN, 77);
  });

  it("adds and deletes a hunk note", async () => {
    await renderDiff();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Add note" })[0]);
    const box = conn.getByPlaceholderText("Your note on this hunk…");
    await fireEvent.change(box, { target: { value: "check the fast path" } });
    await fireEvent.click(conn.getByRole("button", { name: "Save" }));
    expect(await conn.findByText("check the fast path")).toBeInTheDocument();
    const card = conn.getByText("check the fast path").closest(".fsum");
    if (!card) throw new Error("note card missing");
    await fireEvent.click(within(card as HTMLElement).getByRole("button", { name: "Delete note" }));
    expect(await conn.findByRole("button", { name: "Add note" })).toBeInTheDocument();
  });

  it("summarizes a hunk with canned mock text", async () => {
    await renderDiff();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Summarize with agent" })[0]);
    expect(await conn.findByText(/Adds `_OBSOLETE_FOLD_RE`/, {}, { timeout: 3000 })).toBeInTheDocument();
  }, 10000);

  it("revealSource unhides a hidden hunk and highlights the line", async () => {
    await renderDiff();
    expect(revealSource(`diff:${TCONN}:5`)).toBe(true);
    const line = await screen.findByText((_c, el) => el?.id === `L-${TCONN}-5`, {}, { timeout: 3000 });
    void line;
    // The hidden run expanded: hunk headers are back.
    expect(screen.getByText("Hunk 1 of 3")).toBeInTheDocument();
    expect(document.getElementById(`L-${TCONN}-5`)?.className).toMatch(/hl/);
    expect(revealSource("card:nope")).toBe(false);
  });

  it("revealSource unfolds a folded hunk and highlights the range", async () => {
    await renderDiff();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Fold code" })[1]);
    expect(await conn.findByText("3 changed lines folded · show")).toBeInTheDocument();
    expect(revealSource(`diff:${CONN}:650-651`)).toBe(true);
    await screen.findByText((_c, el) => el?.id === `L-${CONN}-650`, {}, { timeout: 3000 });
    expect(conn.queryByText("3 changed lines folded · show")).not.toBeInTheDocument();
    expect(document.getElementById(`L-${CONN}-650`)?.className).toMatch(/hl/);
    expect(document.getElementById(`L-${CONN}-651`)?.className).toMatch(/hl/);
  });

  it("switches to split view with paired columns", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Split" }));
    const table = document.querySelector(`#${CSS.escape(`F-${CONN}`)} table.diff.split`);
    expect(table).not.toBeNull();
    expect(table!.querySelector("colgroup")).not.toBeNull();
  });

  it("stays usable on a 300-file, 5k-hunk diff (headers mount, bodies lazy)", async () => {
    // Fake an IntersectionObserver that never fires: only eager files may
    // render their hunk tables.
    const RealIO = globalThis.IntersectionObserver;
    class NeverIO {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NeverIO;
    try {
      useReview.getState().setSnapshot(makeBigSnapshot());
      render(<DiffView reviewId="big" />);
      await screen.findByText("file-0.ts", {}, { timeout: 5000 });
      expect(document.querySelectorAll(".dfile").length).toBe(300);
      expect(document.querySelectorAll("table.diff").length).toBe(3);
    } finally {
      if (RealIO) globalThis.IntersectionObserver = RealIO;
      else delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  });
});

function makeBigSnapshot(): import("@unvibe/shared").ReviewSnapshot {
  const files = Array.from({ length: 300 }, (_, fi) => ({
    fileKey: `big-${fi}`,
    path: `src/big/file-${fi}.ts`,
    category: "source" as const,
    hunks: Array.from({ length: 17 }, (_, hi) => {
      const base = hi * 10;
      return {
        contentHash: `big-${fi}-${hi}`,
        header: `@@ -${base + 1},5 +${base + 1},5 @@ fn${hi}`,
        context: `fn${hi}`,
        newStart: base + 1,
        newEnd: base + 5,
        oldStart: base + 1,
        oldEnd: base + 5,
        added: 2,
        removed: 1,
        lines: [
          { kind: "ctx" as const, oldLine: base + 1, newLine: base + 1, text: "a" },
          { kind: "ctx" as const, oldLine: base + 2, newLine: base + 2, text: "b" },
          { kind: "del" as const, oldLine: base + 3, text: "c" },
          { kind: "add" as const, newLine: base + 3, text: "d" },
          { kind: "add" as const, newLine: base + 4, text: "e" },
          { kind: "ctx" as const, oldLine: base + 4, newLine: base + 5, text: "f" },
        ],
      };
    }),
  }));
  return {
    review: {
      id: "big",
      repoId: "urllib3",
      branch: "big",
      versions: [],
      currentVersion: 1,
      createdAt: Date.now(),
    },
    version: { n: 1, headSha: "abc1234", mergeBaseSha: "def5678", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files,
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
}
