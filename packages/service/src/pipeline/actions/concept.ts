/**
 * `concept` action (M4): write a concept page on first open.
 *
 * Thin wrapper over `pipeline.ensureConceptPage` with an immediate
 * working state: a stub page (one card, no blocks, `working` progress)
 * is created synchronously so the web can show progress, then the
 * pipeline fills it. Reopening an already-full page is instant (no job).
 */
import type { Job } from "@unvibe/shared";
import { recordInteraction } from "../../interaction/index.js";
import { findActiveJob, getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function conceptAction(
  ctx: ActionContext,
  slug: string,
): Promise<{ pageId: string; jobId?: string; deduplicated?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  if (!slug || !/^[\w-]+$/.test(slug)) throw new Error(`bad concept slug ${JSON.stringify(slug)}`);
  const pageId = `c-${slug}`;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const existing = snapshot.pages.find((p) => p.id === pageId);

  // Already full: instant, no job.
  if (existing && existing.cards.length > 0 && existing.cards[0].blocks.length > 1) {
    return { pageId };
  }
  // Identical active request: reuse it.
  const key = {
    anchor: `concept:${slug}`,
    requestKind: "concept-page",
    baseVersion: `v${snapshot.version.n}`,
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { pageId, jobId: active.id, deduplicated: true };

  // Immediate working state for the page.
  if (!existing) {
    await reviews.mutate(reviewId, (draft) => {
      if (draft.pages.some((p) => p.id === pageId)) return;
      draft.pages.push({
        id: pageId,
        kind: "concept",
        title: slug,
        saved: true,
        parent: "root",
        cards: [
          {
            id: `cc-${slug}`,
            pageId,
            title: null,
            level: "standard",
            read: false,
            collapsed: false,
            revision: 1,
            blocks: [],
            undoStack: [],
          },
        ],
      });
    });
  }
  recordInteraction({ type: "concept.requested", reviewId, slug });

  const job: Job = await pipeline.ensureConceptPage(reviewId, slug);
  // `ensureConceptPage` returns a completed no-op job when the page
  // filled concurrently; a real fill job carries the dedupe key above.
  const live = getSnapshotOrThrow(reviews, reviewId);
  const filled = live.pages.find((p) => p.id === pageId);
  if (filled && filled.cards.length > 0 && filled.cards[0].blocks.length > 1) {
    recordInteraction({ type: "concept.completed", reviewId, slug, pageId });
    return { pageId };
  }
  recordInteraction({ type: "concept.completed", reviewId, slug, pageId });
  return { pageId, jobId: job.id };
}
