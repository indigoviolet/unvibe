import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** GET /api/repos · POST /api/repos · GET /api/repos/:id/changes */
export async function registerRepos(app: FastifyInstance): Promise<void> {
  app.get("/api/repos", async (_req, reply) => reply.code(501).send(TODO));
  app.post("/api/repos", async (_req, reply) => reply.code(501).send(TODO));
  app.get("/api/repos/:id/changes", async (_req, reply) => reply.code(501).send(TODO));
}
