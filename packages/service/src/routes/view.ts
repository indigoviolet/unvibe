/**
 * Per-review diff view preferences (issue #168).
 *
 * - `PATCH /api/reviews/:id/view` — currently only
 *   `showExistingComments` (existing GitHub comments shown in the diff).
 *   Persisted on the snapshot through `ReviewStore.mutate`, so the choice
 *   is remembered with the review. The comments menu always lists every
 *   thread; hiding never removes comments from the agents' context.
 */
import type { FastifyInstance } from "fastify";
import type { UpdateViewRequest } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";
import { ingestRefusal } from "../reviews/index.js";

export async function registerView(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.patch("/api/reviews/:id/view", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as UpdateViewRequest;
    if (typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ error: "invalid view patch body" });
    }
    const { showExistingComments } = body;
    if (showExistingComments !== undefined && typeof showExistingComments !== "boolean") {
      return reply.code(400).send({ error: "showExistingComments must be a boolean" });
    }
    if (showExistingComments === undefined) {
      return reply.code(400).send({ error: "nothing to update" });
    }

    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });

    try {
      await ctx.reviews.mutate(id, (draft) => {
        draft.viewPrefs.showExistingComments = showExistingComments;
      });
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
    return { ok: true };
  });
}
