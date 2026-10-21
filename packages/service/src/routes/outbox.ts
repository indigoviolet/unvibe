/**
 * Outbox export (#223): `GET /api/reviews/:id/outbox` returns the export
 * Markdown for the review's Outbox (Copy only; no download). Built with
 * the shared pure builder so every review kind — PR, branch, documents
 * (#222) — exports identically. Read-only: no agent calls, no GitHub.
 */
import type { FastifyInstance } from "fastify";
import { buildOutboxExportMarkdown, isDefaultGuideTitle, outboxThreads } from "@unvibe/shared";
import type { ServiceContext } from "./context.js";
import { ingestRefusal } from "../reviews/index.js";

export async function registerOutbox(app: FastifyInstance, ctx?: ServiceContext): Promise<void> {
  if (!ctx) {
    app.get("/api/reviews/:id/outbox", async (_req, reply) =>
      reply.code(501).send({ error: "not available in this build" }),
    );
    return;
  }
  app.get("/api/reviews/:id/outbox", async (req, reply) => {
    const { id } = req.params as { id: string };
    const snapshot = ctx.reviews.getSnapshot(id);
    if (!snapshot) return reply.code(404).send({ error: `unknown review ${id}` });
    const refused = ingestRefusal(snapshot);
    if (refused) return reply.code(409).send({ error: refused });
    const rootTitle = snapshot.pages.find((p) => p.kind === "root")?.title;
    const title =
      rootTitle && !isDefaultGuideTitle(rootTitle) ? rootTitle : snapshot.review.branch || id;
    return {
      markdown: buildOutboxExportMarkdown(snapshot, { title }),
      count: outboxThreads(snapshot).length,
    };
  });
}
