import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** PATCH /api/reviews/:id/comments/:commentId */
export async function registerComments(app: FastifyInstance): Promise<void> {
  app.patch("/api/reviews/:id/comments/:commentId", async (_req, reply) =>
    reply.code(501).send(TODO),
  );
}
