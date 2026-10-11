/**
 * Highlight render tests (spike/shiki-highlighting, Refs #23).
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
  beginNote: () => {},
  changeNote: () => {},
  saveNote: () => {},
  discardNote: () => {},
  deleteNote: () => {},
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
          new: hunk.lines.map((l) => (l.kind === "ctx" ? null : [...kw(l.text.slice(0, 3)), ...plain(l.text.slice(3))])),
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
        editingNote={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
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
        editingNote={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
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
        editingNote={{}}
        slots={{}}
        commentedLines={new Set()}
        highlight={null}
        fileHighlighted={false}
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
