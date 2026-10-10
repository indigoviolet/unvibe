/**
 * Actions dispatcher (M3): one file per action kind.
 *
 * `generate` is implemented (Go deeper → Generate through the `runInFork`
 * seam); `second_opinion` is implemented via the isolated `secondopinion/`
 * module (own base, blind/check modes). Every other kind stays 501 here;
 * the next agent (interaction actions) extends this dispatcher with one
 * module per kind (`explain.ts`, `ask.ts`, `depth.ts`, ...).
 */
import type { FastifyReply } from "fastify";
import type { ReviewAction } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import { generateAction } from "./generate.js";
import { removeSecondOpinionAction, secondOpinionAction } from "./second_opinion.js";

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
  if (action.kind === "second_opinion") {
    if (!deps.pipeline || !deps.jobs || !deps.reviews) {
      return reply.code(501).send({ error: "not implemented: pipeline not wired" });
    }
    try {
      const res = await secondOpinionAction(
        deps.pipeline,
        deps.jobs,
        deps.reviews,
        deps.reviewId,
        action.cardId,
        action.mode,
      );
      return { accepted: true, jobId: res.jobId };
    } catch (err) {
      const msg = (err as Error).message;
      if (/unknown review|unknown card/.test(msg)) return reply.code(404).send({ error: msg });
      if (/different model|Settings/.test(msg)) return reply.code(400).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  }
  if (action.kind === "delete") {
    // Second-opinion removal travels over the generic `delete` action to
    // avoid a contract change: targetId `second-opinion:<cardId>:<mode>` or
    // a stored `so-…` opinion id. Other targets stay 501 for the
    // interaction-actions owner.
    const target = (action as { targetId?: string }).targetId ?? "";
    const soMatch =
      target.match(/^second-opinion:([^:]+):(blind|check)$/) ?? target.match(/^(so-.*)$/);
    if (soMatch && deps.pipeline && deps.jobs && deps.reviews) {
      try {
        if (soMatch[1].startsWith("so-")) {
          await removeSecondOpinionAction(
            deps.pipeline,
            deps.jobs,
            deps.reviews,
            deps.reviewId,
            "",
            undefined,
            soMatch[1],
          );
        } else {
          const [, cardId, mode] = target.match(/^second-opinion:([^:]+):(blind|check)$/)!;
          await removeSecondOpinionAction(
            deps.pipeline,
            deps.jobs,
            deps.reviews,
            deps.reviewId,
            cardId,
            mode as "blind" | "check",
          );
        }
        return { accepted: true };
      } catch (err) {
        const msg = (err as Error).message;
        if (/unknown second opinion|unknown card|unknown review/.test(msg)) {
          return reply.code(404).send({ error: msg });
        }
        return reply.code(500).send({ error: msg });
      }
    }
  }
  // Next agent extends here: explain | ask | note | depth | examples |
  // diagram | undo | read | collapse | promote | close | delete (other
  // targets). Each gets its own module under `actions/` and a branch here.
  return reply.code(501).send({ error: `not implemented: M3 actions (${action.kind})` });
}
