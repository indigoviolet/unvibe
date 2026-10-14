/**
 * Hunk state (PRD §4.13) + M3 summarize (PRD §11.5, §4.13 "Fold all").
 *
 * - `PATCH /api/reviews/:id/hunks/:hash` — folded / reviewed / note /
 *   summary (null clears note/summary), keyed by content hash so state
 *   survives rebases, applied through `ReviewStore.mutate` (rev bump +
 *   RFC 6902 patch event on the WS bus).
 * - `POST …/hunks/:hash/summarize` — one-hunk summarize on demand at user
 *   priority (small model, no fork). "Fold all" is the client calling this
 *   per hunk missing a summary (documented in `docs/pipeline.md`); no batch
 *   endpoint is needed because jobs dedupe per hunk hash.
 * - `PATCH /api/reviews/:id/diff-filter` — the diff's score/plotline
 *   filter (issue #169), remembered with the review. Each field is a
 *   plotline id (or "other") / score level; explicit null clears it.
 */
import type { FastifyInstance } from "fastify";
import { normalizeHunkScore, PLOTLINE_OTHER_ID } from "@unvibe/shared";
import type { UpdateDiffFilterRequest, UpdateHunkRequest } from "@unvibe/shared";
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
    const { folded, reviewed, note, summary } = body;
    if (folded !== undefined && typeof folded !== "boolean") {
      return reply.code(400).send({ error: "folded must be a boolean" });
    }
    if (reviewed !== undefined && typeof reviewed !== "boolean") {
      return reply.code(400).send({ error: "reviewed must be a boolean" });
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      return reply.code(400).send({ error: "note must be a string or null" });
    }
    if (summary !== undefined && summary !== null && typeof summary !== "string") {
      return reply.code(400).send({ error: "summary must be a string or null" });
    }
    if (folded === undefined && reviewed === undefined && note === undefined && summary === undefined) {
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
        if (note === null) {
          delete entry.note;
        } else if (note !== undefined) {
          entry.note = note;
        }
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

  app.patch("/api/reviews/:id/diff-filter", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as UpdateDiffFilterRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid filter body" });
    }
    const { plotline, score } = body;
    if (plotline !== undefined && plotline !== null && typeof plotline !== "string") {
      return reply.code(400).send({ error: "plotline must be a plotline or null" });
    }
    if (score !== undefined && score !== null && normalizeHunkScore(score) === null) {
      return reply.code(400).send({ error: "score must be mechanical, routine, substantive or needs-attention" });
    }
    if (plotline === undefined && score === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });
    if (typeof plotline === "string") {
      const ids = new Set([...(snapshot.plotlines ?? []).map((p) => p.id), PLOTLINE_OTHER_ID]);
      if (!ids.has(plotline)) return reply.code(400).send({ error: `unknown plotline ${plotline}` });
    }

    try {
      await ctx.reviews.mutate(id, (draft) => {
        const next = { ...(draft.diffFilter ?? {}) };
        if (plotline === null) delete next.plotline;
        else if (plotline !== undefined) next.plotline = plotline;
        if (score === null) delete next.score;
        else if (score !== undefined) next.score = normalizeHunkScore(score) ?? undefined;
        if (next.score === undefined) delete next.score;
        if (Object.keys(next).length === 0) delete draft.diffFilter;
        else draft.diffFilter = next;
      });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    return { ok: true };
  });
}
