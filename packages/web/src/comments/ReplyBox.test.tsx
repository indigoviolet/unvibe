/**
 * Reply-box draft race (follow-up to the unified card work): once a send
 * is accepted the box is empty and stays empty — a debounce tick
 * scheduled before the send can never write the sent text back, and the
 * stored draft is cleared. A failed send keeps the text. Discard behaves
 * the same. Unsent text still persists (debounce + unmount flush) and
 * server drafts still flow in, so drafts survive reloads.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { api } from "../api/client.js";
import { ReplyBox } from "./ReplyBox.js";

const REVIEW_ID = "reply-test";
const ANN_ID = "ann_reply";

function show(over: Partial<React.ComponentProps<typeof ReplyBox>> = {}): {
  resolveSend: (v: unknown) => void;
  rejectSend: (e: unknown) => void;
} {
  let resolveSend!: (v: unknown) => void;
  let rejectSend!: (e: unknown) => void;
  const sendGate = new Promise<unknown>((res, rej) => {
    resolveSend = res;
    rejectSend = rej;
  });
  render(
    <ReplyBox
      reviewId={REVIEW_ID}
      annotationId={ANN_ID}
      serverReply={undefined}
      placeholder="Ask a follow-up…"
      ariaLabel="Ask a follow-up"
      sendLabel="Reply"
      discardLabel="Discard"
      onSend={() => sendGate}
      onDiscard={() => Promise.resolve()}
      {...over}
    />,
  );
  return { resolveSend, rejectSend };
}

function box(): HTMLTextAreaElement {
  return screen.getByLabelText("Ask a follow-up") as HTMLTextAreaElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(api, "updateComment").mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ReplyBox draft race", () => {
  test("typing persists through the debounce", async () => {
    show();
    fireEvent.change(box(), { target: { value: "And why?" } });
    expect(api.updateComment).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(api.updateComment).toHaveBeenCalledTimes(1);
    expect(api.updateComment).toHaveBeenCalledWith(REVIEW_ID, ANN_ID, { reply: "And why?" });
  });

  test("a late debounce tick cannot write the sent text back", async () => {
    const { resolveSend } = show();
    fireEvent.change(box(), { target: { value: "And why?" } });
    // Send before the 400ms debounce fires.
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await act(async () => {
      resolveSend({});
    });
    expect(box().value).toBe("");
    // Past the debounce: no persist of the sent text.
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.updateComment).not.toHaveBeenCalled();
    expect(box().value).toBe("");
  });

  test("a failed send keeps the text and still persists it", async () => {
    const { rejectSend } = show();
    fireEvent.change(box(), { target: { value: "And why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await act(async () => {
      rejectSend(new Error("no agent"));
    });
    // Nothing the reader typed is lost.
    expect(box().value).toBe("And why?");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.updateComment).toHaveBeenCalledWith(REVIEW_ID, ANN_ID, { reply: "And why?" });
  });

  test("discard wins over a pending persist", async () => {
    show();
    fireEvent.change(box(), { target: { value: "never mind" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await act(async () => {});
    expect(box().value).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.updateComment).not.toHaveBeenCalled();
  });

  test("send in flight, then unmount (answer being written): the sent text is never persisted back", async () => {
    const { resolveSend } = show();
    fireEvent.change(box(), { target: { value: "And why?" } });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    // #203: the card hides its reply box while the answer is written, so
    // the box unmounts before the send settles. The unmount flush must
    // not persist the consumed text — that would resurrect it as a
    // draft on the server, and the remounted box would show it again.
    cleanup();
    await act(async () => {
      resolveSend({});
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(api.updateComment).not.toHaveBeenCalled();
    // The remounted box (answer arrived, server draft cleared) is empty.
    show({ serverReply: undefined });
    expect(box().value).toBe("");
  });

  test("unsent text flushes on unmount; server drafts flow back in", async () => {
    const first = show();
    void first;
    fireEvent.change(box(), { target: { value: "half typed" } });
    cleanup();
    expect(api.updateComment).toHaveBeenCalledWith(REVIEW_ID, ANN_ID, { reply: "half typed" });

    const second = show({ serverReply: "half typed" });
    void second;
    expect(box().value).toBe("half typed");
  });
});
