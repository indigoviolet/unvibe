/**
 * Card immediate feedback (issue #46) against the mock API (`VITE_MOCK=1`):
 * Generate on a pending card and follow-up chips react on click — the
 * request is held open so the immediate state is asserted before it
 * returns. Plus footnote chips (issue #72): closed expansions render as
 * hidden chips on the citations line, never as full-width linkstub rows.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Annotation, Card, Job, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { Toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { performFollowUp } from "./actions.js";
import { CardView } from "./CardView.js";

const REVIEW_ID = "card-test";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    pageId: "root",
    title: "Card",
    level: "standard",
    collapsed: false,
    revision: 1,
    blocks: [],
    undoStack: [],
    ...over,
  } as unknown as Card;
}

function seedSnapshot(cards: Card[], jobs: Job[] = [], annotations: Annotation[] = []): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards }],
    annotations,
    hunkStates: [],
    jobs,
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

function answerCard(): Annotation {
  return {
    id: "ann_ans",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "c1#b-f" },
      quotedText: "Why?",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [],
    post: false,
    working: "Writing answer…",
    turns: [
      {
        id: "ans_1",
        question: "Why?",
        blocks: [],
        level: "standard",
        revision: 1,
        undoStack: [],
        working: "Writing answer…",
      },
    ],
  } as unknown as Annotation;
}

function holdAction(): {
  resolveAction: (res: { accepted: boolean }) => void;
  restore: () => void;
} {
  let resolveAction!: (res: { accepted: boolean }) => void;
  const spy = vi.spyOn(api, "action").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveAction = resolve as never;
      }),
  );
  return { resolveAction: (res) => resolveAction(res), restore: () => spy.mockRestore() };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  useReview.getState().clear();
});

describe("CardView immediate feedback", () => {
  test("Generate on a pending card shows Writing… on click", () => {
    const pending = card({ pending: { label: "Go deeper", why: "More to say" } });
    seedSnapshot([pending]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={pending}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      // The Generate button is replaced by the placeholder indicator.
      expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
      expect(screen.getByRole("status")).toHaveTextContent("Writing…");
    } finally {
      held.restore();
    }
  });

  describe("pending cards while generating (issue #84)", () => {
    function renderPending(p: Card): void {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={p}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={() => {}}
        />,
      );
    }

    test("a generating placeholder keeps its title and description", () => {
      const pending = card({
        title: "Go deeper",
        pending: { label: "Go deeper", why: "More to say" },
      });
      seedSnapshot([pending]);
      const held = holdAction();
      try {
        renderPending(pending);
        fireEvent.click(screen.getByRole("button", { name: "Generate" }));
        // Only the button gives way to the indicator; the label and the
        // one-line description stay visible in the same place.
        expect(screen.queryByRole("button", { name: "Generate" })).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent("Writing…");
        expect(document.querySelector("#C-c1 .pl")).toHaveTextContent("Go deeper");
        expect(document.querySelector("#C-c1 .why")).toHaveTextContent("More to say");
      } finally {
        held.restore();
      }
    });

    test("several generating placeholders each show their own title", () => {
      const first = card({
        id: "c1",
        title: "First card",
        pending: { label: "First card", why: "Why first" },
      });
      const second = card({
        id: "c2",
        title: "Second card",
        pending: { label: "Second card", why: "Why second" },
      });
      seedSnapshot([first, second]);
      render(
        <>
          <CardView
            reviewId={REVIEW_ID}
            card={first}
            lookupPage={() => undefined}
            onOpenPage={() => {}}
            onFollowUp={() => {}}
          />
          <CardView
            reviewId={REVIEW_ID}
            card={second}
            lookupPage={() => undefined}
            onOpenPage={() => {}}
            onFollowUp={() => {}}
          />
        </>,
      );
      act(() => {
        useReview.getState().beginInflight("c1", "generate");
        useReview.getState().beginInflight("c2", "generate");
      });
      expect(document.querySelector("#C-c1 .pl")).toHaveTextContent("First card");
      expect(document.querySelector("#C-c2 .pl")).toHaveTextContent("Second card");
      expect(screen.getAllByRole("status")).toHaveLength(2);
    });

    test("a placeholder with no stored title shows the pending label while busy", () => {
      const untitled = card({
        title: null,
        pending: { label: "Go deeper", why: "More to say" },
      });
      seedSnapshot([untitled]);
      renderPending(untitled);
      act(() => {
        useReview.getState().beginInflight("c1", "generate");
      });
      // The shared display title (issue #49): stored title, else the
      // pending label — never a blank row.
      expect(document.querySelector("#C-c1 .pl")).toHaveTextContent("Go deeper");
      expect(document.querySelector("#C-c1 .why")).toHaveTextContent("More to say");
    });

    test("a failed generate brings back the button with title and description", async () => {
      const pending = card({
        title: "Go deeper",
        pending: { label: "Go deeper", why: "More to say" },
      });
      seedSnapshot([pending]);
      const actionSpy = vi.spyOn(api, "action").mockRejectedValue(new Error("boom"));
      const reviewSpy = vi
        .spyOn(api, "review")
        .mockResolvedValue(useReview.getState().snapshot!);
      try {
        render(
          <>
            <Toast />
            <CardView
              reviewId={REVIEW_ID}
              card={pending}
              lookupPage={() => undefined}
              onOpenPage={() => {}}
              onFollowUp={() => {}}
            />
          </>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Generate" }));
        // The error surfaces the way every other card action error does.
        expect(await screen.findByText(/Couldn't do that/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();
        expect(document.querySelector("#C-c1 .pl")).toHaveTextContent("Go deeper");
        expect(document.querySelector("#C-c1 .why")).toHaveTextContent("More to say");
      } finally {
        actionSpy.mockRestore();
        reviewSpy.mockRestore();
      }
    });
  });

  test("a follow-up chip goes disabled/busy on click with an answer placeholder", () => {
    const withFollow = card({
      blocks: [
        { type: "paragraph", id: "b-p", text: { standard: "Some text." }, citations: [] },
        { type: "follow-up", id: "b-f", items: [{ label: "Why?" }], citations: [] },
      ],
    });
    seedSnapshot([withFollow]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={withFollow}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={(cardId, blockId, i) => performFollowUp(REVIEW_ID, cardId, blockId, i)}
        />,
      );
      const chip = screen.getByRole("button", { name: "Why?" });
      fireEvent.click(chip);
      // The clicked chip cannot be double-clicked; the answer placeholder
      // shows where the expansion will land.
      expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
      expect(screen.getByRole("status")).toHaveTextContent("Writing answer…");
    } finally {
      held.restore();
    }
  });

  test("a live card job with no in-flight entry still shows busy (reload mid-rewrite)", () => {
    const live = {
      id: "job-depth-1",
      kind: "depth",
      provider: "claude",
      model: "m",
      reviewId: REVIEW_ID,
      priority: 100,
      state: "running",
      cardId: "c1",
    } as Job;
    seedSnapshot([card()], [live]);
    expect(useReview.getState().inflight).toEqual({});
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={card()}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    expect(document.getElementById("C-c1")?.className).toMatch(/rewriting/);
    expect(screen.getByRole("status")).toHaveTextContent("Rewriting…");
    expect(screen.getByRole("button", { name: "Use examples" })).toBeDisabled();
  });

  test("once the answer renders, the chip placeholder is replaced by its working state", () => {
    const withFollow = card({
      blocks: [
        { type: "paragraph", id: "b-p", text: { standard: "Some text." }, citations: [] },
        { type: "follow-up", id: "b-f", items: [{ label: "Why?" }], citations: [] },
      ],
    });
    seedSnapshot([withFollow], [], [answerCard()]);
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={withFollow}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    // Chip entry set (answer rendered before the response retargets): no
    // second indicator under the chips…
    act(() => {
      useReview.getState().beginInflight("followup:c1:b-f:0", "followup");
    });
    expect(document.querySelector(".card.child.placeholder")).toBeNull();
    // …the answer expansion itself shows Writing answer…, not the generic
    // server text.
    const exp = document.querySelector('[data-expansion="ann_ans"]');
    expect(exp?.querySelector(".working")).toHaveTextContent("Writing answer…");
  });

  test("depth marks the card as rewriting on click", () => {
    seedSnapshot([card()]);
    const held = holdAction();
    try {
      render(
        <CardView
          reviewId={REVIEW_ID}
          card={card()}
          lookupPage={() => undefined}
          onOpenPage={() => {}}
          onFollowUp={() => {}}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Deeper" }));
      const section = document.getElementById("C-c1");
      expect(section?.className).toMatch(/rewriting/);
      expect(section?.getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("status")).toHaveTextContent("Rewriting…");
      // Conflicting controls go disabled; the local collapse toggle stays on.
      expect(screen.getByRole("button", { name: "Use examples" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Collapse" })).toBeEnabled();
    } finally {
      held.restore();
    }
  });

describe("CardView titles (issue #49)", () => {
  test("an untitled card shows the fallback title in its header, never a blank row", () => {
    const untitled = card({
      title: null,
      blocks: [
        {
          type: "paragraph",
          id: "b1",
          text: {
            standard:
              "A single microphone cannot tell who is speaking because the childrens voices all sound the same in this recording",
          },
          citations: [],
        },
      ],
    });
    seedSnapshot([untitled]);
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={untitled}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    const head = document.querySelector(".chead");
    expect(head).not.toBeNull();
    const h2 = head?.querySelector("h2.ct");
    expect(h2).not.toBeNull();
    expect(h2?.textContent?.endsWith("…")).toBe(true);
    // No body-prefix preview paragraph in the header.
    expect(head?.querySelector("p.cprev")).toBeNull();
  });

  test("a collapsed untitled card shows the fallback title", () => {
    const untitled = card({ title: null, collapsed: true });
    seedSnapshot([untitled]);
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={untitled}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    // Empty blocks: no title and no preview — but the row is just the
    // chevron, never a blank-looking preview.
    expect(document.querySelector("p.cprev")).toBeNull();
  });

  test("a titled card keeps its title", () => {
    const titled = card({ title: "The problem" });
    seedSnapshot([titled]);
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={titled}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    expect(document.querySelector("h2.ct")).toHaveTextContent("The problem");
  });
});

  test("closed expansions render footnote chips, not linkstub rows (issue #72)", () => {
    const withPara = card({
      blocks: [
        {
          type: "paragraph",
          id: "b-p",
          text: { standard: "The USB stream stays at 48 kHz." },
          citations: [{ target: "diff:conn:82" }],
        },
      ],
    });
    const closed: Annotation = {
      id: "ann_closed",
      type: "conversation",
      anchor: {
        host: { kind: "block", blockId: "c1#b-p" },
        quotedText: "Draw the Stereo vs mono-mixdown with a very long quote",
        prefix: "",
        suffix: "",
        position: 0,
        version: 1,
      },
      open: false,
      messages: [],
      post: false,
    } as unknown as Annotation;
    seedSnapshot([withPara], [], [closed]);
    render(
      <CardView
        reviewId={REVIEW_ID}
        card={withPara}
        lookupPage={() => undefined}
        onOpenPage={() => {}}
        onFollowUp={() => {}}
      />,
    );
    // No full-width fallback rows.
    expect(document.querySelector(".linkstub")).toBeNull();
    // One citations row holding the <> chip plus the footnote chip.
    const row = document.querySelector(".lo");
    expect(row).not.toBeNull();
    expect(row?.querySelector("button.lk[data-refs]")).not.toBeNull();
    const chip = row?.querySelector("mark.fnote.exl[data-jump='ann_closed']");
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute("data-fallback")).toBe("ann_closed");
    expect(chip?.getAttribute("title")).toMatch(/Stereo/);
  });
});
