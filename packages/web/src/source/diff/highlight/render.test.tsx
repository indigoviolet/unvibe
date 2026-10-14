/**
 * Highlight render tests (issue #23).
 *
 * - Injected token rows render as `shk-*` spans (unified + split), the
 *   `#`-comment fallback applies to plain rows only, and copy-paste text
 *   (textContent) carries no artefacts.
 * - The live path (real Shiki through `useFileHighlight`) upgrades Python
 *   rows and leaves the unshipped `.rst` changelog plain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useReview } from "../../../state/store.js";
import { resetMockState } from "../../../mock/index.js";
import { MOCK_FILES } from "../../../mock/diff.js";
import { DiffView } from "../DiffView.js";
import { FileSection } from "../FileSection.js";
import { RevealedRows, type RevealedLine } from "../FileExpansion.js";
import type { LineTokens } from "./tokenize.js";

beforeEach(() => {
  localStorage.clear();
  resetMockState();
  useReview.getState().clear();
});

afterEach(() => {
  cleanup();
});

const CONN = "src-urllib3-connection.py";
const LOG = "changelog-1362.bugfix.rst";

const NO_ACTIONS = {
  toggleFold: () => {},
  summarize: () => {},
  deleteSummary: () => {},
  toggleReviewed: () => {},
};

function kw(text: string): LineTokens {
  return [{ text, cls: "shk-kw", bold: false, italic: false }];
}
function plain(text: string): LineTokens {
  return [{ text, cls: null, bold: false, italic: false }];
}

describe("FileSection with injected tokens", () => {
  it("renders shk-* spans and drops the #-comment fallback on highlighted rows", () => {
    const file = { ...MOCK_FILES[0], path: "src/a.rs" }; // unknown lang: hook stays off
    const hunk = file.hunks[0];
    const byHash = new Map([
      [
        hunk.contentHash,
        {
          old: hunk.lines.map(() => null),
          new: hunk.lines.map((l) =>
            l.kind === "ctx" ? null : [...kw(l.text.slice(0, 3)), ...plain(l.text.slice(3))],
          ),
        },
      ],
    ]);
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
        headCommit="bdcc1e493e"
        baseCommit="443cb01be1"
        contentAvailable
        briefs={null}
        tokens={byHash}
        states={new Map()}
        isHidden={() => false}
        actions={NO_ACTIONS}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    const section = document.getElementById(`F-${file.fileKey}`);
    expect(section).not.toBeNull();
    // Highlighted add-rows carry keyword spans…
    expect(section!.querySelectorAll("td.c .shk-kw").length).toBeGreaterThan(0);
    expect(section!.querySelectorAll("td.c .shk-kw").length).toBeGreaterThan(0);
    // …and no `cm` comment fallback anywhere (tokens own comment colour).
    expect(section!.querySelectorAll("td.c .cm").length).toBe(0);
    // Copy-paste text is artefact-free: marker + code, no span text.
    const firstAdd = section!.querySelector("tr.add td.c");
    expect(firstAdd?.textContent?.startsWith("+")).toBe(true);
  });

  it("keeps the #-comment fallback on plain (unsupported-language) rows", () => {
    const file = { ...MOCK_FILES[0], path: "src/a.rs" };
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
        headCommit="bdcc1e493e"
        baseCommit="443cb01be1"
        contentAvailable
        briefs={null}
        states={new Map()}
        isHidden={() => false}
        actions={NO_ACTIONS}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    const section = document.getElementById(`F-${file.fileKey}`);
    // The added `# Starting the optional OWS…` comment rows keep `cm`.
    expect(section!.querySelectorAll("td.c .cm").length).toBeGreaterThan(0);
  });

  it("pairs split cells with their own side's rows", () => {
    const file = { ...MOCK_FILES[0], path: "src/a.rs" };
    const hunk = file.hunks[1]; // has a del/add pair
    const byHash = new Map([
      [
        hunk.contentHash,
        {
          old: hunk.lines.map((l) => (l.kind === "del" ? kw(l.text) : null)),
          new: hunk.lines.map((l) => (l.kind === "add" ? kw(l.text) : null)),
        },
      ],
    ]);
    render(
      <FileSection
        file={file}
        view="split"
        reviewed={0}
        folded={false}
        eager
        busy={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
        reviewId="demo"
        headCommit="bdcc1e493e"
        baseCommit="443cb01be1"
        contentAvailable
        briefs={null}
        tokens={byHash}
        states={new Map()}
        isHidden={() => false}
        actions={NO_ACTIONS}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    const section = document.getElementById(`F-${file.fileKey}`);
    expect(section!.querySelector("table.diff.split")).not.toBeNull();
    expect(section!.querySelectorAll("td.c .shk-kw").length).toBeGreaterThan(0);
  });
});

describe("DiffView live highlight", () => {
  it("upgrades Python rows and leaves .rst plain", async () => {
    render(<DiffView reviewId="demo" />);
    await screen.findByText("connection.py", {}, { timeout: 3000 });
    const conn = document.getElementById(`F-${CONN}`);
    expect(conn).not.toBeNull();
    // Real Shiki lands asynchronously (lazy core + grammar).
    await vi.waitFor(
      () => {
        expect(conn!.querySelectorAll("td.c .shk-kw").length).toBeGreaterThan(0);
      },
      { timeout: 15000 },
    );
    const log = document.getElementById(`F-${LOG}`);
    expect(log?.querySelectorAll("td.c [class*='shk-']").length).toBe(0);
  }, 20000);
});

describe("hostile code text (issue #101)", () => {
  const EVIL = `<script>alert("x & y")</script></td><td>`;
  const evilFile = {
    fileKey: "evil",
    path: "src/evil.rs", // unknown language: the live hook stays off
    category: "source",
    hunks: [
      {
        contentHash: "hash-evil-1",
        header: "@@ -1 +1 @@",
        newStart: 1,
        newEnd: 1,
        oldStart: 1,
        oldEnd: 1,
        added: 1,
        removed: 0,
        lines: [{ kind: "add", newLine: 1, text: EVIL }],
      },
    ],
  } as const;

  function renderEvil(
    view: "unified" | "split",
    tokens?: ReadonlyMap<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] }>,
  ): HTMLElement {
    render(
      <FileSection
        file={evilFile as never}
        view={view}
        reviewed={0}
        folded={false}
        eager
        busy={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
        reviewId="demo"
        headCommit="bdcc1e493e"
        baseCommit="443cb01be1"
        contentAvailable
        briefs={null}
        tokens={tokens}
        states={new Map()}
        isHidden={() => false}
        actions={NO_ACTIONS}
        onLineClick={undefined}
        onToggleFileFold={() => {}}
        onMarkFileReviewed={() => {}}
        onUnhide={() => {}}
      />,
    );
    const section = document.getElementById("F-evil");
    expect(section).not.toBeNull();
    return section!;
  }

  // The evil string split across a span boundary, so escaping is
  // exercised inside token spans too, not just in plain runs.
  function evilTokens(): ReadonlyMap<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] }> {
    const at = EVIL.indexOf("alert");
    return new Map([
      [
        "hash-evil-1",
        {
          old: [null],
          new: [
            [
              { text: EVIL.slice(0, at), cls: "shk-kw", bold: false, italic: false },
              { text: EVIL.slice(at), cls: null, bold: false, italic: false },
            ],
          ],
        },
      ],
    ]);
  }

  it.each(["unified", "split"] as const)("renders hostile text inert in %s rows, plain and highlighted", (view) => {
    for (const tokens of [undefined, evilTokens()]) {
      cleanup();
      const section = renderEvil(view, tokens);
      // Nothing parsed anywhere in the file: no script element…
      expect(section.querySelector("script")).toBeNull();
      const evilCells = [...section.querySelectorAll("td.c")].filter((cell) =>
        cell.textContent?.includes("<script>"),
      );
      expect(evilCells.length).toBeGreaterThan(0);
      for (const cell of evilCells) {
        // …reads back as the exact raw text (copy-paste intact)…
        expect(cell.textContent).toContain(EVIL);
        // …with no smuggled cells inside it.
        expect(cell.querySelectorAll("td").length).toBe(0);
      }
      // The injected `</td><td>` smuggled in no rows or cells: the hunk's
      // code table holds exactly the one code row (3 cells unified — old
      // number, new number, code — 4 split, a pair with an empty left)…
      // (control rows carry `.pr`, so the count excludes the expand
      // control below the hunk — an injected row would still show up as
      // an extra non-control row or a third row overall).
      const codeRows = section.querySelectorAll(".dhunk table.diff tbody tr:not(.pr)");
      expect(codeRows.length).toBe(1);
      expect(codeRows[0].querySelectorAll("td").length).toBe(view === "split" ? 4 : 3);
      // …the hunk header renders exactly once, outside any table…
      const headers = section.querySelectorAll(".dhunk-h");
      expect(headers.length).toBe(1);
      expect(headers[0].closest("table")).toBeNull();
      // …and no rows, cells or tables were injected anywhere in the section.
      // The hunk starts at line 1 with an unknown total, so no expansion
      // control renders either: exactly the one code row.
      expect(section.querySelectorAll("tr").length).toBe(1);
      expect(section.querySelectorAll("table").length).toBe(1);
      if (tokens) expect(section.querySelectorAll("td.c .shk-kw").length).toBeGreaterThan(0);
    }
  });

  it.each(["unified", "split"] as const)("renders hostile text inert in revealed %s rows", (view) => {
    cleanup();
    const lines: RevealedLine[] = [{ line: 9, oldLine: 9, newLine: 9, text: EVIL }];
    render(
      <table className={`diff ${view}`}>
        <tbody>
          <RevealedRows
            fileKey="evil"
            lines={lines}
            view={view}
            tokens={new Map()}
            slots={{}}
            highlight={null}
            onHideBlock={() => {}}
          />
        </tbody>
      </table>,
    );
    const row = document.querySelector("tr[data-revealed]");
    expect(row).not.toBeNull();
    // Nothing parsed: no script element, exact raw text, no smuggled cells.
    expect(row!.querySelector("script")).toBeNull();
    const cells = [...row!.querySelectorAll("td.c")].filter((cell) => cell.textContent?.includes("<script>"));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.textContent).toContain(EVIL);
      expect(cell.querySelectorAll("td").length).toBe(0);
    }
    // One revealed row, with both number cells in split view.
    expect(document.querySelectorAll("tr[data-revealed]").length).toBe(1);
    expect(row!.querySelectorAll("td.n:not(.empty)").length).toBe(2);
  });
});
