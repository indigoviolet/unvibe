/**
 * Behaviour tests for the diff pane against the mock API (`VITE_MOCK=1`,
 * see `package.json` test script): fold/unfold, mark reviewed, file/hunk
 * reviewed relation, file fold across remounts, hide uninteresting, files
 * filter, line clicks/slots, summarize, and `revealSource` on a hidden +
 * a folded hunk.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HUNK_PASS_FANOUT_LIMIT } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { resetMockState, setMockLatency } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";
import { revealSource } from "./revealSource.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  // Skip the mock's deliberate latency in this file (issue #119): the
  // behaviour under test is rendering, not timing. Other files keep it.
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
    // Hunk 0 carries the seeded idle summary (#138), so its card is visible unfolded.
    expect(conn.getByText("Unfolds folded header values before reading.")).toBeInTheDocument();
    await fireEvent.click(conn.getAllByRole("button", { name: "Fold code" })[0]);
    // One unfold control only: the header chevron, no placeholder row.
    expect(await conn.findByRole("button", { name: "Show code" })).toBeInTheDocument();
    expect(conn.queryByText(/changed lines folded/)).not.toBeInTheDocument();
    // The card survives folding.
    expect(conn.getByText("Unfolds folded header values before reading.")).toBeInTheDocument();
    await fireEvent.click(conn.getByRole("button", { name: "Show code" }));
    expect(conn.queryByRole("button", { name: "Show code" })).not.toBeInTheDocument();
  });

  it("marks a hunk reviewed (greys + folds) and advances progress", async () => {
    await renderDiff();
    await fireEvent.click(screen.getByRole("button", { name: "Show file list" }));
    // Progress is the toolbar's bottom line; counts only in its label.
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "1 of 8 hunks reviewed");
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("checkbox", { name: "Mark reviewed" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "2 of 8 hunks reviewed"),
    );
  });

  it("derives file reviewed from its hunks with a partial checkbox state", async () => {
    await renderDiff();
    const conn = within(connSection());
    // Neither conn hunk reviewed: file checkbox unchecked, 0/2.
    expect(conn.getByRole("checkbox", { name: "Mark file reviewed" })).not.toBeChecked();
    expect(conn.getByText("0/2")).toBeInTheDocument();
    // Marking the file marks every hunk: checked, 2/2.
    await fireEvent.click(conn.getByRole("checkbox", { name: "Mark file reviewed" }));
    expect(await conn.findByRole("checkbox", { name: "Mark file not reviewed" })).toBeChecked();
    expect(conn.getByText("2/2")).toBeInTheDocument();
    // Unmarking one hunk: partial — unchecked + indeterminate, 1/2.
    await fireEvent.click(conn.getAllByRole("checkbox", { name: "Mark not reviewed" })[0]);
    const partial = (await conn.findByRole("checkbox", { name: "Mark file reviewed" })) as HTMLInputElement;
    expect(partial.checked).toBe(false);
    expect(partial.indeterminate).toBe(true);
    expect(conn.getByText("1/2")).toBeInTheDocument();
  });

  it("keeps file fold state across a tab switch (remount)", async () => {
    const first = await renderDiff();
    await fireEvent.click(within(connSection()).getByRole("button", { name: "Collapse file" }));
    // The fold round-trips through the mock API snapshot, not local state.
    await waitFor(() => expect(connSection().querySelector(".dbody")).toBeNull());
    // Switching tabs unmounts the diff pane; the fold must survive that.
    first.unmount();
    await renderDiff();
    expect(connSection().querySelector(".dbody")).toBeNull();
    await fireEvent.click(within(connSection()).getByRole("button", { name: "Expand file" }));
    await waitFor(() => expect(connSection().querySelector(".dbody")).not.toBeNull());
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

  it("summarizes a hunk with canned mock text", async () => {
    await renderDiff();
    const conn = within(connSection());
    // Hunk 0 already carries the seeded idle summary (#138), so the
    // first Summarize button belongs to hunk 1 and its canned text. The
    // matcher avoids "getresponse", which also names hunk 1's header.
    await fireEvent.click(conn.getAllByRole("button", { name: "Summarize" })[0]);
    expect(await conn.findByText(/now builds `HTTPHeaderDict`/, {}, { timeout: 3000 })).toBeInTheDocument();
  }, 10000);

  it("folds on the deterministic hidden reason with no model summaries (#107)", async () => {
    // No hunk carries a summary (the hunk pass never ran): hidden runs
    // must still fold on the ingest hidden reason with sensible copy — no
    // raw placeholder text, no spinner that never ends — and a folded hunk
    // without a summary must hide behind the header chevron alone.
    useReview.getState().setSnapshot(makeNoSummarySnapshot());
    render(<DiffView reviewId="nosum" />);
    await screen.findByText("gen-u1.ts", {}, { timeout: 3000 });
    // Hidden run folds on the deterministic reason with its detail copy.
    expect(screen.getByText(/Hunks 1–2 of 2 hidden · generated/)).toBeInTheDocument();
    expect(screen.getByText("Generated file; safe to skip.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("(no summary yet)");
    expect(document.body.textContent).not.toContain("(pending)");
    expect(screen.queryByLabelText("Summarizing")).toBeNull();
    // Expanding the run shows the hunks.
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 2 hidden · generated/));
    expect(await screen.findByText("Hunk 1 of 2")).toBeInTheDocument();
    // Folding a hunk with no summary hides the code behind the header
    // chevron alone (no placeholder row), keeps the on-demand Summarize
    // action, and never spins.
    const src = within(document.getElementById("F-src-plain-py") as HTMLElement);
    await fireEvent.click(src.getAllByRole("button", { name: "Fold code" })[0]);
    expect(await src.findByRole("button", { name: "Show code" })).toBeInTheDocument();
    expect(src.queryByText(/changed lines folded/)).not.toBeInTheDocument();
    expect(src.getByRole("button", { name: "Summarize" })).toBeInTheDocument();
    expect(src.queryByLabelText("Summarizing")).toBeNull();
  });

  it("Fold all summarizes under the fan-out limit (#107)", async () => {
    // makeNoSummarySnapshot: 3 hunks, 2 hidden by Hide-uninteresting, so
    // the one visible hunk folds and gets exactly one summary request.
    useReview.getState().setSnapshot(makeNoSummarySnapshot());
    render(<DiffView reviewId="nosum" />);
    await screen.findByText("gen-u1.ts", {}, { timeout: 3000 });
    const update = vi.spyOn(api, "updateHunk").mockResolvedValue({ ok: true });
    const summarize = vi.spyOn(api, "summarizeHunk").mockResolvedValue({ jobId: "j1" });
    try {
      expect(screen.getByRole("button", { name: "Fold all" }).getAttribute("data-tip")).toBe("Fold the code");
      await fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
    } finally {
      update.mockRestore();
      summarize.mockRestore();
    }
  });

  it("Fold all stays quiet about summarizing when summaries exist (#162)", async () => {
    const snap = makeNoSummarySnapshot();
    snap.hunkStates = [
      { contentHash: "gen0", folded: false, reviewed: false, summary: "Generated helper." },
      { contentHash: "gen1", folded: false, reviewed: false, summary: "Generated helper." },
      { contentHash: "plain0", folded: false, reviewed: false, summary: "Plain change." },
    ];
    useReview.getState().setSnapshot(snap);
    render(<DiffView reviewId="nosum" />);
    await screen.findByText("gen-u1.ts", {}, { timeout: 3000 });
    // The generated hunks stay hidden and the one visible hunk already
    // has a summary: the tooltip is still the action only (#225).
    expect(screen.getByRole("button", { name: "Fold all" }).getAttribute("data-tip")).toBe("Fold the code");
  });

  it("Fold all folds without summarizing past the fan-out limit (#107)", async () => {
    // 525 hunks > limit: every hunk folds, no summary is requested (that
    // would be the per-hunk fan-out the pipeline refuses to run).
    const RealIO = globalThis.IntersectionObserver;
    class NeverIO {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = NeverIO;
    const update = vi.spyOn(api, "updateHunk").mockResolvedValue({ ok: true });
    const summarize = vi.spyOn(api, "summarizeHunk").mockResolvedValue({ jobId: "j1" });
    try {
      expect(HUNK_PASS_FANOUT_LIMIT).toBeLessThan(525);
      useReview.getState().setSnapshot(makeOverLimitSnapshot());
      render(<DiffView reviewId="over" />);
      await screen.findByText("over-0.ts", {}, { timeout: 5000 });
      expect(screen.getByRole("button", { name: "Fold all" }).getAttribute("data-tip")).toBe("Fold the code");
      await fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
      await waitFor(() => expect(update).toHaveBeenCalledTimes(525), { timeout: 10000 });
      expect(summarize).not.toHaveBeenCalled();
    } finally {
      update.mockRestore();
      summarize.mockRestore();
      if (RealIO) globalThis.IntersectionObserver = RealIO;
      else delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  }, 20000);

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
    // Lines 650-651 sit in conn's second hunk: fold it, then reveal.
    await fireEvent.click(conn.getAllByRole("button", { name: "Fold code" })[1]);
    expect(await conn.findByRole("button", { name: "Show code" })).toBeInTheDocument();
    expect(revealSource(`diff:${CONN}:650-651`)).toBe(true);
    await screen.findByText((_c, el) => el?.id === `L-${CONN}-650`, {}, { timeout: 3000 });
    expect(conn.queryByRole("button", { name: "Show code" })).not.toBeInTheDocument();
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

});

/** Review with deterministic hidden reasons and zero model summaries (#107). */
function makeNoSummarySnapshot(): import("@unvibe/shared").ReviewSnapshot {
  const genHunk = (n: number) => ({
    contentHash: `gen${n}`,
    header: `@@ -${n * 10 + 1},4 +${n * 10 + 1},4 @@`,
    newStart: n * 10 + 1,
    newEnd: n * 10 + 4,
    oldStart: n * 10 + 1,
    oldEnd: n * 10 + 4,
    added: 2,
    removed: 1,
    hiddenReason: "generated",
    lines: [
      { kind: "ctx" as const, oldLine: n * 10 + 1, newLine: n * 10 + 1, text: "a" },
      { kind: "del" as const, oldLine: n * 10 + 2, text: "b" },
      { kind: "add" as const, newLine: n * 10 + 2, text: "c" },
      { kind: "add" as const, newLine: n * 10 + 3, text: "d" },
      { kind: "ctx" as const, oldLine: n * 10 + 3, newLine: n * 10 + 4, text: "e" },
    ],
  });
  return {
    review: {
      id: "nosum",
      repoId: "urllib3",
      branch: "nosum",
      versions: [],
      currentVersion: 1,
      createdAt: Date.now(),
    },
    version: { n: 1, headSha: "abc1234", mergeBaseSha: "def5678", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [
      {
        fileKey: "gen-gen-u1-ts",
        path: "gen/gen-u1.ts",
        category: "generated" as const,
        hunks: [genHunk(0), genHunk(1)],
      },
      {
        fileKey: "src-plain-py",
        path: "src/plain.py",
        category: "source" as const,
        hunks: [
          {
            contentHash: "plain0",
            header: "@@ -1,4 +1,4 @@",
            newStart: 1,
            newEnd: 4,
            oldStart: 1,
            oldEnd: 4,
            added: 2,
            removed: 1,
            lines: [
              { kind: "ctx" as const, oldLine: 1, newLine: 1, text: "a" },
              { kind: "del" as const, oldLine: 2, text: "b" },
              { kind: "add" as const, newLine: 2, text: "c" },
              { kind: "add" as const, newLine: 3, text: "d" },
              { kind: "ctx" as const, oldLine: 3, newLine: 4, text: "e" },
            ],
          },
        ],
      },
    ],
    ingest: { status: "ready" },
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
}

/** 21 files x 25 hunks = 525 hunks, past the fan-out limit (#107). */
function makeOverLimitSnapshot(): import("@unvibe/shared").ReviewSnapshot {
  const files = Array.from({ length: 21 }, (_, fi) => ({
    fileKey: `over-${fi}`,
    path: `src/over-${fi}.ts`,
    category: "source" as const,
    hunks: Array.from({ length: 25 }, (_, hi) => {
      const n = hi * 10;
      return {
        contentHash: `over-${fi}-${hi}`,
        header: `@@ -${n + 1},2 +${n + 1},3 @@`,
        newStart: n + 1,
        newEnd: n + 3,
        oldStart: n + 1,
        oldEnd: n + 2,
        added: 1,
        removed: 0,
        lines: [
          { kind: "ctx" as const, oldLine: n + 1, newLine: n + 1, text: "a" },
          { kind: "add" as const, newLine: n + 2, text: "b" },
          { kind: "ctx" as const, oldLine: n + 2, newLine: n + 3, text: "c" },
        ],
      };
    }),
  }));
  return {
    review: {
      id: "over",
      repoId: "urllib3",
      branch: "over",
      versions: [],
      currentVersion: 1,
      createdAt: Date.now(),
    },
    version: { n: 1, headSha: "abc1234", mergeBaseSha: "def5678", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files,
    ingest: { status: "ready" },
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  };
}
