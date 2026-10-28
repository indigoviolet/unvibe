/**
 * Comment thread behaviour against the mock API (`VITE_MOCK=1`):
 * typed text survives unrelated WS patches, Discard clears the box on an
 * existing comment (deletes a new one), Cmd/Ctrl+Enter sends through the
 * comments route. Issue #301 removed the "Ask about this" header button:
 * the Reply box at the end of every thread is the way to ask the agent.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { Thread, ReviewSnapshot } from "@unvibe/shared";
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

function thread(over: Partial<Thread> = {}): Thread {
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
    const found = useReview.getState().snapshot?.annotations[0] as Thread;
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={found} /></MemoryRouter>);
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

  test("Discard clears the follow-up draft on an existing thread", async () => {
    const found = useReview.getState().snapshot?.annotations[0] as Thread;
    const updateSpy = vi.spyOn(api, "updateComment").mockResolvedValue({ ok: true });
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={found} /></MemoryRouter>);
    try {
      const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "to clear" } });
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(updateSpy).toHaveBeenCalledWith(REVIEW_ID, found.id, { followupDraft: null });
      await vi.advanceTimersByTimeAsync(500);
      expect(screen.getByLabelText("Reply")).toHaveValue("");
    } finally {
      updateSpy.mockRestore();
    }
  });

  test("a reply asks the agent, never the comments route", async () => {
    const commenting = thread({ replies: [mkReply("you", "Nit")] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, annotationId: "ann_new" });
    const replySpy = vi.spyOn(api, "replyComment").mockResolvedValue({ ok: true });
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={commenting} /></MemoryRouter>);
    try {
      const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "And then?" } });
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "reply",
        annotationId: commenting.id,
        message: "And then?",
      });
      expect(replySpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      replySpy.mockRestore();
    }
  });

  test("a new comment offers Save and deletes on Discard", async () => {
    const fresh = thread({ replies: [], reply: "" });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [fresh] });
    const deleteSpy = vi.spyOn(api, "deleteComment").mockResolvedValue({ ok: true });
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={fresh} /></MemoryRouter>);
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
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={commenting} /></MemoryRouter>);
    expect(screen.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible();
  });
});

describe("ThreadView ask-about removal (issue #301)", () => {
  test("no Ask about this button: the Reply box already asks the agent", async () => {
    const commenting = thread({ replies: [mkReply("you", "Why is this so?")] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const actionSpy = vi.spyOn(api, "action");
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={commenting} /></MemoryRouter>);
    try {
      expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
      expect(actionSpy).not.toHaveBeenCalled();
      // The Reply box is the way to ask.
      expect(screen.getByLabelText("Reply")).toBeInTheDocument();
    } finally {
      actionSpy.mockRestore();
    }
  });
});
describe("ThreadView authorship (owner decision: icons, not text)", () => {
  test("the user's avatar is a person icon with a screen-reader name, and no visible author text", () => {
    const found = useReview.getState().snapshot?.annotations[0] as Thread;
    const { container } = render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={found} /></MemoryRouter>);
    const avatar = container.querySelector(".av.you");
    expect(avatar?.getAttribute("aria-label")).toBe("You");
    expect(avatar?.querySelector("svg")).not.toBeNull();
    // No visible "Me"/"You" text: the icon alone is the marker.
    expect(avatar?.textContent).toBe("");
    expect(container.querySelector(".msg .who")).toBeNull();
  });

  test("avatars sit inline in the reply's first line; no avatar column (issue #301)", () => {
    const found = useReview.getState().snapshot?.annotations[0] as Thread;
    const { container } = render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={found} /></MemoryRouter>);
    const reply = container.querySelector(".spike-reply");
    expect(reply).not.toBeNull();
    // No two-column avatar layout: the old main wrapper is gone and the
    // avatar is the first child of the heading row.
    expect(reply?.querySelector(".spike-reply-main")).toBeNull();
    const head = reply?.querySelector(".spike-reply-head");
    expect(head?.firstElementChild?.classList.contains("av")).toBe(true);
  });
});

describe("ThreadView suggested comments (issue #163)", () => {
  function suggested(over: Partial<Thread> = {}): Thread {
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

  function seedSuggested(s: Thread): void {
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [s] });
  }

  test("an AI-suggested comment has no reply box", () => {
    const s = suggested();
    seedSuggested(s);
    const { container } = render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={s} /></MemoryRouter>);
    // No composer at all: no textarea, no Reply/Save/Discard.
    expect(container.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    // The suggestion text itself still shows.
    expect(screen.getByText("Consider a boundary test.")).toBeInTheDocument();
  });

  test("a suggestion keeps Outbox, delete and close (no ask-about)", () => {
    const s = suggested();
    seedSuggested(s);
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={s} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add to Outbox/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("a user comment keeps its reply box", () => {
    const commenting = thread({ replies: [mkReply("you", "Nit")] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={commenting} /></MemoryRouter>);
    expect(screen.getByLabelText("Reply")).toBeInTheDocument();
  });

  test("a suggested question is tagged apart from findings, with no reply box", () => {
    const s = suggested({
      replies: [mkReply("agent", "Is this covered?", { suggested: true, suggestedQuestion: true })],
    });
    seedSuggested(s);
    const { container } = render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={s} /></MemoryRouter>);
    expect(screen.getByText("Suggested question")).toBeInTheDocument();
    expect(container.querySelector("textarea")).toBeNull();
    // Same suggestion controls as findings minus ask-about (#301):
    // Outbox, delete, close.
    expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
  });

  test("a finding suggestion carries no question tag", () => {
    const s = suggested();
    seedSuggested(s);
    render(<MemoryRouter><ThreadView reviewId={REVIEW_ID} thread={s} /></MemoryRouter>);
    expect(screen.queryByText("Suggested question")).toBeNull();
  });
});
