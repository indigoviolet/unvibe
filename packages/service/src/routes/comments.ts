/**
 * Comments (M6, PRD 4.8-4.9, 7, 14.1; #136 slice 2: every thread is a
 * comment — Ask makes conversation cards).
 *
 * - `POST /api/reviews/:id/comments` — create a comment with the user's
 *   first message (guide block, description paragraph, or diff line),
 *   or an agent-suggested comment (`suggested` on a diff line, never marked
 *   the Outbox initially).
 * - `POST …/comments/:commentId/replies` — user reply.
 * - `PATCH …/comments/:commentId` — `{ post?, draft?, open?, reply? }`:
 *   mark Outbox, edit the Outbox draft, open/close, reply-box content.
 * - `DELETE …/comments/:commentId` — delete the comment.
 *
 * Everything goes through `ReviewStore.mutate`. The `POST …/actions`
 * union (`note`, `close`, `delete`) overlaps: the actions route should call
 * `createNoteThread`, `closeAnnotation`, and `deleteAnnotation` from
 * `src/comments/threads.ts`.
 */
import type { FastifyInstance } from "fastify";
import type { ActionAnchor, CreateCommentRequest, UpdateCommentRequest } from "@unvibe/shared";
import {
  createSuggestedComment,
  createThread,
  deleteAnnotation,
  replyToThread,
} from "../comments/index.js";
import type { ServiceContext } from "./context.js";
import { ingestRefusal } from "../reviews/index.js";

function validAnchor(a: unknown): a is ActionAnchor {
  if (typeof a !== "object" || a === null) return false;
  const w = (a as { where?: unknown }).where;
  if (w === "block") return typeof (a as { blockId?: unknown }).blockId === "string";
  if (w === "description") {
    return typeof (a as { paragraphId?: unknown }).paragraphId === "string";
  }
  if (w === "diff-line") {
    const f = a as { fileKey?: unknown; line?: unknown };
    return typeof f.fileKey === "string" && Number.isSafeInteger(f.line);
  }
  if (w === "comment") return typeof (a as { commentId?: unknown }).commentId === "string";
  if (w === "hunk") {
    const f = a as { fileKey?: unknown; contentHash?: unknown };
    return typeof f.fileKey === "string" && typeof f.contentHash === "string";
  }
  if (w === "code") {
    const f = a as { path?: unknown; commit?: unknown; line?: unknown; endLine?: unknown };
    return (
      typeof f.path === "string" &&
      typeof f.commit === "string" &&
      Number.isSafeInteger(f.line) &&
      (f.endLine === undefined || Number.isSafeInteger(f.endLine))
    );
  }
  return false;
}

