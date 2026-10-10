/**
 * Actions dispatcher (M3): one file per action kind.
 *
 * `generate` is implemented (Go deeper → Generate through the `runInFork`
 * seam). Every other kind stays 501 here; the next agent (interaction
 * actions) extends this dispatcher with one module per kind
 * (`explain.ts`, `ask.ts`, `depth.ts`, ...).
 */
import type { FastifyReply } from "fastify";
import type { ReviewAction } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import { generateAction } from "./generate.js";

export interface ActionDeps {
  pipeline?: Pipeline;
  jobs?: JobQueue;
  reviews?: ReviewStore;
}

export async function dispatchAction(
  action: ReviewAction,
  deps: ActionDeps & { reviewId: string },
  reply: FastifyReply,
): Promise<unknown> {
  if (action.kind === "generate") {
    if (!deps.pipeline || !deps.jobs || !deps.reviews) {
      return reply.code(501).send({ error: "not implemented: pipeline not wired" });
    }
    try {
      const res = await generateAction(deps.pipeline, deps.jobs, deps.reviews, deps.reviewId, action.cardId);
      return { accepted: true, jobId: res.jobId };
    } catch (err) {
      const msg = (err as Error).message;
      if (/no pending card|unknown review/.test(msg)) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  }
  // Next agent extends here: explain | ask | note | depth | examples |
  // diagram | undo | read | collapse | second_opinion | promote | close |
  // delete. Each gets its own module under `actions/` and a branch here.
  return reply.code(501).send({ error: `not implemented: M3 actions (${action.kind})` });
}
