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
import { resolveEffectiveSettings } from "../../settings/index.js";
import type { ModelCatalog, SettingsStore } from "../../settings/index.js";
import type { Pipeline } from "../runner.js";

export async function generateAction(
  pipeline: Pipeline,
  _jobs: JobQueue,
  reviews: ReviewStore,
  reviewId: string,
  cardId: string,
): Promise<{ jobId?: string; reused?: boolean }> {
  // PRD §12 reuse (#10): a placeholder that already filled returns the
  // stored card with no agent call. `fillGoDeeper` still throws on unknown
  // or non-pending cards, so unknown ids 404 as before.
  const snapshot = reviews.getSnapshot(reviewId);
  if (!snapshot) throw new Error(`unknown review ${reviewId}`);
  const card = snapshot.pages.find((p) => p.id === "root")?.cards.find((c) => c.id === cardId);
  if (card && !card.pending && (card.blocks?.length ?? 0) > 0) {
    return { reused: true };
  }
  // Placeholder validation happens inside fillGoDeeper (throws when missing).
  const job = await enqueueGenerate(pipeline, reviews, reviewId, cardId);
  // The queue's own in-flight dedupe may have returned the active job for
  // an identical request still running: surface it as deduplicated via the
  // job id (dispatcher maps this path; stored reuse above is `reused`).
  return { jobId: job.id };
}

async function enqueueGenerate(
  pipeline: Pipeline,
  reviews: ReviewStore,
  reviewId: string,
  cardId: string,
): Promise<{ id: string }> {
  // fillGoDeeper runs as a user-priority job via the pipeline's internal
  // queue; here we wrap it in a job so the action returns a jobId.
  const jobs = (pipeline as unknown as { opts: { jobs: JobQueue } }).opts.jobs;
  const pipelineOpts = (
    pipeline as unknown as { opts: { settings: SettingsStore; models?: ModelCatalog | null } }
  ).opts;
  const settings = await resolveEffectiveSettings({
    settings: pipelineOpts.settings,
    models: pipelineOpts.models ?? null,
  });
  const snapshot = reviews.getSnapshot(reviewId);
  const baseVersion = snapshot ? `v${snapshot.version.n}` : "v1";
  const enqueued = jobs.enqueue({
    reviewId,
    kind: "go-deeper",
    provider: settings.main.provider,
    model: settings.main.model,
    ...(settings.main.effort ? { effort: settings.main.effort } : {}),
    priority: JOB_PRIORITY.userRequested,
    dedupe: { anchor: `go-deeper:${cardId}`, requestKind: "generate", baseVersion },
    cardId,
    run: async (ctx) => {
      await pipeline.fillGoDeeper(reviewId, cardId, ctx.signal, (d) => ctx.reportText(d), ctx);
    },
  });
  return { id: enqueued.id };
}
