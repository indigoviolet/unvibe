/**
 * Hunk summary activation (issue #138): idle summaries are plain text
 * with a `data-hunk` attribute and mount nothing per hunk; an activated
 * hunk draws its conversation card in place of the text; a closed card
 * falls back to the idle text (clicking reopens it).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, Hunk, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { FileSection } from "./FileSection.js";

const REVIEW_ID = "hunk-card";
const FILE_KEY = "f1";
const HASH = "hash-sum-1";

function hunk(): Hunk {
  return {
    contentHash: HASH,
    header: "@@ -1 +2 @@",
    newStart: 1,
    newEnd: 2,
    oldStart: 1,
    oldEnd: 2,
    added: 1,
    removed: 0,
    lines: [
      { kind: "ctx", oldLine: 1, newLine: 1, text: "import things;" },
      { kind: "add", newLine: 2, text: "const answer = computeTotal(items);" },
    ],
  };
}

function file(): ReviewFile {
  return { fileKey: FILE_KEY, path: "src/a.rs", category: "source", hunks: [hunk()] };
}

function card(open: boolean): Annotation {
  return {
    id: "ann_hunk",
    type: "conversation",
    anchor: {
      host: { kind: "hunk", fileKey: FILE_KEY, contentHash: HASH },
      quotedText: "",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open,
    messages: [],
    post: false,
    turns: [
      {
        id: "ans_1",
        question: null,
        blocks: [
          {
            type: "paragraph",
            id: "b1",
            text: { standard: "Unfolds folded header values before reading." },
            citations: [],
          },
        ],
        level: "standard",
        revision: 1,
        undoStack: [],
        working: null,
      },
    ],
  } as unknown as Annotation;
}

function seed(annotations: Annotation[]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "demo", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [file()],
    pages: [{ id: "p-1", kind: "opened-expansion", title: "Unfolds folded values", saved: false, parent: "root", cards: [] }],
    annotations,
    hunkStates: [{ contentHash: HASH, folded: false, reviewed: false, summary: "Unfolds folded header values." }],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

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

function Harness({
  cards,
  promoted,
  onOpenPage,
}: {
  cards: Map<string, Annotation>;
  promoted?: Map<string, string>;
  onOpenPage?: (pageId: string) => void;
}): React.JSX.Element {
  const lookupPage = (id: string): import("@unvibe/shared").Page | undefined =>
    useReview.getState().snapshot?.pages.find((p) => p.id === id);
  return (
    <table>
      <tbody>
        <FileSection
          file={file()}
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
          reviewId={REVIEW_ID}
          headCommit="head"
          baseCommit="base"
          contentAvailable
          briefs={null}
          states={new Map(useReview.getState().snapshot?.hunkStates.map((s) => [s.contentHash, s]) ?? [])}
          hunkCards={cards}
          promotedHunks={promoted}
          lookupPage={lookupPage}
          onOpenPage={onOpenPage ?? (() => {})}
          onFollowUp={() => {}}
          isHidden={() => false}
          actions={NO_ACTIONS}
          onLineClick={undefined}
          onToggleFileFold={() => {}}
          onMarkFileReviewed={() => {}}
          onUnhide={() => {}}
        />
      </tbody>
    </table>
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

function fwrap(): Element {
  const wrap = document.querySelector(".fwrap");
  expect(wrap).not.toBeNull();
  return wrap!;
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  vi.restoreAllMocks();
});

describe("hunk summary activation (issue #138)", () => {
  test("idle: plain text with data-hunk, no card chrome mounted", async () => {
    seed([]);
    render(<Harness cards={new Map()} />);
    await settle();
    const wrap = fwrap();
    const p = wrap.querySelector('p[data-hunksum="f1:hash-sum-1"]');
    expect(p?.textContent).toContain("Unfolds folded header values.");
    // Nothing mounted per hunk beyond the text: no card, no controls.
    expect(wrap.querySelector("[data-expansion]")).toBeNull();
    expect(wrap.querySelector(".card")).toBeNull();
    expect(wrap.querySelector(".ctl")).toBeNull();
    expect(wrap.querySelector("textarea")).toBeNull();
  });

  test("activated: the conversation card renders in place of the text", async () => {
    const ann = card(true);
    seed([ann]);
    render(<Harness cards={new Map([[HASH, ann]])} />);
    await settle();
    const wrap = fwrap();
    expect(wrap.querySelector("[data-expansion='ann_hunk']")).not.toBeNull();
    expect(wrap.querySelector('p[data-hunksum="f1:hash-sum-1"]')).toBeNull();
    // The card carries its reply box and per-answer controls.
    expect(wrap.querySelector("textarea[aria-label='Ask a follow-up']")).not.toBeNull();
  });

  test("closed: back to the idle text (clicking reopens)", async () => {
    const ann = card(false);
    seed([ann]);
    render(<Harness cards={new Map([[HASH, ann]])} />);
    await settle();
    const wrap = fwrap();
    expect(wrap.querySelector("[data-expansion='ann_hunk']")).toBeNull();
    expect(wrap.querySelector('p[data-hunksum="f1:hash-sum-1"]')).not.toBeNull();
  });

  test("promoted: summary text plus a page-link chip, no card", async () => {
    const link = {
      id: "ann_link",
      type: "link",
      anchor: {
        host: { kind: "hunk", fileKey: FILE_KEY, contentHash: HASH },
        quotedText: "",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: false,
      messages: [],
      post: false,
      promotedToPage: "p-1",
    } as unknown as Annotation;
    seed([link]);
    const onOpenPage = vi.fn();
    render(<Harness cards={new Map()} promoted={new Map([[HASH, "p-1"]])} onOpenPage={onOpenPage} />);
    await settle();
    const wrap = fwrap();
    // The summary stays for scanning; the chip is the way back in.
    expect(wrap.querySelector('p[data-hunksum="f1:hash-sum-1"]')?.textContent).toContain("Unfolds folded header values.");
    const chip = wrap.querySelector('a.cx.pg[data-node="p-1"]');
    expect(chip?.textContent).toContain("Unfolds folded values");
    expect(wrap.querySelector("[data-expansion]")).toBeNull();
    // Clicking the summary opens the page instead of a fresh card.
    fireEvent.click(wrap.querySelector("p[data-hunksum]")!);
    expect(onOpenPage).toHaveBeenCalledWith("p-1");
  });

  test("promoted to a missing page reads as ordinary idle", async () => {
    seed([]);
    render(<Harness cards={new Map()} promoted={new Map([[HASH, "p-gone"]])} />);
    await settle();
    const wrap = fwrap();
    expect(wrap.querySelector('p[data-hunksum="f1:hash-sum-1"]')).not.toBeNull();
    expect(wrap.querySelector("a.cx.pg")).toBeNull();
  });
});
