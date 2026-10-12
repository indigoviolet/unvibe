/**
 * Jobs routes (PRD §14.1, §4.14 "Jobs").
 *
 * - `GET /api/jobs?review=:id` — jobs for a review (persisted; survives
 *   restart).
 * - `GET /api/jobs/:id` — one job.
 * - `GET /api/jobs/:id/prompt` — the exact prompt snapshot the job sent.
 * - `POST /api/jobs/:id/cancel` — cancel (AbortSignal, also while queued).
 * - `PATCH /api/jobs/:id` `{ priority }` — re-prioritise while queued.
 *
 * Without a wired queue the endpoints stay 501 stubs (scaffold behaviour).
 */
import type { FastifyInstance } from "fastify";
import type { RouteDeps } from "./deps.js";

export async function registerJobs(app: FastifyInstance, deps: RouteDeps = {}): Promise<void> {
  const TODO = { error: "not available in this build" };

  app.get("/api/jobs", async (req, reply) => {
    if (!deps.jobs) return reply.code(501).send(TODO);
    const q = req.query as Record<string, string | undefined>;
    const review = q["review"];
    if (!review) return reply.code(400).send({ error: "missing ?review=" });
    const jobs = deps.jobs.listByReview(review);
    return { jobs };
  });

  app.get("/api/jobs/:id", async (req, reply) => {
    if (!deps.jobs) return reply.code(501).send(TODO);
    const { id } = req.params as Record<string, string>;
    const job = deps.jobs.get(id ?? "");
    if (!job) return reply.code(404).send({ error: "unknown job" });
    return { job };
  });

  app.get("/api/jobs/:id/prompt", async (req, reply) => {
    if (!deps.jobs) return reply.code(501).send(TODO);
    const { id } = req.params as Record<string, string>;
    const job = deps.jobs.get(id ?? "");
    if (!job) return reply.code(404).send({ error: "unknown job" });
    if (job.promptSnapshot === undefined) {
      return reply.code(404).send({ error: "no prompt snapshot for job" });
    }
    return { jobId: job.id, promptSnapshot: job.promptSnapshot };
  });

  app.post("/api/jobs/:id/cancel", async (req, reply) => {
    if (!deps.jobs) return reply.code(501).send(TODO);
    const { id } = req.params as Record<string, string>;
    try {
      return { job: deps.jobs.cancel(id ?? "") };
    } catch {
      return reply.code(404).send({ error: "unknown job" });
    }
  });

  app.patch("/api/jobs/:id", async (req, reply) => {
    if (!deps.jobs) return reply.code(501).send(TODO);
    const { id } = req.params as Record<string, string>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body["priority"] !== "number") {
      return reply.code(400).send({ error: "body must be { priority: number }" });
    }
    try {
      return { job: deps.jobs.setPriority(id ?? "", body["priority"]) };
    } catch {
      return reply.code(404).send({ error: "unknown job" });
    }
  });
}
