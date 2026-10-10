/**
 * Shared-context contributions (PRD §4.14, §9.5; M8 settings contract).
 *
 * - `GET /api/reviews/:id/contributions` — the review's contributions
 *   (read from `snapshot.contributions`).
 * - `DELETE /api/reviews/:id/contributions/:contributionId` — remove one
 *   item, any status, through `ReviewStore.mutate` (durable + WS patch).
 *   404 when the review or the contribution id is unknown.
 *
 * The contribution pipeline itself (validation, dedupe, merge on rebuild)
 * is owned by another milestone; this route only serves and deletes what
 * the snapshot already holds.
 */
import type { FastifyInstance } from "fastify";
import type { ContributionsResponse, DeleteContributionResponse } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";

export async function registerContributions(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.get("/api/reviews/:id/contributions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    const body: ContributionsResponse = { contributions: snapshot.contributions };
    return body;
  });

  app.delete("/api/reviews/:id/contributions/:contributionId", async (req, reply) => {
    const { id, contributionId } = req.params as { id: string; contributionId: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: "unknown review" });
    if (!snapshot.contributions.some((c) => c.id === contributionId)) {
      return reply.code(404).send({ error: `unknown contribution ${contributionId}` });
    }
    await ctx.reviews.mutate(id, (draft) => {
      draft.contributions = draft.contributions.filter((c) => c.id !== contributionId);
    });
    const body: DeleteContributionResponse = { ok: true, deletedId: contributionId };
    return body;
  });
}
