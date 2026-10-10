import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/**
 * POST /api/reviews · GET /api/reviews/:id ·
 * POST /api/reviews/:id/refresh · POST /api/reviews/:id/update ·
 * POST /api/reviews/:id/actions
 */
export async function registerReviews(app: FastifyInstance): Promise<void> {
  app.post("/api/reviews", async (_req, reply) => reply.code(501).send(TODO));
  app.get("/api/reviews/:id", async (_req, reply) => reply.code(501).send(TODO));
  app.post("/api/reviews/:id/refresh", async (_req, reply) => reply.code(501).send(TODO));
  app.post("/api/reviews/:id/update", async (_req, reply) => reply.code(501).send(TODO));
  app.post("/api/reviews/:id/actions", async (_req, reply) => reply.code(501).send(TODO));
}
