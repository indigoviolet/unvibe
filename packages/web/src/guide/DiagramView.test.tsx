/**
 * Diagram caption inline markup (issue #48): a caption with backticked code
 * and a citation renders a `<code>` element plus a working citation chip,
 * never literal `<code>` text. Plain captions render unchanged.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { parseBlocks, type DiagramBlock, type ReviewSnapshot } from "@unvibe/shared";
import { BlockView } from "./BlockView.js";
import { REVEAL_EVENT } from "../source/reveal.js";
import { useReview } from "../state/store.js";

const REVIEW_ID = "caption-test";

// jsdom has no matchMedia: pretend the OS prefers light (as in D2Diagram.test).
Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
  configurable: true,
  writable: true,
});

function seedSnapshot(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

/** Parse one diagram block, pinning the render to the sync fallback. */
function diagramFrom(markdown: string): DiagramBlock {
  const blocks = parseBlocks(markdown);
  if (blocks[0]?.type !== "diagram") throw new Error("expected a diagram block");
  const block = blocks[0];
  // No hash: D2Diagram shows its source fallback synchronously (no fetch),
  // while the caption path under test renders unchanged.
  return { ...block, render: { hash: "", status: "unavailable" } };
}

function renderDiagram(block: DiagramBlock): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <BlockView
        block={block}
        level="standard"
        threads={[]}
        cardId="c1"
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("DiagramView caption (#48)", () => {
  test("renders inline code and a working citation chip, no literal tags", () => {
    const block = diagramFrom(
      "```d2\na -> b\n```\n\nCaption: One frame lands once, and only `child_cond` reaches the gate [[desc:p1]].\n",
    );
    // The parser stores the caption as sanitised HTML with the cite stripped
    // to block-level citations.
    expect(block.caption).toContain("<code>child_cond</code>");
    expect(block.caption).not.toContain("desc:p1");
    expect(block.citations).toEqual([{ target: "desc:p1" }]);

    seedSnapshot();
    const { container } = renderDiagram(block);

    const cap = container.querySelector(".dg-cap");
    expect(cap).not.toBeNull();
    // Real <code> element, not escaped text.
    const code = cap?.querySelector("code");
    expect(code?.textContent).toBe("child_cond");
    expect(cap?.innerHTML).toContain("<code>");
    expect(cap?.innerHTML).not.toContain("&lt;code&gt;");
    expect(cap?.textContent).not.toContain("<code>");

    // The caption's citation lands on the block citations line as a chip.
    const chip = container.querySelector('button.lk[data-src="desc:p1"]');
    expect(chip).not.toBeNull();

    // Click-to-reveal: desc: targets dispatch the reveal event.
    // Own the reveal timers: flashParagraph schedules a 60 ms setTimeout
    // that can otherwise fire after this file's jsdom environment is gone.
    const seen: string[] = [];
    const onReveal = (e: Event): void => {
      seen.push((e as CustomEvent).detail.ref as string);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    vi.useFakeTimers();
    try {
      fireEvent.click(chip as Element);
      vi.advanceTimersByTime(3000);
      expect(seen).toEqual(["desc:p1"]);
    } finally {
      vi.useRealTimers();
      window.removeEventListener(REVEAL_EVENT, onReveal);
    }
  });

  test("plain caption renders unchanged", () => {
    const block = diagramFrom("```d2\na -> b\n```\n\nCaption: Where headers go after parsing.\n");
    expect(block.caption).toBe("Where headers go after parsing.");

    seedSnapshot();
    const { container } = renderDiagram(block);

    const cap = container.querySelector(".dg-cap");
    expect(cap?.textContent).toBe("Where headers go after parsing.");
    expect(cap?.querySelector("code")).toBeNull();
    // No citations: no chip row.
    expect(container.querySelector("button.lk")).toBeNull();
  });
});
