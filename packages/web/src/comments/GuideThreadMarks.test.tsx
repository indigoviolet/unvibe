/**
 * Guide comment marks (follow-up to the open-as-page staleness fix): the
 * marking pass re-runs on the route as well as the snapshot, so comment
 * marks drawn before leaving for a page come back on return — and still
 * open their thread.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { GuideThreadHooks } from "./GuideThreads.js";

const REVIEW_ID = "marks-test";

function thread(): Annotation {
  return {
    id: "thr_1",
    type: "comment",
    anchor: {
      host: { kind: "block", blockId: "central#b1" },
      quotedText: "fast path",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: false,
    messages: [{ who: "you", text: "A quiet comment" }],
    post: true,
  } as unknown as Annotation;
}

function seed(): void {
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
            id: "central",
            pageId: "root",
            title: "Central",
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "The fast path skips values." }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ],
    annotations: [thread()],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

/** Drives a real router navigation to `to` on mount/update. */
function Nav({ to }: { to: string }): null {
  const nav = useNavigate();
  useEffect(() => {
    nav(to);
  }, [nav, to]);
  return null;
}

function mountPage(): void {
  const page = document.createElement("div");
  page.id = "page";
  page.innerHTML =
    `<section class="ui-card" id="C-central">` +
    `<p class="prose sel" data-top="b1">The fast path skips values.</p>` +
    `</section>`;
  document.body.appendChild(page);
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  vi.spyOn(api, "updateComment").mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
  document.getElementById("page")?.remove();
  vi.restoreAllMocks();
});

describe("GuideThreadHooks marks across navigation", () => {
  test("marks redraw after the page remounts clean on route change, and open the thread", async () => {
    seed();
    mountPage();
    const { rerender } = render(
      <MemoryRouter initialEntries={["/review/r"]}>
        <GuideThreadHooks />
        <Nav to="/review/r" />
      </MemoryRouter>,
    );
    await settle();
    expect(document.querySelector('#page mark.anc[data-thr="thr_1"]')).not.toBeNull();

    // Leaving for a page and coming back: the guide remounts with clean
    // DOM (marks wiped) while the hooks stay mounted and the snapshot is
    // unchanged — the route trigger redraws the mark.
    document.getElementById("page")!.innerHTML =
      `<section class="ui-card" id="C-central">` +
      `<p class="prose sel" data-top="b1">The fast path skips values.</p>` +
      `</section>`;
    expect(document.querySelector('#page mark.anc[data-thr="thr_1"]')).toBeNull();
    rerender(
      <MemoryRouter initialEntries={["/review/r"]}>
        <GuideThreadHooks />
        <Nav to="/review/r/page/p-1" />
      </MemoryRouter>,
    );
    await settle();
    const mark = document.querySelector('#page mark.anc[data-thr="thr_1"]');
    expect(mark).not.toBeNull();

    // The redrawn mark still opens its thread.
    fireEvent.click(mark!);
    expect(api.updateComment).toHaveBeenCalledWith(REVIEW_ID, "thr_1", { open: true });
  });
});