/** PATCH /api/reviews/:id/comments/:commentId + creation/reply/delete */
export async function registerComments(app: FastifyInstance, ctx?: ServiceContext): Promise<void> {
  if (!ctx) {
    app.patch("/api/reviews/:id/comments/:commentId", async (_req, reply) =>
      reply.code(501).send({ error: "not available in this build" }),
    );
    return;
  }
  const reviews = ctx.reviews;

  app.post("/api/reviews/:id/comments", async (req, reply) => {
    const { id } = req.params as { id: string };
    const pre = reviews.getSnapshot(id);
    if (pre) {
      const refused = ingestRefusal(pre);
      if (refused) return reply.code(409).send({ error: refused });
    }
    const body = (req.body ?? {}) as CreateCommentRequest;
    if (!validAnchor(body.anchor)) {
      return reply.code(400).send({ error: "anchor.where must be block, description, or diff-line with ids" });
    }
    if (typeof body.quote !== "string") {
      return reply.code(400).send({ error: "quote is required" });
    }
    if (body.suggested) {
      if (body.anchor.where !== "diff-line") {
        return reply.code(400).send({ error: "suggested comments must anchor on a diff line" });
      }
      if (typeof body.suggestionText !== "string" || body.suggestionText.trim() === "") {
        return reply.code(400).send({ error: "suggestionText is required" });
      }
      try {
        const { id: cid } = await createSuggestedComment(reviews, id, {
          anchor: body.anchor,
          quote: body.quote,
          ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
          ...(body.suffix !== undefined ? { suffix: body.suffix } : {}),
          ...(body.position !== undefined ? { position: body.position } : {}),
          suggestionText: body.suggestionText,
        });
        return reply.code(201).send({ id: cid });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.startsWith("unknown review")) return reply.code(404).send({ error: msg });
        return reply.code(400).send({ error: msg });
      }
    }
    if (body.text !== undefined && typeof body.text !== "string") {
      return reply.code(400).send({ error: "text must be a string" });
    }
    try {
      const { id: cid } = await createThread(reviews, id, {
        anchor: body.anchor,
        quote: body.quote,
        ...(body.prefix !== undefined ? { prefix: body.prefix } : {}),
        ...(body.suffix !== undefined ? { suffix: body.suffix } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.text !== undefined ? { text: body.text } : {}),
        ...(body.offsets !== undefined
          ? { startOffset: body.offsets.start, endOffset: body.offsets.end }
          : {}),
      });
      return reply.code(201).send({ id: cid });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("unknown review")) return reply.code(404).send({ error: msg });
      return reply.code(400).send({ error: msg });
    }
  });

  app.post("/api/reviews/:id/comments/:commentId/replies", async (req, reply) => {
    const { id, commentId } = req.params as { id: string; commentId: string };
    const preReply = reviews.getSnapshot(id);
    if (preReply) {
      const refused = ingestRefusal(preReply);
      if (refused) return reply.code(409).send({ error: refused });
    }
    const body = (req.body ?? {}) as { text?: unknown };
    if (typeof body.text !== "string" || body.text.trim() === "") {
      return reply.code(400).send({ error: "text is required" });
    }
    try {
      await replyToThread(reviews, id, commentId, body.text);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("unknown review") || msg.startsWith("unknown comment")) {
        return reply.code(404).send({ error: msg });
      }
      return reply.code(400).send({ error: msg });
    }
    return { ok: true };
  });

  app.patch("/api/reviews/:id/comments/:commentId", async (req, reply) => {
    const { id, commentId } = req.params as { id: string; commentId: string };
    const prePatch = reviews.getSnapshot(id);
    if (prePatch) {
      const refused = ingestRefusal(prePatch);
      if (refused) return reply.code(409).send({ error: refused });
    }
    const body = (req.body ?? {}) as UpdateCommentRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid comment patch body" });
    }
    const { post, draft, open, reply: replyBox, pinned } = body;
    if (post !== undefined && typeof post !== "boolean") {
      return reply.code(400).send({ error: "post must be a boolean" });
    }
    if (draft !== undefined && draft !== null && typeof draft !== "string") {
      return reply.code(400).send({ error: "draft must be a string or null" });
    }
    if (open !== undefined && typeof open !== "boolean") {
      return reply.code(400).send({ error: "open must be a boolean" });
    }
    if (replyBox !== undefined && replyBox !== null && typeof replyBox !== "string") {
      return reply.code(400).send({ error: "reply must be a string or null" });
    }
    if (pinned !== undefined && typeof pinned !== "boolean") {
      return reply.code(400).send({ error: "pinned must be a boolean" });
    }
    if (post === undefined && draft === undefined && open === undefined && replyBox === undefined && pinned === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }
    if (!reviews.getSnapshot(id)) return reply.code(404).send({ error: `unknown review ${id}` });
    try {
      await reviews.mutate(id, (draftState) => {
        const found = (
          draftState.annotations as Array<{ id: string; type: string; post: boolean; open: boolean; pinned: boolean; draft?: string; reply?: string }>
        ).find((a) => a.id === commentId);
        if (!found) throw new Error(`unknown comment ${commentId}`);
        // Issue #136: `open` and the reply-box draft (`reply`) apply to
        // conversation cards too (dotted-link click re-expands a closed
        // card in place). Post/draft stay comment-only: only comments post.
        if (open !== undefined && (found.type === "comment" || (found.type === "thread" || found.type === "link") || found.type === "link")) {
          found.open = open;
        } else if (open !== undefined) {
          throw new Error(`annotation ${commentId} is not a comment`);
        }
        if ((found.type === "thread" || found.type === "link")) {
          if (post !== undefined || draft !== undefined || draft === null) {
            throw new Error(`annotation ${commentId} is not a thread`);
          }
          // Issue #167: pinning is conversation-only and stored, so it
          // survives a reload.
          if (pinned !== undefined) found.pinned = pinned;
          if (replyBox === null) {
            delete found.reply;
          } else if (replyBox !== undefined) {
            found.reply = replyBox;
          }
          return;
        }
        if (found.type !== "comment") {
          if (post !== undefined || draft !== undefined || draft === null || replyBox !== undefined || replyBox === null || pinned !== undefined) {
            throw new Error(`annotation ${commentId} is not a comment`);
          }
          return;
        }
        if (pinned !== undefined) {
          throw new Error(`annotation ${commentId} is not a conversation`);
        }
        if (post !== undefined) {
          found.post = post;
          if (post) found.open = true;
        }
        if (draft === null) {
          delete found.draft;
        } else if (draft !== undefined) {
          found.draft = draft;
        }
        if (replyBox === null) {
          delete found.reply;
        } else if (replyBox !== undefined) {
          found.reply = replyBox;
        }
      });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("unknown review") || msg.startsWith("unknown comment")) {
        return reply.code(404).send({ error: msg });
      }
      return reply.code(400).send({ error: msg });
    }
    return { ok: true };
  });

  app.delete("/api/reviews/:id/comments/:commentId", async (req, reply) => {
    const { id, commentId } = req.params as { id: string; commentId: string };
    const preDel = reviews.getSnapshot(id);
    if (preDel) {
      const refused = ingestRefusal(preDel);
      if (refused) return reply.code(409).send({ error: refused });
    }
    try {
      await deleteAnnotation(reviews, id, commentId);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith("unknown review") || msg.startsWith("unknown comment")) {
        return reply.code(404).send({ error: msg });
      }
      return reply.code(400).send({ error: msg });
    }
    return { ok: true };
  });
}
