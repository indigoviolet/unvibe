import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** GET /api/prompts?review=:id */
export async function registerPrompts(app: FastifyInstance): Promise<void> {
  app.get("/api/prompts", async (_req, reply) => reply.code(501).send(TODO));
}
