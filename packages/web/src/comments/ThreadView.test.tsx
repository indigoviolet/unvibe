/**
 * Thread reply-box behaviour against the mock API (`VITE_MOCK=1`):
 * typed text survives unrelated WS patches, Discard clears the box on an
 * existing thread, Cmd/Ctrl+Enter sends, and a failed agent reply shows
 * the error with a Retry button wired to the `retry` action.
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
    messages: [{ who: "you", text: "First message" }],
    post: false,
    note: true,
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

  test("Discard clears the box on an existing thread", async () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "to clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Reply")).toHaveValue("");
  });

  test("Discard stays disabled on an existing thread until there is a draft (issue #135)", async () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    // Empty reply box: Discard does nothing, so it is not offered.
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "hey" } });
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  });

  test("a new comment thread offers a comment placeholder, not an Ask one (issue #135)", async () => {
    const fresh = thread({ messages: [], reply: "" });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [fresh] });
    render(<ThreadView reviewId={REVIEW_ID} thread={fresh} />);
    expect(screen.getByLabelText("New comment")).toHaveAttribute("placeholder", "Write a comment…");
  });

  test("only comment threads carry the For-PR control (issue #135)", async () => {
    const asking = thread({ note: false, messages: [{ who: "you", text: "Why?" }], post: false });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [asking] });
    const { unmount } = render(<ThreadView reviewId={REVIEW_ID} thread={asking} />);
    expect(screen.queryByRole("button", { name: /Mark.*for the PR/ })).toBeNull();
    unmount();
    // A comment thread shows it…
    const commenting = thread({ note: true, messages: [{ who: "you", text: "Nit" }], post: true });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [commenting] });
    const { unmount: unmount2 } = render(<ThreadView reviewId={REVIEW_ID} thread={commenting} />);
    expect(screen.getByRole("button", { name: /Marked for the PR/ })).toBeVisible();
    unmount2();
    // …and an Ask thread never does, whatever its stored mark.
    const legacy = thread({ note: false, messages: [{ who: "you", text: "Old" }], post: true });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [legacy] });
    render(<ThreadView reviewId={REVIEW_ID} thread={legacy} />);
    expect(screen.queryByRole("button", { name: /Mark.*for the PR/ })).toBeNull();
  });

  test("a failed reply shows the error with a Retry button wired to the retry action", async () => {
    const failed = thread({
      note: false,
      messages: [{ who: "you", text: "Why?" }],
      error: "rate limited",
      working: null,
    });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [failed] });
    const spy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, threadId: failed.id });
    render(<ThreadView reviewId={REVIEW_ID} thread={failed} />);
    try {
      expect(screen.getByRole("alert")).toHaveTextContent(/rate limited/);
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(spy).toHaveBeenCalledWith(REVIEW_ID, { kind: "retry", threadId: failed.id });
    } finally {
      spy.mockRestore();
    }
  });

  test("an ask reply sends through the reply action, not the comments route", async () => {
    const asking = thread({ note: false, messages: [{ who: "you", text: "Why?" }] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [asking] });
    const actionSpy = vi.spyOn(api, "action").mockResolvedValue({ accepted: true, threadId: asking.id });
    const replySpy = vi.spyOn(api, "replyComment");
    render(<ThreadView reviewId={REVIEW_ID} thread={asking} />);
    try {
      const box = screen.getByLabelText("Reply") as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: "And then?" } });
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      expect(actionSpy).toHaveBeenCalledWith(REVIEW_ID, {
        kind: "reply",
        threadId: asking.id,
        message: "And then?",
      });
      expect(replySpy).not.toHaveBeenCalled();
    } finally {
      actionSpy.mockRestore();
      replySpy.mockRestore();
    }
  });

  test("reply shows a plain working state immediately on send, with no streamed text", async () => {
    const asking = thread({ note: false, messages: [{ who: "you", text: "Why?" }] });
    useReview.getState().setSnapshot({ ...useReview.getState().snapshot!, annotations: [asking] });
    // Hold the request open: the immediate state must show before it returns.
    let resolveAction!: (res: { accepted: boolean; threadId: string; jobId: string }) => void;
    const actionSpy = vi.spyOn(api, "action").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve as never;
        }),
    );
    render(<ThreadView reviewId={REVIEW_ID} thread={asking} />);
    try {
      fireEvent.change(screen.getByLabelText("Reply"), { target: { value: "And then?" } });
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      // Synchronous at click time, before the request returns.
      expect(screen.getByRole("status")).toHaveTextContent("Writing reply…");
      expect(document.querySelector(".working .stream")).toBeNull();
      // Still showing while the request is in flight (no flicker gap).
      resolveAction({ accepted: true, threadId: asking.id, jobId: "job-unseen" });
      await Promise.resolve();
      expect(screen.getByRole("status")).toHaveTextContent("Writing reply…");
    } finally {
      actionSpy.mockRestore();
    }
  });
});

describe("ThreadView authorship (issue #86, finding 21)", () => {
  test("the user's avatar and name read alike", () => {
    const found = useReview.getState().snapshot?.annotations[0] as Annotation;
    const { container } = render(<ThreadView reviewId={REVIEW_ID} thread={found} />);
    expect(container.querySelector(".av.you")?.textContent).toBe("You");
    expect(screen.getByText("You", { selector: ".who" })).toBeInTheDocument();
  });
});
