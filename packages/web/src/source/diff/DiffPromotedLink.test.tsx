/**
 * Promoted links in the diff (issue #152, fault a): opening a
 * diff-anchored conversation as a page styles the anchor as a page link
 * at once — including while the moved answer is still filling (the link
 * annotation then still holds the unsettled turn) or has no content at
 * all. Before the fix promoted links were skipped from the diff marking
 * pass, so the quote lost its highlight and gained no link styling.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Thread, Hunk, ReviewFile, ReviewSnapshot, Reply } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { useDiffExpansionBindings } from "../../guide/expansions/DiffExpansions.js";
import { FileSection } from "./FileSection.js";

const REVIEW_ID = "diff-promoted-link";
const FILE_KEY = "f1";
const LINE_TEXT = "const answer = computeTotal(items);";

function hunk(): Hunk {
  return {
    contentHash: "hash-promoted-1",
    header: "@@ -1 +1 @@",
    newStart: 1,
    newEnd: 2,
    oldStart: 1,
    oldEnd: 2,
    added: 1,
    removed: 0,
    lines: [
      { kind: "ctx", oldLine: 1, newLine: 1, text: "import { items } from './data';" },
      { kind: "add", newLine: 2, text: LINE_TEXT },
    ],
  };
}

function file(): ReviewFile {
  return { fileKey: FILE_KEY, path: "src/a.rs", category: "source", hunks: [hunk()] };
}

/** A promoted link whose moved turn is still filling (empty page copy). */
function fillingLink(): Thread {
  const turn = {
    id: "ans_1",
    question: null,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    working: "Thinking…",
    jobId: "job-1",
  } as unknown as Reply;
  return {
    id: "ann_promoted",
    type: "link",
    anchor: {
      host: { kind: "diff-line", fileKey: FILE_KEY, line: 2 },
      quotedText: "computeTotal",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    replies: [],
    post: false,
    promotedToPage: "p-1",
    promotedTurns: [{ turnId: "ans_1", cardId: "c-1" }],
    turns: [turn],
  } as unknown as Thread;
}

/** A promoted link with no turns at all (settled move, empty answer). */
function emptyLink(): Thread {
  const { turns: _dropped, ...rest } = fillingLink() as unknown as Record<string, unknown>;
  void _dropped;
  const { promotedTurns: _mapping, ...bare } = rest;
  void _mapping;
  return bare as unknown as Thread;
}

function seedSnapshot(annotations: Thread[]): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "demo", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [file()],
    pages: [],
    annotations,
    hunkStates: [],
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

function Harness(): React.JSX.Element {
  const { lineSlots } = useDiffExpansionBindings(
    REVIEW_ID,
    () => undefined,
    () => {},
    () => {},
  );
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
          slots={lineSlots}
          commentedLines={new Set()}
          highlight={null}
          fileHighlighted={false}
          reviewId={REVIEW_ID}
          headCommit="head"
          baseCommit="base"
          contentAvailable
          briefs={null}
          states={new Map()}
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

function pageLink(): Element {
  const row = document.getElementById(`L-${FILE_KEY}-2`);
  expect(row).not.toBeNull();
  const link = row!.querySelector("td.c a.cx.pg[data-node='p-1']");
  expect(link).not.toBeNull();
  expect(link!.textContent).toContain("computeTotal");
  return link!;
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

describe("issue #152: promoted links keep a page-link mark in the diff", () => {
  test("a still-filling promoted turn marks the anchor as a page link", async () => {
    seedSnapshot([fillingLink()]);
    render(<Harness />);
    await settle();
    pageLink();
    // The moved card renders no slot under the line (it lives on the page).
    expect(document.querySelector("[data-expansion='ann_promoted']")).toBeNull();
  });

  test("an empty promoted link (no turns) still marks the anchor", async () => {
    seedSnapshot([emptyLink()]);
    render(<Harness />);
    await settle();
    pageLink();
  });
});
