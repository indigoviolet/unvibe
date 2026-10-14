/**
 * Diff state (PRD §4.13) + M3 summarize (PRD §11.5, §4.13 "Fold all").
 *
 * - `PATCH /api/reviews/:id/hunks/:hash` — folded / reviewed / summary
 *   (null clears the summary), keyed by content hash so state survives
 *   rebases, applied through `ReviewStore.mutate` (rev bump + RFC 6902
 *   patch event on the WS bus).
 * - `PATCH /api/reviews/:id/files/:fileKey` — per-file fold state (issue
 *   #162), keyed by file key. Reviewed is derived from the file's hunks,
 *   never stored here.
 * - `POST …/hunks/:hash/summarize` — one-hunk summarize on demand at user
 *   priority (small model, no fork). "Fold all" is the client calling this
 *   per hunk missing a summary (documented in `docs/pipeline.md`); no batch
 *   endpoint is needed because jobs dedupe per hunk hash.
 */
import type { FastifyInstance } from "fastify";
import type { UpdateFileRequest, UpdateHunkRequest } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";
import type { Pipeline } from "../pipeline/index.js";
import { ingestRefusal } from "../reviews/index.js";

export async function registerHunks(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps & { pipeline?: Pipeline } = {},
): Promise<void> {
  app.patch("/api/reviews/:id/hunks/:hash", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    const body = (req.body ?? {}) as UpdateHunkRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid hunk patch body" });
    }
    const { folded, reviewed, summary } = body;
    if (folded !== undefined && typeof folded !== "boolean") {
      return reply.code(400).send({ error: "folded must be a boolean" });
    }
    if (reviewed !== undefined && typeof reviewed !== "boolean") {
      return reply.code(400).send({ error: "reviewed must be a boolean" });
    }
    if (summary !== undefined && summary !== null && typeof summary !== "string") {
      return reply.code(400).send({ error: "summary must be a string or null" });
    }
    if (folded === undefined && reviewed === undefined && summary === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });

    try {
      await ctx.reviews.mutate(id, (draft) => {
        let entry = draft.hunkStates.find((s) => s.contentHash === hash);
        if (!entry) {
          entry = { contentHash: hash, folded: false, reviewed: false };
          draft.hunkStates.push(entry);
        }
        if (folded !== undefined) entry.folded = folded;
        if (reviewed !== undefined) entry.reviewed = reviewed;
        if (summary === null) {
          delete entry.summary;
        } else if (summary !== undefined) {
          entry.summary = summary;
        }
      });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    return { ok: true };
  });

  app.patch("/api/reviews/:id/files/:fileKey", async (req, reply) => {
    const { id, fileKey } = req.params as { id: string; fileKey: string };
    const body = (req.body ?? {}) as UpdateFileRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid file patch body" });
    }
    const { folded } = body;
    if (folded !== undefined && typeof folded !== "boolean") {
      return reply.code(400).send({ error: "folded must be a boolean" });
    }
    if (folded === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });
    // No fallback for reviews opened before file fold state existed:
    // refuse plainly so the owner resets instead of silently diverging.
    if (!Array.isArray(snapshot.fileStates)) {
      return reply.code(409).send({ error: "this review predates file fold state — remove it and open it again" });
    }

    try {
      await ctx.reviews.mutate(id, (draft) => {
        let entry = draft.fileStates.find((s) => s.fileKey === fileKey);
        if (!entry) {
          entry = { fileKey, folded: false };
          draft.fileStates.push(entry);
        }
        if (folded !== undefined) entry.folded = folded;
      });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    return { ok: true };
  });

  app.post("/api/reviews/:id/hunks/:hash/summarize", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    void req;
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refusedSum = ingestRefusal(snapshot);
    if (refusedSum) return reply.code(409).send({ error: refusedSum });
    const pipeline = (deps as { pipeline?: Pipeline }).pipeline;
    if (!pipeline) return reply.code(501).send({ error: "not available in this build" });
    try {
      const res = await pipeline.summarizeHunk(id, hash);
      // PRD §12 reuse (#10): stored summary returns with no job, no tokens.
      if ("reused" in res) return reply.code(200).send({ reused: true, summary: res.summary });
      return reply.code(202).send({ jobId: res.id });
    } catch (err) {
      const msg = (err as Error).message;
      if (/unknown hunk/.test(msg)) return reply.code(404).send({ error: msg });
      if (/unknown review/.test(msg)) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });
}
