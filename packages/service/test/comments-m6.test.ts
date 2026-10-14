/**
 * M6 comments: create (reviewer / suggested), reply, open/close, mark
 * For PR, edit draft, delete — all through `ReviewStore.mutate` — plus
 * the actions-route seams. Agent replies live on conversation cards,
 * never in threads (#136 slice 2).
 */
import { describe, expect, it } from "vitest";
import { FakeCommandRunner } from "../src/exec/index.js";
import {
  closeAnnotation,
  createNoteThread,
  deleteAnnotation,
  replyInDraft,
} from "../src/comments/index.js";
import { locatePendingThreads } from "../src/comments/location.js";
import { setupReview, sourceFile } from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };

describe("comment threads", () => {
  it("creates a comment on a diff line (open, with prefix/suffix)", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
          quote: "y = 2",
          text: "why here?",
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      const snap = ctx.reviews.getSnapshot(reviewId);
      const t = snap?.annotations.find((a) => a.id === id);
      expect(t?.type).toBe("comment");
      expect(t?.open).toBe(true);
      // Issue #135: a Comment is for the PR by default.
      expect(t?.post).toBe(true);
      expect(t?.messages).toEqual([{ who: "you", text: "why here?" }]);
      expect(t?.anchor.host).toEqual({ kind: "diff-line", fileKey: "a-py", line: 2 });
      expect(snap?.rev).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("creates a first message on a guide block (starts closed)", async () => {    const runner = new FakeCommandRunner();
    const pages = [
      {
        id: "p1",
        kind: "root" as const,
        title: "Guide",
        saved: false,
        cards: [
          {
            id: "c1",
            pageId: "p1",
            title: "Card",
            level: "standard" as const,
            read: false,
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "the fast path is here" }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ];
    const { app, ctx, reviewId } = await setupReview(runner, { pages });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "block", blockId: "b1" },
          quote: "fast path",
          text: "explain this",
        },
      });
      expect(res.statusCode).toBe(201);
      const snap = ctx.reviews.getSnapshot(reviewId);
      expect(snap?.annotations[0].open).toBe(false);
      expect(snap?.annotations[0].anchor.prefix).toContain("the");
    } finally {
      await app.close();
    }
  });

  it("stores the client's selection offsets on the anchor (issue #166)", async () => {
    const runner = new FakeCommandRunner();
    const pages = [
      {
        id: "p1",
        kind: "root" as const,
        title: "Guide",
        saved: false,
        cards: [
          {
            id: "c1",
            pageId: "p1",
            title: "Card",
            level: "standard" as const,
            read: false,
            collapsed: false,
            revision: 1,
            blocks: [{ type: "paragraph", id: "b1", text: { standard: "the fast path is here" }, citations: [] }],
            undoStack: [],
          },
        ],
      },
    ];
    const { app, ctx, reviewId } = await setupReview(runner, { pages });
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "block", blockId: "b1" },
          quote: "fast path",
          text: "which one?",
          offsets: { start: 4, end: 13 },
        },
      });
      expect(res.statusCode).toBe(201);
      const snap = ctx.reviews.getSnapshot(reviewId);
      expect(snap?.annotations[0].anchor.startOffset).toBe(4);
      expect(snap?.annotations[0].anchor.endOffset).toBe(13);
    } finally {
      await app.close();
    }
  });

  it("leaves offsets absent when the client sends none (issue #166)", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
          quote: "y = 2",
          text: "why here?",
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      const snap = ctx.reviews.getSnapshot(reviewId);
      const t = snap?.annotations.find((a) => a.id === id);
      expect(t?.anchor.startOffset).toBeUndefined();
      expect(t?.anchor.endOffset).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("anchors a guide comment on one card when block ids repeat across cards (#78)", async () => {
    const runner = new FakeCommandRunner();
    const card = (id: string, text: string) => ({
      id,
      pageId: "p1",
      title: id,
      level: "standard" as const,
      read: false,
      collapsed: false,
      revision: 1,
      blocks: [{ type: "paragraph", id: "b1", text: { standard: text }, citations: [] }],
      undoStack: [],
    });
    const pages = [
      {
        id: "p1",
        kind: "root" as const,
        title: "Guide",
        saved: false,
        cards: [card("c1", "first card mentions the receiver"), card("c2", "second card names the receiver too")],
      },
    ];
    const { app, ctx, reviewId } = await setupReview(runner, { pages });
    try {
      const post = (blockId: string) =>
        app.inject({
          method: "POST",
          url: `/api/reviews/${reviewId}/comments`,
          headers: authed,
          payload: { anchor: { where: "block", blockId }, quote: "receiver", text: "?" },
        });
      expect((await post("c2#b1")).statusCode).toBe(201);
      expect((await post("b1")).statusCode).toBe(201);
      const [second, bare] = ctx.reviews.getSnapshot(reviewId)!.annotations;
      expect(second.anchor.host).toEqual({ kind: "block", blockId: "c2#b1" });
      expect(second.anchor.prefix).toContain("second card");
      // A bare id is stored against the first card that has the block.
      expect(bare.anchor.host).toEqual({ kind: "block", blockId: "c1#b1" });
    } finally {
      await app.close();
    }
  });

  it("rejects unknown anchors", async () => {
    const runner = new FakeCommandRunner();
    const { app, reviewId } = await setupReview(runner);
    try {
      const badBlock = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: { anchor: { where: "block", blockId: "nope" }, quote: "x" },
      });
      expect(badBlock.statusCode).toBe(400);
      const badFile = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: { anchor: { where: "diff-line", fileKey: "nope", line: 1 }, quote: "x" },
      });
      expect(badFile.statusCode).toBe(400);
      const unknown = await app.inject({
        method: "POST",
        url: "/api/reviews/nope/comments",
        headers: authed,
        payload: { anchor: { where: "diff-line", fileKey: "a-py", line: 1 }, quote: "x" },
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("creates agent-suggested comments (diff line only, not for PR)", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
          quote: "y = 2",
          suggested: true,
          suggestionText: "consider a test",
        },
      });
      expect(res.statusCode).toBe(201);
      const snap = ctx.reviews.getSnapshot(reviewId);
      const t = snap?.annotations[0];
      expect(t?.messages).toEqual([{ who: "ai", text: "consider a test", suggested: true }]);
      expect(t?.post).toBe(false);

      const badHost = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "block", blockId: "b1" },
          quote: "x",
          suggested: true,
          suggestionText: "s",
        },
      });
      expect(badHost.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("replies, patches post/draft/open/reply-box, and deletes", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner, { files: [sourceFile()] });
    try {
      const created = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "description", paragraphId: "d-p1" },
          quote: "First",
          text: "note text",
        },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };

      const badPara = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments`,
        headers: authed,
        payload: { anchor: { where: "description", paragraphId: "d-nope" }, quote: "x" },
      });
      expect(badPara.statusCode).toBe(400);

      const replied = await app.inject({
        method: "POST",
        url: `/api/reviews/${reviewId}/comments/${id}/replies`,
        headers: authed,
        payload: { text: "follow-up" },
      });
      expect(replied.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations[0].messages).toHaveLength(2);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${id}`,
        headers: authed,
        payload: { post: true, draft: "post me", open: true, reply: "box" },
      });
      expect(patched.statusCode).toBe(200);
      const t = ctx.reviews.getSnapshot(reviewId)?.annotations[0];
      expect(t?.post).toBe(true);
      expect(t?.draft).toBe("post me");
      expect(t?.reply).toBe("box");

      const cleared = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${id}`,
        headers: authed,
        payload: { draft: null, reply: null, open: false },
      });
      expect(cleared.statusCode).toBe(200);
      const t2 = ctx.reviews.getSnapshot(reviewId)?.annotations[0];
      expect(t2?.draft).toBeUndefined();
      expect(t2?.reply).toBeUndefined();
      expect(t2?.open).toBe(false);

      const empty = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${id}`,
        headers: authed,
        payload: {},
      });
      expect(empty.statusCode).toBe(400);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${reviewId}/comments/${id}`,
        headers: authed,
      });
      expect(deleted.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations).toHaveLength(0);

      const missing = await app.inject({
        method: "DELETE",
        url: `/api/reviews/${reviewId}/comments/${id}`,
        headers: authed,
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("exposes actions-route seams", async () => {    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const note = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 1 },
        quote: "x",
        text: "a note",
      });
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations).toHaveLength(1);

      const snap = ctx.reviews.getSnapshot(reviewId);
      const thread = snap?.annotations.find((a) => a.id === note.id);
      expect(thread?.messages).toEqual([{ who: "you", text: "a note" }]);

      await closeAnnotation(ctx.reviews, reviewId, note.id);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations.find((a) => a.id === note.id)?.open).toBe(false);

      await deleteAnnotation(ctx.reviews, reviewId, note.id);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe("comments for the PR (issue #135)", () => {
  it("a Comment is for the PR by default", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const note = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 1 },
        quote: "x",
        text: "a comment",
      });
      const snap = ctx.reviews.getSnapshot(reviewId)!;
      const noteThread = snap.annotations.find((a) => a.id === note.id)!;
      expect(noteThread.type).toBe("comment");
      expect(noteThread.post).toBe(true);
      // A comment and its reply start no agent job.
      await ctx.reviews.mutate(reviewId, (draft) => {
        replyInDraft(draft, note.id, "a reply");
      });
      expect(ctx.jobs.listByReview(reviewId)).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("only Comments are submitted; conversation cards never are", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const { id: commentId } = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 1 },
        quote: "x",
        text: "ship it",
      });
      // A conversation card is never submitted, even marked: force the
      // mark directly (nothing sets it).
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.annotations.push({
          id: "ann_card",
          type: "conversation",
          anchor: {
            host: { kind: "diff-line", fileKey: "a-py", line: 2 },
            quotedText: "y",
            prefix: "",
            suffix: "",
            position: 0,
            version: 1,
          },
          open: true,
          messages: [],
          post: true,
          turns: [],
        } as never);
      });
      const pending = locatePendingThreads(ctx.reviews.getSnapshot(reviewId)!);
      expect(pending.map((p) => p.thread.id)).toEqual([commentId]);
    } finally {
      await app.close();
    }
  });

  it("PATCH pinned stores the pin on a conversation and rejects it on a comment (#167)", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      await ctx.reviews.mutate(reviewId, (draft) => {
        draft.annotations.push({
          id: "ann_pin",
          type: "conversation",
          anchor: { host: { kind: "block", blockId: "c1#b1" }, quotedText: "q", prefix: "", suffix: "", position: 0, version: 1 },
          open: true,
          pinned: false,
          messages: [],
          post: false,
          turns: [],
        } as never);
      });
      const pin = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/ann_pin`,
        headers: authed,
        payload: { pinned: true },
      });
      expect(pin.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations.find((a) => a.id === "ann_pin")?.pinned).toBe(true);
      const unpin = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/ann_pin`,
        headers: authed,
        payload: { pinned: false },
      });
      expect(unpin.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations.find((a) => a.id === "ann_pin")?.pinned).toBe(false);
      const { id: commentId } = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
        quote: "y",
        text: "why?",
      });
      const onComment = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${commentId}`,
        headers: authed,
        payload: { pinned: true },
      });
      expect(onComment.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("marks post on a comment in both directions", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const { id: commentId } = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
        quote: "y",
        text: "why?",
      });
      const mark = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${commentId}`,
        headers: authed,
        payload: { post: true },
      });
      expect(mark.statusCode).toBe(200);
      const unmark = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${reviewId}/comments/${commentId}`,
        headers: authed,
        payload: { post: false },
      });
      expect(unmark.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
