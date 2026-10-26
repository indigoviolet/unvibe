/**
 * Regression tests for issue #101 (the `removeChild` crash itself).
 *
 * Cause: expansion anchor marks wrapped text nodes that React rendered
 * (diff `td.c` cells were React children, not `dangerouslySetInnerHTML`).
 * A marking pass unwraps those marks and calls `normalize()`, which
 * merges a React-tracked text node away; the next structural React render
 * of that cell (the plain → token-span highlight upgrade) then removed a
 * node that was no longer a child of its parent and React threw
 * `NotFoundError: ... not a child of this node` — the exact error from
 * the report, which unmounted the whole tree (white page).
 *
 * Fix: diff cells render their content as an opaque HTML string (see
 * `highlight/codeHtml.ts` + the rule in `comments/anchor.ts`), so marks
 * only ever touch anonymous nodes and React swaps the whole string.
 *
 * Each sequence below mirrors the app: the real `FileSection` + the real
 * `useDiffExpansionBindings` marking pass, then the token upgrade. Before
 * the fix every upgrade below threw `NotFoundError`; now none throws and
 * the marks and spans both land.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Thread, Hunk, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../../state/store.js";
import { useDiffExpansionBindings } from "../../guide/expansions/DiffExpansions.js";
import { FileSection } from "./FileSection.js";
import type { LineTokens } from "./highlight/tokenize.js";

const REVIEW_ID = "diff-anchor-crash";
const FILE_KEY = "f1";

const LINE_TEXT = "const answer = computeTotal(items);";

function hunk(): Hunk {
  return {
    contentHash: "hash-crash-1",
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
  // Unknown language: the live highlighter stays off; the test drives the
  // plain → span upgrade through the injected `tokens` prop instead.
  return { fileKey: FILE_KEY, path: "src/a.rs", category: "source", hunks: [hunk()] };
}

function expansion(): Thread {
  return {
    id: "ann_crash",
    type: "thread",
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
    note: false,
  } as unknown as Thread;
}

function otherExpansion(): Thread {
  const e = expansion();
  return { ...e, id: "ann_other", anchor: { ...e.anchor, quotedText: "NoSuchQuoteInAnyRow" } } as Thread;
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

type Tokens = ReadonlyMap<string, { old: (LineTokens | null)[]; new: (LineTokens | null)[] }>;

function spans(): Tokens {
  const seg = (text: string): LineTokens => [{ text, cls: "shk-kw", bold: false, italic: false }];
  return new Map([
    [
      "hash-crash-1",
      {
        old: [null, null],
        new: [null, seg(LINE_TEXT)],
      },
    ],
  ]);
}

function Harness({ tokens }: { tokens?: Tokens }): React.JSX.Element {
  const { lineSlots } = useDiffExpansionBindings(
    REVIEW_ID,
    () => undefined,
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
          tokens={tokens}
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

function markedRow(): Element {
  const row = document.getElementById(`L-${FILE_KEY}-2`);
  expect(row).not.toBeNull();
  expect(row!.querySelector("td.c mark.anc.exl[data-jump='ann_crash']")).not.toBeNull();
  return row!;
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

describe("issue #101: anchor marks vs diff highlight upgrade", () => {
  test("mark, re-mark, then token upgrade renders spans without throwing", async () => {
    seedSnapshot([expansion()]);
    const r = render(<Harness />);
    await settle();
    markedRow();

    // A second marking pass (staggered highlight completions and patch
    // arrivals re-run the effect on reload): unwrap + normalize.
    await act(async () => {
      useReview.getState().setSnapshot({ ...(useReview.getState().snapshot as ReviewSnapshot), annotations: [expansion(), otherExpansion()], rev: 2 });
    });
    await settle();

    // The highlight upgrade swaps the cell content for spans.
    await act(async () => {
      r.rerender(<Harness tokens={spans()} />);
    });
    const row = document.getElementById(`L-${FILE_KEY}-2`);
    expect(row).not.toBeNull();
    expect(row!.querySelector("td.c .shk-kw")).not.toBeNull();
  });

  test("a single marking pass followed by the upgrade renders without throwing", async () => {
    seedSnapshot([expansion()]);
    const r = render(<Harness />);
    await settle();
    markedRow();
    await act(async () => {
      r.rerender(<Harness tokens={spans()} />);
    });
    const row = document.getElementById(`L-${FILE_KEY}-2`);
    expect(row).not.toBeNull();
    expect(row!.querySelector("td.c .shk-kw")).not.toBeNull();
  });
});
