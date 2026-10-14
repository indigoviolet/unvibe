/**
 * List citation layout (issue #165): every item keeps its own chip next
 * to its text, and no block-level `<> N` union row repeats them on a line
 * of its own. Footnotes still keep their row (without citations in it).
 */
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import type { Annotation, Block, ReviewSnapshot } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { BlockView } from "./BlockView.js";

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

function footnote(): Annotation {
  return {
    id: "e1",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "b1" },
      quotedText: "a lost quote",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [],
    post: false,
  } as unknown as Annotation;
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
