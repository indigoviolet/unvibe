/**
 * `explain` action (PRD §4.7).
 *
 * Creates an expansion annotation anchored on the selected text (guide
 * block, description paragraph or diff line; quote + prefix/suffix),
 * immediately visible in a working state, then fills it by a job through
 * `runInFork` with the `explain` template and L4 context. Content streams
 * into the expansion as blocks; the expansion is a card in its own right
 * (depth level, read, collapsed, revision, undo stack).
 *
 * `runExplainFill` fills an existing expansion (used by `retry` on the
 * same annotation id); `explainAction` creates the annotation first.
 */
import type { ActionAnchor, Anchor, Annotation, Block, Job, ReviewSnapshot } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { buildAnchor, newAnnotationId } from "../../comments/threads.js";
import { l4Variables, recordInteraction } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import {
  anchorKey,
  baseVersionOf,
  cancelAnnotationJob,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  normalizeBlockAnchor,
  suppressFillError,
  type ActionContext,
} from "./common.js";
import { aliasCanonicalizer, remapAliasTargets } from "./validate-apply.js";

export interface ExplainRequest {
  quote: string;
  anchor: ActionAnchor;
}

export async function explainAction(
  ctx: ActionContext,
  req: ExplainRequest,
): Promise<{ annotationId: string; jobId?: string; deduplicated?: boolean }> {
  const { reviews, reviewId } = ctx;
  if (!req.quote || req.quote.trim() === "") throw new Error("quote is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  // Validate the host exists (buildAnchor throws on unknown hosts).
  const anchor = buildAnchor(before, normalized, req.quote);
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}`,
    requestKind: "explain",
    baseVersion: baseVersionOf(before),
  };

  // Dedupe: identical active request, or an already-open identical expansion.
  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find(
      (a) => a.type === "expansion" && a.anchor.quotedText === req.quote && a.jobId === active.id,
    );
    recordInteraction({ type: "explain.requested", reviewId, annotationId: existing?.id ?? "", quote: req.quote });
    return {
      annotationId: existing?.id ?? "",
      jobId: active.id,
      deduplicated: true,
    };
  }
  const openDup = before.annotations.find(
    (a) =>
      a.type === "expansion" &&
      a.anchor.quotedText === req.quote &&
      anchorSameHost(a.anchor, anchor) &&
      a.open &&
      !a.error &&
      (a.expansion?.blocks.length ?? 0) > 0,
  );
  if (openDup) {
    return { annotationId: openDup.id, deduplicated: true };
  }

  // Immediately visible working state.
  const annotationId = newAnnotationId();
  await reviews.mutate(reviewId, (draft) => {
    draft.annotations.push({
      id: annotationId,
      type: "expansion",
      anchor,
      open: true,
      messages: [],
      post: false,
      note: false,
      working: "Thinking…",
      expansion: {
        blocks: [],
        level: "standard",
        read: false,
        collapsed: false,
        revision: 1,
        undoStack: [],
        working: "Thinking…",
      },
    } as unknown as Annotation);
  });
  recordInteraction({ type: "explain.requested", reviewId, annotationId, quote: req.quote });

  const res = await runExplainFill(ctx, annotationId, anchor, req.quote, { dedupeKey: key });
  return { annotationId, ...res };
}

/**
 * Fill an existing expansion annotation via `runInFork`. The annotation
 * keeps its id (retry fills in place). Returns the job id when the job
 * started in time.
 */
export async function runExplainFill(
  ctx: ActionContext,
  annotationId: string,
  anchor: Anchor,
  quote: string,
  opts: { dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string }; skipDedupe?: boolean } = {},
): Promise<{ jobId?: string; deduplicated?: boolean }> {
  const { pipeline, reviews, reviewId } = ctx;
  const live = getSnapshotOrThrow(reviews, reviewId);
  const key = opts.dedupeKey ?? {
    anchor: `ann:${annotationId}:${quote.slice(0, 80)}`,
    requestKind: "explain",
    baseVersion: baseVersionOf(live),
  };
  if (!opts.skipDedupe) {
    const active = findActiveJob(ctx.jobs, reviewId, key);
    if (active) return { jobId: active.id, deduplicated: true };
  }

  // Reset to the working state (retry clears a visible error here).
  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!found || found.type !== "expansion" || !found.expansion) return;
    found.working = "Thinking…";
    found.expansion.working = "Thinking…";
    found.error = null;
    found.expansion.error = null;
    found.open = true;
  });

  const latest = getSnapshotOrThrow(reviews, reviewId);
  const variables = l4Variables(latest, anchor, {
    message: `Explain: ${quote}`,
  });
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "explain" } : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "explain",
    template: "explain",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    threadId: annotationId,
    replay,
    onJob: (job: Job) => {
      capture.onJob(job);
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          if (found) {
            found.jobId = job.id;
            if (found.type === "expansion" && found.expansion) found.expansion.jobId = job.id;
          }
        })
        .catch(() => {});
    },
    onPartial: (cards) => {
      // Stream finished cards into the expansion as blocks.
      const blocks = cards.flatMap((c) => c.blocks);
      if (blocks.length === 0) return;
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          if (found?.type === "expansion" && found.expansion && !found.error) {
            found.expansion.blocks = blocks as Block[];
          }
        })
        .catch(() => {});
    },
  });

  void done.then(
    async (res) => {
      const blocks = res.cards.flatMap((c) => c.blocks) as Block[];
      // Stored targets are canonical (real file keys); repaired tokens
      // resolve to their fix, unverified stay flagged (PRD §4.5).
      const canon = aliasCanonicalizer(getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
      const fixed = remapAliasTargets(blocks, res.validation.tokens, canon);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        if (!found.open && found.expansion.blocks.length > 0) {
          // Closed while filling: keep the content for the dotted-link preview.
          found.expansion.blocks = fixed;
          found.expansion.revision += 1;
          found.working = null;
          found.expansion.working = null;
          return;
        }
        found.expansion.blocks = fixed;
        found.expansion.revision += 1;
        found.working = null;
        found.expansion.working = null;
        found.error = null;
        found.expansion.error = null;
        found.jobId = undefined;
        found.expansion.jobId = undefined;
      });
      recordInteraction({
        type: "explain.completed",
        reviewId,
        annotationId,
        unverified: res.validation.unverified,
      });
    },
    async (err: Error) => {
      if (await suppressFillError(ctx, annotationId)) return;
      const message = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        found.working = null;
        found.expansion.working = null;
        found.error = message;
        found.expansion.error = message;
      });
      recordInteraction({ type: "explain.failed", reviewId, annotationId, error: message });
    },
  );

  const job = await capture.wait();
  return job ? { jobId: job.id } : {};
}

/** Cancel the explain job (used by close/delete). */
export function cancelExplainJob(ctx: ActionContext, snapshot: ReviewSnapshot, annotationId: string): void {
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  cancelAnnotationJob(ctx.jobs, ctx.reviewId, found?.jobId ?? (found?.type === "expansion" ? found.expansion?.jobId : undefined));
}

export function anchorSameHost(a: Annotation["anchor"], b: Annotation["anchor"]): boolean {
  if (a.host.kind !== b.host.kind) return false;
  if (a.host.kind === "block" && b.host.kind === "block") return a.host.blockId === b.host.blockId;
  if (a.host.kind === "description" && b.host.kind === "description") return a.host.paragraphId === b.host.paragraphId;
  if (a.host.kind === "diff-line" && b.host.kind === "diff-line") {
    return a.host.fileKey === b.host.fileKey && a.host.line === b.host.line;
  }
  return false;
}
