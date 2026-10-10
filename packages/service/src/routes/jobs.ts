import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** GET /api/jobs?review=:id */
export async function registerJobs(app: FastifyInstance): Promise<void> {
  app.get("/api/jobs", async (_req, reply) => reply.code(501).send(TODO));
}
