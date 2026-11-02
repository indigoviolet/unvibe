/**
 * `GET /api/stats/export` (issue #323): anonymized usage statistics as a
 * downloadable local file. Explicit only — nothing is uploaded, and the
 * read is SELECT-only over the live DB. See `docs/stats-export.md`.
 */
import type { FastifyInstance } from "fastify";
import { buildStatsExportFromDb } from "../stats/export.js";
import type { ServiceContext } from "./context.js";

export async function registerStats(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  app.get("/api/stats/export", async (_req, reply) => {
    if (!ctx.db) return reply.code(501).send({ error: "stats export is not available in this build" });
    const body = buildStatsExportFromDb(ctx.db);
    return reply
      .header("content-disposition", 'attachment; filename="unvibe-stats.json"')
      .send(body);
  });
}
