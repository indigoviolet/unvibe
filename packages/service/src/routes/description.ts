import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** PUT /api/reviews/:id/description (local edit, pending until submit) */
export async function registerDescription(app: FastifyInstance): Promise<void> {
  app.put("/api/reviews/:id/description", async (_req, reply) => reply.code(501).send(TODO));
}
