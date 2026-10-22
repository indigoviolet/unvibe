/**
 * Answer diagrams (issues #71, #136): a diagram block stored in a
 * conversation turn renders through the same on-demand path as card
 * diagrams — the web requests the SVG by the block's hash and inlines
 * it, in both themes.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { useReview } from "../../state/store.js";
import { clearD2SvgCache } from "../D2Diagram.js";
import { ExpansionCard } from "./ExpansionCard.js";

// jsdom has no matchMedia: pretend the OS prefers light.
function stubMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    configurable: true,
    writable: true,
  });
}
stubMatchMedia();

const REVIEW_ID = "exp-diagram-test";
const HASH = "exp-diagram-71hash";

const LIGHT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect id="box" width="10" height="10"/></svg>`;
const DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" data-t="dark"><rect id="box" width="10" height="10"/></svg>`;

function expansion(): Annotation {
  return {
    id: "ann_exp",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "c1#b1" },
      quotedText: "Why?",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [],
    post: false,
    note: false,
    working: null,
    turns: [
      {
        id: "ans_exp1",
        question: null,
        blocks: [
          {
            type: "diagram",
            id: "b-d1",
            source: "exp-a -> exp-b",
            citations: [],
            render: { hash: HASH, status: "unavailable" },
          },
        ],
        level: "standard",
        revision: 2,
        undoStack: [],
        working: null,
      },
    ],
  } as unknown as Annotation;
}

function seedSnapshot(ann: Annotation): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [
      {
        id: "root",
        kind: "root",
        title: "Root",
        cards: [
          {
            id: "c1",
            pageId: "root",
            title: "Card",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "Some text." }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ],
    annotations: [ann],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

beforeEach(() => {
  clearD2SvgCache();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});

describe("answer diagram rendering (#71, #136)", () => {
  test("an unavailable answer diagram fetches by hash and inlines the SVG, light then dark", async () => {
    const ann = expansion();
    seedSnapshot(ann);
    const spy = vi
      .spyOn(api, "diagramSvg")
      .mockImplementation(async (_r: string, _h: string, theme: string) =>
        theme === "dark" ? DARK_SVG : LIGHT_SVG,
      );
    try {
      render(
        <MemoryRouter>
          <ExpansionCard
            reviewId={REVIEW_ID}
            expansion={ann}
            lookupPage={() => undefined}
            onOpenPage={() => {}}
            onFollowUp={() => {}}
          />
        </MemoryRouter>,
      );
      // Light theme: fetched by the expansion block's hash, SVG inlined
      // inside the expansion card.
      await waitFor(() => expect(spy).toHaveBeenCalledWith(REVIEW_ID, HASH, "light"));
      await waitFor(() =>
        expect(document.querySelector('[data-expansion="ann_exp"] .dg-svg svg')).not.toBeNull(),
      );
      // Dark theme: refetches and swaps the SVG.
      act(() => {
        document.documentElement.setAttribute("data-theme", "dark");
      });
      await waitFor(() => expect(spy).toHaveBeenCalledWith(REVIEW_ID, HASH, "dark"));
      await waitFor(() =>
        expect(document.querySelector('[data-expansion="ann_exp"] .dg-svg svg[data-t="dark"]')).not.toBeNull(),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
