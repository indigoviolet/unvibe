/**
 * `second_opinion` action (PRD §4.10).
 *
 * Runs a second-opinion on any card or finding via the isolated
 * `secondopinion/` module (own L0 + L1 base, never a fork of the main
 * base; blind vs check modes; result attached to the card). The job runs
 * at user priority, is cancellable, dedupes by (card, mode, model,
 * version), and stores its prompt snapshot for Settings → Jobs.
 */
import type { SecondOpinionMode } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";
import type { SecondOpinionDeps } from "../../secondopinion/index.js";
import { requestSecondOpinion, removeSecondOpinion } from "../../secondopinion/index.js";

function depsFromPipeline(pipeline: Pipeline): SecondOpinionDeps {
  const opts = (pipeline as unknown as { opts: SecondOpinionDeps }).opts;
  return opts;
}

export async function secondOpinionAction(
  pipeline: Pipeline,
  _jobs: JobQueue,
  _reviews: ReviewStore,
  reviewId: string,
  cardId: string,
  mode: SecondOpinionMode,
): Promise<{ jobId: string }> {
  const deps = depsFromPipeline(pipeline);
  const job = await requestSecondOpinion(deps, { reviewId, cardId, mode });
  return { jobId: job.id };
}

export async function removeSecondOpinionAction(
  pipeline: Pipeline,
  _jobs: JobQueue,
  _reviews: ReviewStore,
  reviewId: string,
  cardId: string,
  mode?: SecondOpinionMode,
  opinionId?: string,
): Promise<{ removed: boolean }> {
  const deps = depsFromPipeline(pipeline);
  await removeSecondOpinion({ reviews: deps.reviews }, reviewId, cardId, mode, opinionId);
  return { removed: true };
}
