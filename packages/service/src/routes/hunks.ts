/**
 * Hunk state (PRD §4.13):
 * - `PATCH /api/reviews/:id/hunks/:hash` — folded / reviewed / note, keyed
 *   by content hash so state survives rebases, applied through
 *   `ReviewStore.mutate` (rev bump + RFC 6902 patch event on the WS bus).
 * - `POST …/hunks/:hash/summarize` stays 501: the agent milestone owns it.
 */
import type { FastifyInstance } from "fastify";
import type { UpdateHunkRequest } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";

const TODO_SUMMARY = { error: "not implemented: agent summarize (later milestone)" };

/** PATCH /api/reviews/:id/hunks/:hash · POST …/hunks/:hash/summarize */
export async function registerHunks(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.patch("/api/reviews/:id/hunks/:hash", async (req, reply) => {
    const { id, hash } = req.params as { id: string; hash: string };
    const body = (req.body ?? {}) as UpdateHunkRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid hunk patch body" });
    }
    const { folded, reviewed, note } = body;
    if (folded !== undefined && typeof folded !== "boolean") {
      return reply.code(400).send({ error: "folded must be a boolean" });
    }
    if (reviewed !== undefined && typeof reviewed !== "boolean") {
      return reply.code(400).send({ error: "reviewed must be a boolean" });
    }
    if (note !== undefined && note !== null && typeof note !== "string") {
      return reply.code(400).send({ error: "note must be a string or null" });
    }
    if (folded === undefined && reviewed === undefined && note === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });

    // Hunk state is keyed by content hash (PRD §8): unknown hashes are
    // accepted (the hunk may come from an older version) and upserted.
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
      });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    return { ok: true };
  });

  app.post("/api/reviews/:id/hunks/:hash/summarize", async (_req, reply) =>
    reply.code(501).send(TODO_SUMMARY),
  );
}
