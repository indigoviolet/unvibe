/**
 * `generate` action (Go deeper → Generate, PRD §4.3).
 *
 * First real consumer of the `runInFork` seam: the placeholder card shows
 * progress steps (via `text` events on its job), then fills in with the
 * streamed result; follow-up suggestions attach as a `follow-up` block
 * (parsed from `### Follow-ups`).
 */
import { JOB_PRIORITY } from "@unvibe/shared";
import type { JobQueue } from "../../jobs/index.js";
import type { ReviewStore } from "../../state/store.js";
import type { Pipeline } from "../runner.js";

export async function generateAction(
  pipeline: Pipeline,
  _jobs: JobQueue,
  _reviews: ReviewStore,
  reviewId: string,
  cardId: string,
): Promise<{ jobId: string }> {
  // Placeholder validation happens inside fillGoDeeper (throws when missing).
  const job = await enqueueGenerate(pipeline, reviewId, cardId);
  return { jobId: job.id };
}

async function enqueueGenerate(pipeline: Pipeline, reviewId: string, cardId: string): Promise<{ id: string }> {
  // fillGoDeeper runs as a user-priority job via the pipeline's internal
  // queue; here we wrap it in a job so the action returns a jobId.
  const jobs = (pipeline as unknown as { opts: { jobs: JobQueue } }).opts.jobs;
  const settings = (pipeline as unknown as { opts: { settings: { get: () => { main: { provider: string; model: string } } } } }).opts.settings.get();
  const enqueued = jobs.enqueue({
    reviewId,
    kind: "go-deeper",
    provider: settings.main.provider,
    model: settings.main.model,
    priority: JOB_PRIORITY.userRequested,
    dedupe: { anchor: `go-deeper:${cardId}`, requestKind: "generate", baseVersion: "v1" },
    cardId,
    run: async (ctx) => {
      await pipeline.fillGoDeeper(reviewId, cardId, ctx.signal, (d) => ctx.reportText(d), ctx);
    },
  });
  return { id: enqueued.id };
}
