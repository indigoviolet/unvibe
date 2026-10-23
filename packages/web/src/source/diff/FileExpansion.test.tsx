/**
 * Expand-by-lines behaviour tests against the mock API (`VITE_MOCK=1`):
 * step controls above/below hunks, gap show-all with continuity, collapse,
 * split alignment, and no comment start on revealed lines.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Hunk, ReviewFile } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { resetMockState, setMockLatency } from "../../mock/index.js";
import { DiffView } from "./DiffView.js";
import { FileSection } from "./FileSection.js";

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
    await fireEvent.click(conn.getByRole("button", { name: "Hide 20 lines" }));
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
    // Fully revealed: this gap's show-all is gone; the quiet Hide icon
    // sits on the run's first row instead.
    expect(tconn.queryByRole("button", { name: "Show all 4 lines" })).toBeNull();
    await fireEvent.click(tconn.getByRole("button", { name: "Hide 4 lines" }));
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

describe("DiffView unit expansion", () => {
  it("steps one level per click with the unit name in the hunk header", async () => {
    await renderDiff();
    const conn = within(connSection());
    // Second hunk (getresponse call site): method, then class.
    const buttons = conn.getAllByRole("button", { name: "Show the enclosing function or class" });
    expect(buttons).toHaveLength(2);
    await fireEvent.click(buttons[1]);
    // Level 0: the method span around the hunk, named in the header.
    await waitFor(() => expect(document.getElementById(`L-${CONN}-640`)).not.toBeNull());
    expect(document.getElementById(`L-${CONN}-665`)).not.toBeNull();
    expect(conn.getByText(/in getresponse/)).toBeInTheDocument();
    // Next step offers the class.
    await fireEvent.click(conn.getByRole("button", { name: "Show enclosing class HTTPConnection" }));
    expect(await conn.findByText(/in HTTPConnection/)).toBeInTheDocument();
    // Past the class, the whole file is next, then stepping is done.
    expect(conn.getByRole("button", { name: "Show the whole file" })).toBeInTheDocument();
  });

  it("hides the unit control when no unit encloses the hunk", async () => {
    await renderDiff();
    const conn = within(connSection());
    // First hunk spans top-level items: the outline is empty.
    await fireEvent.click(conn.getAllByRole("button", { name: "Show the enclosing function or class" })[0]);
    await waitFor(() => {
      expect(conn.queryAllByRole("button", { name: /Show .*enclosing|Show unit/ })).toHaveLength(1);
    });
  });

  it("marks heuristic units as approximate", async () => {
    const spy = vi.spyOn(api, "outline").mockResolvedValue({
      path: "src/urllib3/connection.py",
      commit: "bdcc1e493e",
      start: 647,
      end: 654,
      totalLines: 760,
      language: null,
      how: "heuristic",
      chain: [{ kind: "block", name: "def getresponse  (approx)", start: 640, end: 665 }],
    });
    try {
      await renderDiff();
      const section = connSection();
      const conn = within(section);
      await fireEvent.click(conn.getAllByRole("button", { name: "Show the enclosing function or class" })[1]);
      await waitFor(() => expect(conn.getByText(/in def getresponse/)).toBeInTheDocument());
      expect(
        section.querySelector('span[data-tip="Approximate unit: guessed without a grammar"]'),
      ).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("hides every expansion control where the review has no file content", async () => {
    const spy = vi.spyOn(api, "fileSlice").mockRejectedValue(
      new Error('GET /api/reviews/demo/file: 404 {"error":"this review has no file content to read","code":"no-content"}'),
    );
    try {
      await renderDiff();
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Show 20 more lines" })).toBeNull();
      });
      expect(screen.queryByRole("button", { name: "Show the enclosing function or class" })).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("shows no separator where lines are continuous", async () => {
    await renderDiff();
    const section = document.getElementById(`F-${TCONN}`)!;
    const tconn = within(section);
    // Unhide the import hunks, then reveal their 4-line gap from below:
    // the gap is small enough that one step finishes it.
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 3 hidden · imports/));
    await screen.findByText("Hunk 1 of 3");
    const steps = tconn.getAllByRole("button", { name: "Show 4 more lines" });
    expect(steps).toHaveLength(2);
    // From below (the lower hunk's step): the 4-line gap finishes at once.
    await fireEvent.click(steps[1]);
    await waitForRevealed(section, 4);
    // No separator between the two hunks: hunk 1's table ends on
    // revealed line 13, hunk 2's table starts on its code line 14.
    const [d0, d1] = section.querySelectorAll(".dhunk");
    const rows0 = [...d0.querySelectorAll("table.diff tbody tr")];
    expect(rows0[rows0.length - 1].id).toBe(`L-${TCONN}-13`);
    const rows1 = [...d1.querySelectorAll("table.diff tbody tr")];
    expect(rows1[0].classList.contains("xsep")).toBe(false);
    expect(rows1[0].id).toBe(`L-${TCONN}-14`);
    // The hover Hide sits on the run's first row instead.
    expect(section.querySelectorAll("button[aria-label='Hide 4 lines']")).toHaveLength(1);
  });

  it("shrinks one gap run from either end with one remaining count", async () => {
    await renderDiff();
    const section = document.getElementById(`F-${TCONN}`)!;
    const tconn = within(section);
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 3 hidden · imports/));
    await screen.findByText("Hunk 1 of 3");
    // The third hunk starts folded (seeded): unfold it through its header
    // chevron so its lower step renders — the upper side alone still
    // reaches the whole gap.
    await fireEvent.click(tconn.getByRole("button", { name: "Show code" }));
    // Big gap (22-210, 189 lines): expand up from the lower hunk.
    const up = tconn.getAllByRole("button", { name: "Show 20 more lines" });
    await fireEvent.click(up[up.length - 1]);
    await waitForRevealed(section, 20);
    // Both ends share the run's remaining count (189 - 20 = 169).
    // (The first fetch also teaches the file total, so the bottom
    // control below the last hunk appears with its own 20-line step.)
    expect(tconn.getByRole("button", { name: "Show all 169 lines" })).toBeInTheDocument();
    expect(tconn.getAllByRole("button", { name: "Show 20 more lines" })).toHaveLength(3);
    // One more step from below shrinks the same run again: the gap's
    // lower step sits right above the last hunk's code.
    const upAgain = tconn.getAllByRole("button", { name: "Show 20 more lines" });
    await fireEvent.click(upAgain[1]);
    await waitForRevealed(section, 40);
    expect(tconn.getByRole("button", { name: "Show all 149 lines" })).toBeInTheDocument();
  });
});

describe("FileSection number width", () => {
  const hunk: Hunk = {
    contentHash: "big-h",
    header: "@@ -10,3 +10,3 @@",
    newStart: 10,
    newEnd: 12,
    oldStart: 10,
    oldEnd: 12,
    added: 0,
    removed: 0,
    lines: [
      { kind: "ctx", oldLine: 10, newLine: 10, text: "a" },
      { kind: "ctx", oldLine: 11, newLine: 11, text: "b" },
      { kind: "ctx", oldLine: 12, newLine: 12, text: "c" },
    ],
  };
  const file: ReviewFile = {
    fileKey: "big",
    path: "big.py",
    category: "source",
    hunks: [hunk],
  };
  const actions = {
    toggleFold: () => {},
    summarize: () => {},
    deleteSummary: () => {},
    beginNote: () => {},
    changeNote: () => {},
    saveNote: () => {},
    discardNote: () => {},
    deleteNote: () => {},
    toggleReviewed: () => {},
  };

  it("widens --lnw when revealed lines carry more digits than the hunks", async () => {    const slice = vi.spyOn(api, "fileSlice").mockImplementation(async (_id, params) => ({
      path: params.path,
      commit: params.commit,
      start: params.start,
      end: params.end,
      totalLines: 1200,
      lines: Array.from({ length: params.end - params.start + 1 }, (_, i) => `line ${params.start + i}`),
    }));
    const outline = vi.spyOn(api, "outline").mockResolvedValue({
      path: "big.py",
      commit: "abc1234",
      start: 10,
      end: 12,
      totalLines: 1200,
      language: "python",
      how: "parser",
      chain: [{ kind: "function_definition", name: "big", start: 1, end: 1200 }],
    });
    try {
      render(
        <FileSection
          file={file}
          view="unified"
          reviewed={0}
          folded={false}
          eager
          busy={{}}
          slots={{}}
          commentedLines={new Set()}
          highlight={null}
          fileHighlighted={false}
          reviewId="demo"
          headCommit="abc1234"
          baseCommit="def5678"
          contentAvailable
          briefs={null}
          states={new Map()}
          isHidden={() => false}
          actions={actions}
          onLineClick={undefined}
          onToggleFileFold={() => {}}
          onMarkFileReviewed={() => {}}
          onUnhide={() => {}}
        />,
      );
      const section = document.getElementById("F-big")!;
      expect(section.style.getPropertyValue("--lnw")).toBe("2ch");
      await fireEvent.click(screen.getByRole("button", { name: "Show the enclosing function or class" }));
      await waitFor(() => {
        expect(section.style.getPropertyValue("--lnw")).toBe("4ch");
      });
    } finally {
      slice.mockRestore();
      outline.mockRestore();
    }
  });

  it("learns the total up front for a single hunk starting at line 1", async () => {
    const one: Hunk = {
      contentHash: "one-h",
      header: "@@ -1,3 +1,3 @@",
      newStart: 1,
      newEnd: 3,
      oldStart: 1,
      oldEnd: 3,
      added: 0,
      removed: 0,
      lines: [
        { kind: "ctx", oldLine: 1, newLine: 1, text: "a" },
        { kind: "ctx", oldLine: 2, newLine: 2, text: "b" },
        { kind: "ctx", oldLine: 3, newLine: 3, text: "c" },
      ],
    };
    const oneFile: ReviewFile = { fileKey: "one", path: "one.py", category: "source", hunks: [one] };
    const slice = vi.spyOn(api, "fileSlice").mockImplementation(async (_id, params) => ({
      path: params.path,
      commit: params.commit,
      start: params.start,
      end: params.end,
      totalLines: 1200,
      lines: Array.from({ length: params.end - params.start + 1 }, (_, i) => `line ${params.start + i}`),
    }));
    try {
      render(
        <FileSection
          file={oneFile}
          view="unified"
          reviewed={0}
          folded={false}
          eager
          busy={{}}
          slots={{}}
          commentedLines={new Set()}
          highlight={null}
          fileHighlighted={false}
          reviewId="demo"
          headCommit="abc1234"
          baseCommit="def5678"
          contentAvailable
          briefs={null}
          states={new Map()}
          isHidden={() => false}
          actions={actions}
          onLineClick={undefined}
          onToggleFileFold={() => {}}
          onMarkFileReviewed={() => {}}
          onUnhide={() => {}}
        />,
      );
      // No clicks: the probe learns the total, the bottom control
      // appears, and nothing is revealed.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
      });
      expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(0);
      expect(slice).toHaveBeenCalledWith("demo", { path: "one.py", commit: "abc1234", start: 1, end: 1 });
    } finally {
      slice.mockRestore();
    }
  });

  it("shows no bottom control when the hunk ends at the file end", async () => {
    const one: Hunk = {
      contentHash: "one-h",
      header: "@@ -1,3 +1,3 @@",
      newStart: 1,
      newEnd: 3,
      oldStart: 1,
      oldEnd: 3,
      added: 0,
      removed: 0,
      lines: [
        { kind: "ctx", oldLine: 1, newLine: 1, text: "a" },
        { kind: "ctx", oldLine: 2, newLine: 2, text: "b" },
        { kind: "ctx", oldLine: 3, newLine: 3, text: "c" },
      ],
    };
    const oneFile: ReviewFile = { fileKey: "one", path: "one.py", category: "source", hunks: [one] };
    const slice = vi.spyOn(api, "fileSlice").mockImplementation(async (_id, params) => ({
      path: params.path,
      commit: params.commit,
      start: params.start,
      end: params.end,
      totalLines: 3,
      lines: Array.from({ length: params.end - params.start + 1 }, (_, i) => `line ${params.start + i}`),
    }));
    try {
      render(
        <FileSection
          file={oneFile}
          view="unified"
          reviewed={0}
          folded={false}
          eager
          busy={{}}
          slots={{}}
          commentedLines={new Set()}
          highlight={null}
          fileHighlighted={false}
          reviewId="demo"
          headCommit="abc1234"
          baseCommit="def5678"
          contentAvailable
          briefs={null}
          states={new Map()}
          isHidden={() => false}
          actions={actions}
          onLineClick={undefined}
          onToggleFileFold={() => {}}
          onMarkFileReviewed={() => {}}
          onUnhide={() => {}}
        />,
      );
      // The probe learns total 3 == hunk end: no separator at all, and
      // the unit control still offers the file level.
      await waitFor(() => {
        expect(slice).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(document.querySelectorAll("tr.xsep")).toHaveLength(0);
      });
    } finally {
      slice.mockRestore();
    }
  });

  it("drops the empty new-number column on deleted files (#261)", async () => {
    const delHunk: Hunk = {
      contentHash: "del-h",
      header: "@@ -1,3 +0,0 @@",
      newStart: 0,
      newEnd: 0,
      oldStart: 1,
      oldEnd: 3,
      added: 0,
      removed: 3,
      lines: [
        { kind: "del", oldLine: 1, text: "a" },
        { kind: "del", oldLine: 2, text: "b" },
        { kind: "del", oldLine: 3, text: "c" },
      ],
    };
    const delFile: ReviewFile = { fileKey: "gone", path: "gone.py", category: "source", hunks: [delHunk], isDeleted: true };
    render(
      <FileSection
        file={delFile}
        view="unified"
        reviewed={0}
        folded={false}
        eager
        busy={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
        reviewId="demo"
        headCommit="abc1234"
        baseCommit="def5678"
        contentAvailable={false}
        briefs={null}
        states={new Map()}
        isHidden={() => false}
        actions={actions}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    const section = document.getElementById("F-gone")!;
    expect(section.classList.contains("is-deleted")).toBe(true);
    const tables = [...section.querySelectorAll("table.diff:not(.split)")];
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) expect(t.classList.contains("hide-new")).toBe(true);
    for (const tr of section.querySelectorAll("table.diff:not(.split) tbody > tr")) {
      if (tr.classList.contains("xsep")) continue;
      expect(tr.querySelectorAll(":scope > td.n").length).toBe(1);
    }
  });
});
