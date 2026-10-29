/**
 * List citation layout (issue #165): every item keeps its own chip next
 * to its text, and no block-level `<> N` union row repeats them on a line
 * of its own. Footnotes still keep their row (without citations in it).
 */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { Thread, Block, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { BlockView, uncoveredListCitations } from "./BlockView.js";
import { resolveBlockCitations } from "./citations.js";

const FILE = {
  fileKey: "conn",
  path: "src/conn.py",
  category: "source" as const,
  hunks: [],
};

function seed(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: "r1", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [FILE],
    pages: [],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

function listBlock(): Block {
  return {
    type: "list",
    id: "b1",
    ordered: false,
    items: [
      { html: "First folds lazily", citations: [{ target: "diff:conn:1-2" }] },
      { html: "Second reads eagerly", citations: [{ target: "diff:conn:3-4" }] },
    ],
    citations: [{ target: "diff:conn:1-2" }, { target: "diff:conn:3-4" }],
  } as unknown as Block;
}

function footnote(): Thread {
  return {
    id: "e1",
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "b1" },
      quotedText: "a lost quote",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    replies: [],
    post: false,
  } as unknown as Thread;
}

describe("BlockView list citations (#165)", () => {
  it("keeps per-item chips and drops the block union row", () => {
    seed();
    const { container } = render(
      <BlockView
        block={listBlock()}
        level="standard"
        threads={[]}
        cardId="c1"
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // One chip per item, next to its text.
    for (const li of items) {
      expect(li.querySelector("button.lk[data-refs]")).not.toBeNull();
    }
    // No union row under the list.
    expect(container.querySelector(".lo-row")).toBeNull();
  });

  it("keeps a footnote row without citations when footnotes exist", () => {
    seed();
    const { container } = render(
      <BlockView
        block={listBlock()}
        level="standard"
        threads={[]}
        footnotes={[footnote()]}
        cardId="c1"
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    const row = container.querySelector(".lo-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector("button.lk")).toBeNull();
    expect(row?.querySelector("[data-jump='e1']")).not.toBeNull();
  });
});

describe("BlockView ordered start (issue #314)", () => {
  it("renders <ol start> only when the start is not 1", () => {
    seed();
    const started = {
      type: "list",
      id: "b1",
      ordered: true,
      start: 3,
      items: [
        { html: "third", citations: [] },
        { html: "fourth", citations: [] },
      ],
      citations: [],
    } as unknown as Block;
    const { container } = render(
      <BlockView
        block={started}
        level="standard"
        threads={[]}
        cardId="c1"
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    expect(container.querySelector("ol.lst")?.getAttribute("start")).toBe("3");

    const plain = { ...started, start: undefined } as unknown as Block;
    const second = render(
      <BlockView
        block={plain}
        level="standard"
        threads={[]}
        cardId="c1"
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    expect(second.container.querySelector("ol.lst")?.hasAttribute("start")).toBe(false);
  });
});

describe("uncoveredListCitations (issue #305)", () => {
  function resolved(targets: string[]) {
    const snap = useReview.getState().snapshot;
    if (!snap) throw new Error("no snapshot");
    return resolveBlockCitations(
      snap,
      targets.map((target) => ({ target })),
    );
  }

  it("returns block sources no item shows, skipping unverified ones", () => {
    seed();
    const out = uncoveredListCitations(
      resolved(["diff:conn:1-2", "diff:conn:9-9"]),
      [resolved(["diff:conn:1-2"])],
    );
    expect(out.map((c) => c.target)).toEqual(["diff:conn:9-9"]);
  });

  it("returns nothing when the items cover the block union", () => {
    seed();
    const out = uncoveredListCitations(
      resolved(["diff:conn:1-2", "diff:conn:3-4"]),
      [resolved(["diff:conn:1-2"]), resolved(["diff:conn:3-4"])],
    );
    expect(out).toEqual([]);
  });
});

describe("BlockView whole-list citations (issue #305)", () => {
  function citedList(): Block {
    return {
      type: "list",
      id: "b1",
      ordered: false,
      items: [
        { html: "First folds lazily", citations: [{ target: "diff:conn:1-2" }] },
        { html: "Second reads eagerly", citations: [{ target: "diff:conn:3-4" }] },
      ],
      // Whole-list source, shown on no item.
      citations: [
        { target: "diff:conn:1-2" },
        { target: "diff:conn:3-4" },
        { target: "diff:conn:5-6" },
      ],
    } as unknown as Block;
  }

  it("sits inline at the end of the last li, with no row below the list", () => {
    seed();
    const { container } = render(
      <BlockView
        block={citedList()}
        level="standard"
        threads={[]}
        cardId="c1"
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // Per-item chips stay on their items.
    expect(items[0]?.querySelector('button.lk[data-refs*="diff:conn:1-2"]')).not.toBeNull();
    expect(items[1]?.querySelector('button.lk[data-refs*="diff:conn:3-4"]')).not.toBeNull();
    // The whole-list source lands in the last item, inline after its chip.
    const lastChip = items[1]?.querySelector('button.lk[data-refs*="diff:conn:5-6"]');
    expect(lastChip).not.toBeNull();
    expect(lastChip?.closest("li")).toBe(items[1]);
    // No row between the list and the next block.
    expect(container.querySelector(".lo-row")).toBeNull();
  });
});
