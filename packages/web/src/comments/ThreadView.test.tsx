/**
 * Comment thread behaviour against the mock API (`VITE_MOCK=1`):
 * typed text survives unrelated WS patches, Discard clears the box on an
 * existing comment (deletes a new one), Cmd/Ctrl+Enter sends through the
 * comments route, and "Ask the agent about this" opens the usual Ask
 * card on the comment's anchor, quoting the comment.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { ThreadView } from "./ThreadView.js";

const REVIEW_ID = "thread-test";

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_thread_test",
    type: "comment",
    anchor: {
      host: { kind: "block", blockId: "central#b1" },
      quotedText: "optional",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [{ who: "you", text: "First message" }],
    post: false,
    ...over,
  };
}

function seedSnapshot(): void {
  useReview.getState().clear();
  useReview.getState().setSnapshot({
    review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [thread()],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
  } as unknown as ReviewSnapshot);
}

beforeEach(() => {
  vi.useFakeTimers();
  seedSnapshot();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThreadView reply box", () => {
  test("typed text survives an unrelated WS patch", async () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "unsent draft" } });
    expect(box).toHaveValue("unsent draft");
    // An unrelated patch (jobs list) re-renders everything else on the page.
    const snap = useReview.getState().snapshot!;
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: snap.rev,
      headRev: snap.rev + 1,
      ops: [{ op: "replace", path: "/jobs", value: [] }],
    });
    expect(screen.getByLabelText("Reply")).toHaveValue("unsent draft");
  });

  test("Discard clears the box on an existing comment", async () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    const updateSpy = vi.spyOn(api, "updateComment").mockResolvedValue({ ok: true });
    render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    try {
      const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "to clear" } });
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(updateSpy).toHaveBeenCalledWith(REVIEW_ID, found.id, { reply: null });
      await vi.advanceTimersByTimeAsync(500);
      expect(screen.getByLabelText("Reply")).toHaveValue("");
    } finally {
      updateSpy.mockRestore();
    }
  });

  test("a reply sends through the comments route, never an agent action", async () => {
    const commenting = thread({ messages: [{ who: "you", text: "Nit" }] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const actionSpy = vi.spyOn(api, "action");
    const replySpy = vi.spyOn(api, "replyComment").mockResolvedValue({ ok: true });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    try {
      const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "And then?" } });
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      expect(replySpy).toHaveBeenCalledWith(REVIEW_ID, commenting.id, { text: "And then?" });
      expect(actionSpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      replySpy.mockRestore();
    }
  });

  test("a new comment offers Save and deletes on Discard", async () => {
    const fresh = thread({ messages: [], reply: "" });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [fresh] });
    const deleteSpy = vi.spyOn(api, "deleteComment").mockResolvedValue({ ok: true });
    render(<ThreadView reviewId={REVIEW_ID} thread={fresh} />);
    try {
      expect(screen.getByLabelText("New comment")).toHaveAttribute("placeholder", "Write a comment…");
      expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Discard" }));
      expect(deleteSpy).toHaveBeenCalledWith(REVIEW_ID, fresh.id);
    } finally {
      deleteSpy.mockRestore();
    }
  });

  test("comments carry the For-PR control", async () => {
    const commenting = thread({ messages: [{ who: "you", text: "Nit" }], post: true });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    expect(screen.getByRole("button", { name: /Marked for the PR/ })).toBeVisible();
  });
});

describe("ThreadView ask-about (issue #136)", () => {
  test("asks the agent about the comment text on the comment anchor", async () => {
    const commenting = thread({ messages: [{ who: "you", text: "Why is this so?" }] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: "ann_new" });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Ask the agent about this" }));
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "ask",
        quote: "Why is this so?",
        anchor: { where: "block", blockId: "central#b1" },
        message: "Why is this so?",
      });
    } finally {
      actionSpy.mockRestore();
    }
  });

  test("no ask-about without comment text", async () => {
    const empty = thread({ messages: [] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [empty] });
    const actionSpy = vi.spyOn(api, "action");
    render(<ThreadView reviewId={REVIEW_ID} thread={empty} />);
    try {
      // New (unsaved) comments offer no ask-about control.
      expect(screen.queryByRole("button", { name: "Ask the agent about this" })).toBeNull();
      expect(actionSpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
    }
  });
});
describe("ThreadView authorship (owner decision: icons, not text)", () => {
  test("the user's avatar is a person icon with a screen-reader name, and no visible author text", () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    const { container } = render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    const avatar = container.querySelector(".av.you");
    expect(avatar?.getAttribute("aria-label")).toBe("You");
    expect(avatar?.querySelector("svg")).not.toBeNull();
    // No visible "Me"/"You" text: the icon alone is the marker.
    expect(avatar?.textContent).toBe("");
    expect(container.querySelector(".msg .who")).toBeNull();
  });
});

describe("ThreadView suggested comments (issue #163)", () => {
  function suggested(over: Partial<Annotation> = {}): Annotation {
    return thread({
      anchor: {
        host: { kind: "diff-line", fileKey: "conn", line: 82 },
        quotedText: "_OBSOLETE_FOLD_RE",
        prefix: "",
        suffix: "",
        position: 82,
        version: 1,
      },
      messages: [{ who: "ai", text: "Consider a boundary test.", suggested: true }],
      post: false,
      ...over,
    });
  }

  function seedSuggested(s: Annotation): void {
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [s] });
  }

  test("an AI-suggested comment has no reply box", () => {
    const s = suggested();
    seedSuggested(s);
    const { container } = render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    // No composer at all: no textarea, no Reply/Save/Discard.
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    // The suggestion text itself still shows.
    expect(screen.getByText("Consider a boundary test.")).toBeInTheDocument();
  });

  test("a suggestion keeps ask-about, mark-for-PR, delete and close", () => {
    const s = suggested();
    seedSuggested(s);
    render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    expect(screen.getByRole("button", { name: "Ask the agent about this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark for the PR/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("ask-about on a suggestion asks on the comment anchor, quoting the suggestion", () => {
    const s = suggested();
    seedSuggested(s);
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: "ann_new" });
    render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Ask the agent about this" }));
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "ask",
        quote: "Consider a boundary test.",
        anchor: { where: "diff-line", fileKey: "conn", line: 82 },
        message: "Consider a boundary test.",
      });
    } finally {
      actionSpy.mockRestore();
    }
  });

  test("a user comment keeps its reply box", () => {
    const commenting = thread({ messages: [{ who: "you", text: "Nit" }] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    expect(screen.getByLabelText("Reply")).toBeInTheDocument();
  });
});
