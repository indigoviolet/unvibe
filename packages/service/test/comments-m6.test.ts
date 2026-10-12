/**
 * M6 threads: create (Note / Ask-first-message / suggested), reply,
 * open/close, mark For PR, edit draft, delete — all through
 * `ReviewStore.mutate` — plus the actions-route seams and the
 * `appendAgentReply` pipeline seam.
 */
import { describe, expect, it } from "vitest";
import { FakeCommandRunner } from "../src/exec/index.js";
import {
  appendAgentReply,
  closeAnnotation,
  createAskThread,
  createNoteThread,
  deleteAnnotation,
} from "../src/comments/index.js";
import { setupReview, sourceFile } from "./m6-helpers.js";

const authed = { authorization: "Bearer tok" };

describe("comment threads", () => {
  it("creates a Note on a diff line (open, with prefix/suffix)", async () => {
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
          note: true,
          text: "why here?",
        },
      });
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };
      const snap = ctx.reviews.getSnapshot(reviewId);
      const t = snap?.annotations.find((a) => a.id === id);
      expect(t?.type).toBe("thread");
      expect(t?.open).toBe(true);
      expect(t?.note).toBe(true);
      expect(t?.post).toBe(false);
      expect(t?.messages).toEqual([{ who: "you", text: "why here?" }]);
      expect(t?.anchor.host).toEqual({ kind: "diff-line", fileKey: "a-py", line: 2 });
      expect(snap?.rev).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("creates an Ask first message on a guide block (starts closed)", async () => {
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
          note: false,
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
          payload: { anchor: { where: "block", blockId }, quote: "receiver", note: true, text: "?" },
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
          note: true,
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

  it("exposes actions-route seams + the agent-reply seam", async () => {
    const runner = new FakeCommandRunner();
    const { app, ctx, reviewId } = await setupReview(runner);
    try {
      const note = await createNoteThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 1 },
        quote: "x",
        text: "a note",
      });
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations).toHaveLength(1);

      const ask = await createAskThread(ctx.reviews, reviewId, {
        anchor: { where: "diff-line", fileKey: "a-py", line: 2 },
        quote: "y",
        message: "a question",
      });
      await appendAgentReply(ctx.reviews, reviewId, ask.id, { text: "an answer" });
      const snap = ctx.reviews.getSnapshot(reviewId);
      const thread = snap?.annotations.find((a) => a.id === ask.id);
      expect(thread?.messages).toEqual([
        { who: "you", text: "a question" },
        { who: "ai", text: "an answer" },
      ]);

      await closeAnnotation(ctx.reviews, reviewId, note.id);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations.find((a) => a.id === note.id)?.open).toBe(false);

      await deleteAnnotation(ctx.reviews, reviewId, note.id);
      expect(ctx.reviews.getSnapshot(reviewId)?.annotations).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
