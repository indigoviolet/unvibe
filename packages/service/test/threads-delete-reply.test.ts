/**
 * Issue #364: per-reply delete rules (no confirm, per the #346 thread
 * rule). An answer goes with its question (one stored turn); the last
 * turn deletes the thread; posted content is never deletable.
 */
import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Reply, ReplyKind, ReviewSnapshot, Thread } from "@unvibe/shared";
import { deleteReplyInDraft } from "../src/comments/threads.js";

let n = 0;

function reply(kind: ReplyKind, question: string | null, over: Partial<Reply> = {}): Reply {
  n += 1;
  return {
    id: `ans_t${n}`,
    kind,
    who: kind === "comment" ? "you" : "agent",
    question,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...over,
  };
}

function thread(replies: Reply[], over: Partial<Thread> = {}): Thread {
  return {
    id: "ann_t",
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "c#b1" },
      quotedText: "q",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    replies,
    open: true,
    pinned: false,
    post: false,
    ...over,
  };
}

function run(threads: Thread[], commentId: string, replyId: string): Thread[] {
  const next = produce({ annotations: threads } as unknown as ReviewSnapshot, (draft) => {
    deleteReplyInDraft(draft, commentId, replyId);
  });
  return next.annotations as unknown as Thread[];
}

describe("deleteReplyInDraft", () => {
  it("deletes an answer together with its question turn; later turns stay", () => {
    const first = reply("ask", "first?");
    const second = reply("ask", "second?");
    const third = reply("comment", null);
    const out = run([thread([first, second, third])], "ann_t", first.id);
    expect(out).toHaveLength(1);
    expect(out[0].replies.map((r) => r.id)).toEqual([second.id, third.id]);
  });

  it("deleting the last turn deletes the thread", () => {
    const only = reply("comment", null);
    const out = run([thread([only]), thread([reply("comment", null)], { id: "ann_other" })], "ann_t", only.id);
    expect(out.map((t) => t.id)).toEqual(["ann_other"]);
  });

  it("clears in-thread links pointing at the deleted reply", () => {
    const target = reply("explain", "quote");
    const src = reply("comment", null, { linkTo: target.id, linkText: "quote" });
    const out = run([thread([target, src])], "ann_t", target.id);
    expect(out[0].replies).toHaveLength(1);
    expect(out[0].replies[0].linkTo).toBeUndefined();
    expect(out[0].replies[0].linkText).toBeUndefined();
  });

  it("refuses posted content", () => {
    const r = reply("comment", null);
    expect(() => run([thread([r], { postedAt: 123 })], "ann_t", r.id)).toThrow(/posted content/);
  });

  it("allows deleting an Outbox (unposted) comment reply", () => {
    const r = reply("comment", null);
    const out = run([thread([r], { post: true })], "ann_t", r.id);
    expect(out).toHaveLength(0);
  });

  it("refuses a reply that is still filling", () => {
    const r = reply("ask", "q?", { jobId: "job_1", working: "Writing answer" });
    expect(() => run([thread([r])], "ann_t", r.id)).toThrow(/still filling/);
  });

  it("throws on unknown reply and unknown comment", () => {
    const r = reply("comment", null);
    expect(() => run([thread([r])], "ann_t", "ans_missing")).toThrow(/unknown reply/);
    expect(() => run([thread([r])], "ann_missing", r.id)).toThrow(/unknown comment/);
  });
});
