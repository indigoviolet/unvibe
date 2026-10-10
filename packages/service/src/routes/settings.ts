import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** GET /api/settings · PUT /api/settings */
export async function registerSettings(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async (_req, reply) => reply.code(501).send(TODO));
  app.put("/api/settings", async (_req, reply) => reply.code(501).send(TODO));
}
