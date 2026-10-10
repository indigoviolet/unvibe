import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** POST /api/reviews/:id/submit — the ONLY path that posts to GitHub. */
export async function registerSubmit(app: FastifyInstance): Promise<void> {
  app.post("/api/reviews/:id/submit", async (_req, reply) => reply.code(501).send(TODO));
}
