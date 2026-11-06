/**
 * Issue #364: per-reply soft delete (no confirm, per the #346 thread
 * rule). Deleting tombstones the reply (same ID, position and blocks);
 * undelete restores it exactly. An answer goes with its question (one
 * stored turn); deleting the last *live* turn deletes the thread. Posted
 * content is never deletable.
 */
import { describe, expect, it } from "vitest";
import { produce, type WritableDraft } from "immer";
import type { Reply, ReplyKind, ReviewSnapshot, Thread } from "@unvibe/shared";
import { deleteReplyInDraft, threadPostText, undeleteReplyInDraft } from "../src/comments/threads.js";

let n = 0;

function reply(kind: ReplyKind, question: string | null, over: Partial<Reply> = {}): Reply {
  n += 1;
  return {
    id: `ans_t${n}`,
    kind,
    who: kind === "comment" ? "you" : "agent",
    question,
    blocks: [
      {
        type: "paragraph",
        id: "b1",
        text: { standard: `body ${n}` },
        citations: [],
      },
    ],
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

function run(threads: Thread[], fn: (draft: WritableDraft<ReviewSnapshot>) => void): Thread[] {
  const next = produce({ annotations: threads } as unknown as ReviewSnapshot, (draft) => {
    fn(draft);
  });
  return next.annotations as unknown as Thread[];
}

function remove(threads: Thread[], commentId: string, replyId: string): Thread[] {
  return run(threads, (draft) => deleteReplyInDraft(draft, commentId, replyId));
}

function restore(threads: Thread[], commentId: string, replyId: string): Thread[] {
  return run(threads, (draft) => undeleteReplyInDraft(draft, commentId, replyId));
}

describe("deleteReplyInDraft", () => {
  it("tombstones the reply in place: same ID and position, blocks kept", () => {
    const first = reply("ask", "first?");
    const second = reply("ask", "second?");
    const third = reply("comment", null);
    const out = remove([thread([first, second, third])], "ann_t", first.id);
    expect(out).toHaveLength(1);
    expect(out[0].replies.map((r) => r.id)).toEqual([first.id, second.id, third.id]);
    const tomb = out[0].replies[0];
    expect(tomb.deletedAt).toBeTypeOf("number");
    expect(tomb.question).toBe("first?");
    expect(tomb.blocks).toHaveLength(1);
    // Later turns stay live.
    expect(out[0].replies[1].deletedAt).toBeUndefined();
  });

  it("deleting the last live turn deletes the thread", () => {
    const only = reply("comment", null);
    const other = thread([reply("comment", null)], { id: "ann_other" });
    // One live + one tombstone: deleting the live one takes the thread.
    const gone = only;
    const start = [thread([gone, reply("comment", null, { deletedAt: 1 })]), other];
    const out = remove(start, "ann_t", gone.id);
    expect(out.map((t) => t.id)).toEqual(["ann_other"]);
  });

  it("refuses posted content", () => {
    const r = reply("comment", null);
    expect(() => remove([thread([r], { postedAt: 123 })], "ann_t", r.id)).toThrow(/posted content/);
  });

  it("allows tombstoning an Outbox (unposted) comment reply", () => {
    const r = reply("comment", null);
    const out = remove([thread([r], { post: true })], "ann_t", r.id);
    // No live turns remain, so the thread itself goes (Outbox entry with it).
    expect(out).toHaveLength(0);
  });

  it("refuses a reply that is still filling", () => {
    const r = reply("ask", "q?", { jobId: "job_1", working: "Writing answer" });
    expect(() => remove([thread([r])], "ann_t", r.id)).toThrow(/still filling/);
  });

  it("refuses double delete; throws on unknown reply and unknown comment", () => {
    const r = reply("comment", null, { deletedAt: 7 });
    expect(() => remove([thread([r])], "ann_t", r.id)).toThrow(/already deleted/);
    const live = reply("comment", null);
    expect(() => remove([thread([live])], "ann_t", "ans_missing")).toThrow(/unknown reply/);
    expect(() => remove([thread([live])], "ann_missing", live.id)).toThrow(/unknown comment/);
  });
});

describe("undeleteReplyInDraft", () => {
  it("restores the turn exactly as it was", () => {
    const first = reply("ask", "first?");
    const second = reply("comment", null);
    const deleted = remove([thread([first, second])], "ann_t", first.id);
    const tomb = deleted[0].replies[0];
    const at = tomb.deletedAt;
    expect(at).toBeTypeOf("number");
    const out = restore(deleted, "ann_t", first.id);
    expect(out[0].replies[0].deletedAt).toBeUndefined();
    expect(out[0].replies[0]).toEqual({ ...tomb, deletedAt: undefined } as unknown as Reply);
    expect(out[0].replies.map((r) => r.id)).toEqual([first.id, second.id]);
  });

  it("refuses a reply that is not deleted, and unknown replies", () => {
    const live = reply("comment", null);
    expect(() => restore([thread([live])], "ann_t", live.id)).toThrow(/not deleted/);
    expect(() => restore([thread([live])], "ann_t", "ans_missing")).toThrow(/unknown reply/);
  });
});

describe("threadPostText skips tombstones", () => {
  it("ignores deleted comment replies", () => {
    const t = thread([reply("comment", null, { deletedAt: 5 }), reply("comment", "kept")]);
    // Second reply has no question; give it text via blocks (already has body).
    expect(threadPostText(t)).toContain("body");
    const onlyDeleted = thread([reply("comment", null, { deletedAt: 5 })]);
    expect(threadPostText(onlyDeleted)).toBe("");
  });
});
