import type { FastifyInstance } from "fastify";

const TODO = { error: "not implemented" };

/** PATCH /api/reviews/:id/hunks/:hash · POST …/hunks/:hash/summarize */
export async function registerHunks(app: FastifyInstance): Promise<void> {
  app.patch("/api/reviews/:id/hunks/:hash", async (_req, reply) => reply.code(501).send(TODO));
  app.post("/api/reviews/:id/hunks/:hash/summarize", async (_req, reply) =>
    reply.code(501).send(TODO),
  );
}
