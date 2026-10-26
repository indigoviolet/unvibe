/**
 * Comment thread behaviour against the mock API (`VITE_MOCK=1`):
 * typed text survives unrelated WS patches, Discard clears the box on an
 * existing comment (deletes a new one), Cmd/Ctrl+Enter sends through the
 * comments route, and "Ask about this" opens the usual Ask
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

function mkReply(who: "you" | "agent", text: string, opts: { suggested?: boolean; suggestedQuestion?: boolean } = {}): import("@unvibe/shared").Reply {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    id: `ans_${who}_${Math.random().toString(36).slice(2, 6)}`,
    kind: "comment",
    who,
    question: null,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: esc }, citations: [] }],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...(opts.suggested ? { suggested: true } : {}),
    ...(opts.suggestedQuestion ? { suggestedQuestion: true } : {}),
  };
}

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_thread_test",
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "central#b1" },
      quotedText: "optional",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    pinned: false,
    replies: [mkReply("you", "First message")],
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
    const commenting = thread({ replies: [mkReply("you", "Nit")] });
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
    const fresh = thread({ replies: [], reply: "" });
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

  test("comments carry the Outbox control", async () => {
    const commenting = thread({ replies: [mkReply("you", "Nit")], post: true });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    expect(screen.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible();
  });
});

describe("ThreadView ask-about (issue #136)", () => {
  test("asks the agent about the comment text on the comment anchor", async () => {
    const commenting = thread({ replies: [mkReply("you", "Why is this so?")] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: "ann_new" });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
      // Issue #273: Ask about a comment appends inside the same thread.
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "ask",
        quote: "Why is this so?",
        threadId: "ann_thread_test",
        message: "Why is this so?",
      });
    } finally {
      actionSpy.mockRestore();
    }
  });

  test("no ask-about without comment text", async () => {
    const empty = thread({ replies: [] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [empty] });
    const actionSpy = vi.spyOn(api, "action");
    render(<ThreadView reviewId={REVIEW_ID} thread={empty} />);
    try {
      // New (unsaved) comments offer no ask-about control.
      expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
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
      replies: [mkReply("agent", "Consider a boundary test.", { suggested: true })],
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

  test("a suggestion keeps ask-about, Outbox, delete and close", () => {
    const s = suggested();
    seedSuggested(s);
    render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    expect(screen.getByRole("button", { name: "Ask about this" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add to Outbox/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("ask-about on a suggestion asks on the comment anchor, quoting the suggestion", () => {
    const s = suggested();
    seedSuggested(s);
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: "ann_new" });
    render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "ask",
        quote: "Consider a boundary test.",
        threadId: "ann_thread_test",
        message: "Consider a boundary test.",
      });
    } finally {
      actionSpy.mockRestore();
    }
  });

  test("a user comment keeps its reply box", () => {
    const commenting = thread({ replies: [mkReply("you", "Nit")] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    expect(screen.getByLabelText("Reply")).toBeInTheDocument();
  });

  test("a suggested question is tagged apart from findings, with no reply box", () => {
    const s = suggested({
      replies: [mkReply("agent", "Is this covered?", { suggested: true, suggestedQuestion: true })],
    });
    seedSuggested(s);
    const { container } = render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    expect(screen.getByText("Suggested question")).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    // Same suggestion controls as findings: ask-about, mark, delete, close.
    expect(screen.getByRole("button", { name: "Ask about this" })).toBeInTheDocument();
  });

  test("a finding suggestion carries no question tag", () => {
    const s = suggested();
    seedSuggested(s);
    render(<ThreadView reviewId={REVIEW_ID} thread={s} />);
    expect(screen.queryByText("Suggested question")).toBeNull();
  });
});
