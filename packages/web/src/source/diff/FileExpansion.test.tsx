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
import { slotKey } from "./lineSlots.js";

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
    // Issue #308: expand-more moved to the outermost revealed row,
    // the collapse chevron to the next row in; the hunk's own first
    // row is back to its number.
    const outer = document.getElementById(`L-${CONN}-57`)!;
    expect(outer.classList.contains("has-xup")).toBe(true);
    expect(within(outer).getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
    const inner = document.getElementById(`L-${CONN}-58`)!;
    expect(inner.classList.contains("has-xhide-up")).toBe(true);
    expect(document.getElementById(`L-${CONN}-77`)!.className).not.toContain("has-x");
    // A second step continues upward from the outermost row.
    await fireEvent.click(within(outer).getByRole("button", { name: "Show 20 more lines" }));
    expect(await conn.findByText("DummyConnection")).toBeInTheDocument();
    expect(revealedRows(connSection())).toHaveLength(40);
    const outer2 = document.getElementById(`L-${CONN}-37`)!;
    expect(outer2.classList.contains("has-xup")).toBe(true);
  });

  it("collapses a region back", async () => {
    await renderDiff();
    const conn = within(connSection());
    await fireEvent.click(conn.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    await conn.findByText("RefusedConnectionError");
    expect(revealedRows(connSection())).toHaveLength(20);
    // Issue #308: the collapse chevron sits on the second revealed
    // row; hiding returns expand-more to the hunk's own first row.
    const inner = document.getElementById(`L-${CONN}-58`)!;
    await fireEvent.click(within(inner).getByRole("button", { name: "Hide expanded lines above" }));
    expect(revealedRows(connSection())).toHaveLength(0);
    expect(document.getElementById(`L-${CONN}-77`)!.classList.contains("has-xup")).toBe(true);
  });

  it("reveals a whole gap so the hunks read as continuous", async () => {
    await renderDiff();
    // The tconn import hunks hide first; show them to reach the gap.
    await fireEvent.click(screen.getByText(/Hunks 1–2 of 3 hidden · imports/));
    await screen.findByText("Hunk 1 of 3");
    const tconn = within(document.getElementById(`F-${TCONN}`)!);
    // Issue #265: the gap's show-all rides both ends — down from the
    // upper hunk, up (to the previous hunk) from the lower one.
    const showAlls = tconn.getAllByRole("button", { name: "Show all 4 lines" });
    expect(showAlls).toHaveLength(2);
    await fireEvent.click(showAlls[1]);
    const section = document.getElementById(`F-${TCONN}`)!;
    // Lines 10-13 sit between the two import hunks (highlighting may
    // split the text across spans, so assert rows + ids, not text) —
    // atop the clicked hunk, not under the previous one.
    await waitForRevealed(section, 4);
    for (let n = 10; n <= 13; n++) {
      expect(document.getElementById(`L-${TCONN}-${n}`)).not.toBeNull();
    }
    const [d0, d1] = section.querySelectorAll(".dhunk");
    expect(revealedRows(d0)).toHaveLength(0);
    const rows1 = [...d1.querySelectorAll("table.diff tbody tr")];
    expect(rows1.slice(0, 4).map((tr) => (tr as HTMLElement).id)).toEqual(
      [10, 11, 12, 13].map((n) => `L-${TCONN}-${n}`),
    );
    expect((rows1[4] as HTMLElement).id).toBe(`L-${TCONN}-14`);
    // Fully revealed: this gap's show-all is gone; the collapse
    // chevron (issue #308) sits on the run's second row instead.
    expect(tconn.queryByRole("button", { name: "Show all 4 lines" })).toBeNull();
    const collapsed = document.getElementById(`L-${TCONN}-11`)!;
    expect(collapsed.classList.contains("has-xhide-up")).toBe(true);
    await fireEvent.click(within(collapsed).getByRole("button", { name: "Hide expanded lines above" }));
    expect(revealedRows(section)).toHaveLength(0);
    // Collapsing reopens the gap: both ends offer show-all again.
    expect(tconn.getAllByRole("button", { name: "Show all 4 lines" })).toHaveLength(2);
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
    // No separator rows at the revealed boundary (#285: controls ride
    // the rows, so hunk tables hold code rows only): hunk 1's
    // table holds only its top-region control above its code (ending on
    // code line 9); hunk 2's table starts on the revealed gap lines
    // (10-13, atop the clicked hunk per #265) and then its code. The
    // gap's show-all is gone (fully revealed): the outermost revealed
    // row shows its number and the collapse chevron (issue #308) sits
    // on the second row.
    const [d0, d1] = section.querySelectorAll(".dhunk");
    const rows0 = [...d0.querySelectorAll("table.diff tbody tr")];
    expect(rows0[rows0.length - 1].id).toBe(`L-${TCONN}-9`);
    const rows1 = [...d1.querySelectorAll("table.diff tbody tr")];
    expect(rows1.some((tr) => tr.classList.contains("xsep"))).toBe(false);
    expect(rows1[0].id).toBe(`L-${TCONN}-10`);
    expect(rows1[0].className).not.toContain("has-x");
    expect(rows1[1].id).toBe(`L-${TCONN}-11`);
    expect(rows1[1].className).toContain("has-xhide-up");
    expect(rows1[4].id).toBe(`L-${TCONN}-14`);
    // The collapse chevron sits on the run's second row.
    expect(section.querySelectorAll("button[aria-label='Hide expanded lines above']")).toHaveLength(1);
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
    // Big gap (22-210, 189 lines): expand up from the lower hunk. The
    // revealed tail reads atop the clicked hunk (issue #265), not under
    // the previous one. The last hunk also carries the optimistic bottom
    // step (#288), so pick the gap's up control explicitly — not the
    // file's last step button (which is the bottom control).
    const dhunksBefore = section.querySelectorAll(".dhunk");
    const lowerHunk = within(dhunksBefore[2] as HTMLElement);
    await fireEvent.click(lowerHunk.getAllByRole("button", { name: "Show 20 more lines" })[0]);
    await waitForRevealed(section, 20);
    const dhunks = section.querySelectorAll(".dhunk");
    expect(revealedRows(dhunks[2])).toHaveLength(20);
    expect(revealedRows(dhunks[1])).toHaveLength(0);
    // Both ends share the run's remaining count (189 - 20 = 169): the
    // upper side's show-all and the lower side's show-all-to-previous
    // name the same count.
    // (The first fetch also teaches the file total, so the bottom
    // control below the last hunk appears with its own 20-line step.)
    expect(tconn.getAllByRole("button", { name: "Show all 169 lines" })).toHaveLength(2);
    expect(tconn.getAllByRole("button", { name: "Show 20 more lines" })).toHaveLength(3);
    // One more step from below shrinks the same run again: the gap's
    // lower step sits right above the last hunk's code, and the new
    // lines join the tail there.
    const upAgain = tconn.getAllByRole("button", { name: "Show 20 more lines" });
    await fireEvent.click(upAgain[1]);
    await waitForRevealed(section, 40);
    expect(revealedRows(dhunks[2])).toHaveLength(40);
    expect(tconn.getAllByRole("button", { name: "Show all 149 lines" })).toHaveLength(2);
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

  it("shows the bottom step optimistically with no probe, then expands (#288)", async () => {
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
      // No probe on load (#288): the optimistic bottom step appears
      // without any fetch, and nothing is revealed.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
      });
      expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(0);
      expect(slice).not.toHaveBeenCalled();
      // One click fetches the assumed step and reveals it, learning the
      // total. Issue #308: expand-more moves to the outermost revealed
      // row (the step plus the long tail's show-all), the collapse
      // chevron to the next row in; the hunk's own last row is back to
      // its number.
      await fireEvent.click(screen.getByRole("button", { name: "Show 20 more lines" }));
      await waitFor(() => {
        expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(20);
      });
      expect(slice).toHaveBeenCalledWith("demo", { path: "one.py", commit: "abc1234", start: 4, end: 23 });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show all 1177 lines" })).toBeInTheDocument();
      });
      const outer = document.getElementById("L-one-23")!;
      expect(outer.classList.contains("has-xdown")).toBe(true);
      expect(within(outer).getByRole("button", { name: "Show all 1177 lines" })).toBeInTheDocument();
      const inner = document.getElementById("L-one-22")!;
      expect(inner.classList.contains("has-xhide-down")).toBe(true);
      const lastRow = document.getElementById("L-one-3")!;
      expect(lastRow.className).not.toContain("has-x");
      expect(lastRow.querySelector("td.n .nnum")?.textContent).toBe("3");
      // Collapsing hides the revealed lines and returns expand-more to
      // the hunk's last row.
      await fireEvent.click(within(inner).getByRole("button", { name: "Hide expanded lines below" }));
      await waitFor(() => {
        expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(0);
      });
      expect(document.getElementById("L-one-3")!.classList.contains("has-xdown")).toBe(true);
    } finally {
      slice.mockRestore();
    }
  });

  it("drops the optimistic bottom step when the hunk ends at EOF (#288)", async () => {
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
    const slice = vi.spyOn(api, "fileSlice").mockImplementation(async (_id, params) => {
      if (params.end > 3) {
        throw new Error(
          `GET /api/reviews/demo/file: 400 ${JSON.stringify({ error: `lines ${params.start}-${params.end} are outside one.py (3 lines)`, totalLines: 3 })}`,
        );
      }
      return {
        path: params.path,
        commit: params.commit,
        start: params.start,
        end: params.end,
        totalLines: 3,
        lines: Array.from({ length: params.end - params.start + 1 }, (_, i) => `line ${params.start + i}`),
      };
    });
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
      // Optimistic: the step shows before the total is known. Clicking
      // it past EOF adds nothing, shows no error, and the control
      // disappears once the total (3 == hunk end) is learned.
      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
      });
      expect(slice).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole("button", { name: "Show 20 more lines" }));
      await waitFor(() => {
        expect(slice).toHaveBeenCalledWith("demo", { path: "one.py", commit: "abc1234", start: 4, end: 23 });
      });
      await waitFor(() => {
        // Issue #285: no separator rows in unified — the control rode the
        // hunk's last row, so at EOF the row drops `has-xdown` and shows
        // its number again, with nothing revealed and no error.
        expect(document.querySelectorAll("tr.has-xdown")).toHaveLength(0);
        expect(document.querySelectorAll("tr.xsep")).toHaveLength(0);
      });
      expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(0);
      expect(screen.queryByText(/Couldn't load/)).toBeNull();
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

describe("unified gutter E2 controls (issue #285)", () => {
  const e2actions = {
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

  function e2File(): ReviewFile {
    const ctx = (line: number) => ({ kind: "ctx" as const, oldLine: line, newLine: line, text: `line ${line}` });
    return {
      fileKey: "e2",
      path: "e2.py",
      category: "source",
      hunks: [
        {
          contentHash: "e2-h1",
          header: "@@ -10,3 +10,3 @@",
          newStart: 10,
          newEnd: 12,
          oldStart: 10,
          oldEnd: 12,
          added: 0,
          removed: 0,
          lines: [ctx(10), ctx(11), ctx(12)],
        },
        {
          contentHash: "e2-h2",
          header: "@@ -50,3 +50,3 @@",
          newStart: 50,
          newEnd: 52,
          oldStart: 50,
          oldEnd: 52,
          added: 0,
          removed: 0,
          lines: [ctx(50), ctx(51), ctx(52)],
        },
      ],
    };
  }

  function renderE2(commented: ReadonlySet<string> = new Set()): void {
    render(
      <FileSection
        file={e2File()}
        view="unified"
        reviewed={0}
        folded={false}
        eager
        busy={{}}
        slots={{}}
        commentedLines={commented}
        highlight={null}
        fileHighlighted={false}
        reviewId="demo"
        headCommit="abc1234"
        baseCommit="def5678"
        contentAvailable
        briefs={null}
        states={new Map()}
        isHidden={() => false}
        actions={e2actions}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
  }

  it("rides the up pair on first rows and the down pair on last rows, with no separator rows", async () => {
    const slice = vi.spyOn(api, "fileSlice").mockImplementation(async (_id, params) => ({
      path: params.path,
      commit: params.commit,
      start: params.start,
      end: params.end,
      totalLines: 100,
      lines: Array.from({ length: params.end - params.start + 1 }, (_, i) => `line ${params.start + i}`),
    }));
    try {
      renderE2();
      await waitFor(() => {
        expect(screen.getAllByRole("button", { name: "Show 20 more lines" }).length).toBeGreaterThan(0);
      });
      const section = document.getElementById("F-e2")!;
      // No separator rows in unified (split keeps them; unified E2 never renders one).
      expect(section.querySelectorAll("tr.xsep")).toHaveLength(0);
      const first = document.getElementById("L-e2-10")!;
      const mid = document.getElementById("L-e2-11")!;
      const last1 = document.getElementById("L-e2-12")!;
      const first2 = document.getElementById("L-e2-50")!;
      const last2 = document.getElementById("L-e2-52")!;
      // First rows: up pair (^ step + ^^ show-all); middle rows: none.
      expect(first.classList.contains("has-xup")).toBe(true);
      expect(mid.classList.contains("has-xup")).toBe(false);
      expect(mid.classList.contains("has-xdown")).toBe(false);
      expect(within(first).getByRole("button", { name: "Show 9 more lines" })).toBeInTheDocument();
      expect(within(first).getByRole("button", { name: "Show all 9 lines" })).toBeInTheDocument();
      // Last rows: down pair (v step + vv show-all); numbers still at rest.
      expect(last1.classList.contains("has-xdown")).toBe(true);
      expect(within(last1).getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
      expect(within(last1).getByRole("button", { name: "Show all 37 lines" })).toBeInTheDocument();
      expect(last1.querySelector("td.n .nnum")?.textContent).toBe("12");
      // The gap's lower side rides the second hunk's first row.
      expect(first2.classList.contains("has-xup")).toBe(true);
      expect(within(first2).getByRole("button", { name: "Show all 37 lines" })).toBeInTheDocument();
      // The last hunk's last row offers the optimistic bottom step
      // (#288) before the total is known — step only, no show-all.
      expect(last2.classList.contains("has-xdown")).toBe(true);
      expect(within(last2).getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
      expect(within(last2).queryByRole("button", { name: "Show all 48 lines" })).toBeNull();
      // The in-row step expands like the old separator control did — and
      // the fetch teaches the total, so the bottom show-all lands on the
      // last hunk's last row beside no revealed lines yet.
      await fireEvent.click(within(last1).getByRole("button", { name: "Show 20 more lines" }));
      await waitFor(() => {
        expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(20);
      });
      expect(document.getElementById("L-e2-13")).not.toBeNull();
      expect(document.getElementById("L-e2-32")).not.toBeNull();
      await waitFor(() => {
        expect(within(last2).getByRole("button", { name: "Show all 48 lines" })).toBeInTheDocument();
      });
      // Issue #308: expand-more moved to the outermost revealed row
      // (the last of the new head), collapse to the next row in; the
      // hunk's own last row is back to its number.
      const outerDown = document.getElementById("L-e2-32")!;
      expect(outerDown.classList.contains("has-xdown")).toBe(true);
      expect(within(outerDown).getByRole("button", { name: "Show 17 more lines" })).toBeInTheDocument();
      const innerDown = document.getElementById("L-e2-31")!;
      expect(innerDown.classList.contains("has-xhide-down")).toBe(true);
      expect(document.getElementById("L-e2-12")!.className).not.toContain("has-x");
      // A second step from the outermost row closes the gap.
      await fireEvent.click(within(outerDown).getByRole("button", { name: "Show 17 more lines" }));
      await waitFor(() => {
        expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(37);
      });
      // Gap closed: the outermost revealed row shows its number, the
      // collapse chevron stays on the second-to-last row.
      expect(document.getElementById("L-e2-49")!.className).not.toContain("has-x");
      const closedInner = document.getElementById("L-e2-48")!;
      expect(closedInner.classList.contains("has-xhide-down")).toBe(true);
      // Collapsing reopens the gap: expand-more returns to the hunk rows.
      await fireEvent.click(within(closedInner).getByRole("button", { name: "Hide expanded lines below" }));
      await waitFor(() => {
        expect(document.querySelectorAll("tr[data-revealed]")).toHaveLength(0);
      });
      expect(document.getElementById("L-e2-12")!.classList.contains("has-xdown")).toBe(true);
      expect(document.getElementById("L-e2-50")!.classList.contains("has-xup")).toBe(true);
    } finally {
      slice.mockRestore();
    }
  });

  it("swaps the comment icon in for the new-side number", () => {
    renderE2(new Set([slotKey("e2", 11)]));
    // Commented line: icon permanently replaces the number.
    const commented = document.getElementById("L-e2-11")!;
    const newCell = commented.querySelector("td.n.new")!;
    expect(newCell.classList.contains("e-commented")).toBe(true);
    expect(newCell.querySelector(".nic svg")).not.toBeNull();
    expect(newCell.querySelector(".nnum")?.textContent).toBe("11");
    // Plain line: the icon rides along (hidden until hover by CSS) and
    // the number shows at rest.
    const plain = document.getElementById("L-e2-10")!;
    const plainCell = plain.querySelector("td.n.new")!;
    expect(plainCell.classList.contains("e-commented")).toBe(false);
    expect(plainCell.querySelector(".nic svg")).not.toBeNull();
    expect(plainCell.querySelector(".nnum")?.textContent).toBe("10");
  });

  it("lets the up pair win a one-row hunk with hidden code on both sides", async () => {
    const hunk: Hunk = {
      contentHash: "e2-one",
      header: "@@ -30 +30 @@",
      newStart: 30,
      newEnd: 30,
      oldStart: 30,
      oldEnd: 30,
      added: 0,
      removed: 0,
      lines: [{ kind: "ctx", oldLine: 30, newLine: 30, text: "line 30" }],
    };
    const file: ReviewFile = { fileKey: "solo", path: "solo.py", category: "source", hunks: [hunk] };
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
        actions={e2actions}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show 20 more lines" })).toBeInTheDocument();
    });
    // Up wins the single-row tie: the optimistic down step never renders.
    const row = document.getElementById("L-solo-30")!;
    expect(row.classList.contains("has-xup")).toBe(true);
    expect(row.classList.contains("has-xdown")).toBe(false);
    expect(screen.getAllByRole("button", { name: "Show 20 more lines" })).toHaveLength(1);
    expect(within(row).getByRole("button", { name: "Show all 29 lines" })).toBeInTheDocument();
  });
});
