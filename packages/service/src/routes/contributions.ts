/**
 * Shared-context contributions (PRD §4.14, §9.5).
 *
 * - `GET /api/reviews/:id/contributions` — the review's contributions
 *   (read from `snapshot.contributions`).
 * - `DELETE /api/reviews/:id/contributions/:contributionId` — remove one
 *   item, any status, through `ReviewStore.mutate` (durable + WS patch).
 *   Deleting an item that had been shared writes the one-line deletion
 *   entry (PRD §9.3). 404 when the review or the contribution id is unknown.
 * - `POST /api/reviews/:id/contributions/:contributionId/accept` — accept a
 *   pending correction: creates a new card revision (undoable like any other
 *   card change) and marks the contribution accepted. Nothing is rewritten
 *   silently. 404 for unknown review/contribution, 409 when the contribution
 *   is not a pending correction.
 * - `POST /api/reviews/:id/contributions/:contributionId/dismiss` — discard
 *   a pending correction. Same 404/409 rules.
 *
 * The GET/DELETE contract is unchanged (the settings UI already uses it).
 */
import type { FastifyInstance } from "fastify";
import type {
  AcceptContributionResponse,
  ContributionsResponse,
  DeleteContributionResponse,
  DismissContributionResponse,
} from "@unvibe/shared";
import type { ServiceContext } from "./context.js";
import type { SharedContextService } from "../sharedctx/service.js";

type Ctx = ServiceContext & { sharedctx?: SharedContextService };

function codedToStatus(code: string): number {
  if (code === "unknown-review" || code === "unknown-contribution" || code === "unknown-card") return 404;
  return 409;
}

export async function registerContributions(app: FastifyInstance, ctx: Ctx): Promise<void> {
  const svc = (): SharedContextService | undefined => ctx.sharedctx;

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
    if (svc()) {
      try {
        const res = await svc()!.deleteContribution(id, contributionId);
        const body: DeleteContributionResponse = { ok: true, deletedId: res.deletedId };
        return body;
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        return reply.code(codedToStatus(code)).send({ error: (err as Error).message });
      }
    }
    await ctx.reviews.mutate(id, (draft) => {
      draft.contributions = draft.contributions.filter((c) => c.id !== contributionId);
      const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      draft.logTail.push({
        seq,
        kind: "deletion",
        payload: { summary: `contribution ${contributionId} deleted` },
        scope: { scope: "global" },
      });
    });
    const body: DeleteContributionResponse = { ok: true, deletedId: contributionId };
    return body;
  });

  app.post("/api/reviews/:id/contributions/:contributionId/accept", async (req, reply) => {
    const { id, contributionId } = req.params as { id: string; contributionId: string };
    if (!svc()) return reply.code(501).send({ error: "not available in this build" });
    try {
      const res = await svc()!.acceptContribution(id, contributionId);
      const body: AcceptContributionResponse = {
        ok: true,
        acceptedId: contributionId,
        cardId: res.cardId,
        revision: res.revision,
      };
      return body;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      return reply.code(codedToStatus(code)).send({ error: (err as Error).message });
    }
  });

  app.post("/api/reviews/:id/contributions/:contributionId/dismiss", async (req, reply) => {
    const { id, contributionId } = req.params as { id: string; contributionId: string };
    if (!svc()) return reply.code(501).send({ error: "not available in this build" });
    try {
      const res = await svc()!.dismissContribution(id, contributionId);
      const body: DismissContributionResponse = { ok: true, dismissedId: res.dismissedId };
      return body;
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      return reply.code(codedToStatus(code)).send({ error: (err as Error).message });
    }
  });
}
