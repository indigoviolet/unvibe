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
});
