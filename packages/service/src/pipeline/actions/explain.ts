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
import { JOB_PRIORITY, dedupeBlockIds } from "@unvibe/shared";
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
import { newCardForExpansion } from "./events.js";
import { finalizeFresh, repairDiagrams } from "./diagram-finalize.js";
import { DegradedTurnError } from "../../jobs/errors.js";

export interface ExplainRequest {
  quote: string;
  anchor: ActionAnchor;
}

export async function explainAction(
  ctx: ActionContext,
  req: ExplainRequest,
): Promise<{ annotationId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { reviews, reviewId } = ctx;
  // Empty quotes are legal (see ask.ts): the anchor still scopes the turn.
  if (typeof req.quote !== "string") throw new Error("quote is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  // Validate the host exists (buildAnchor throws on unknown hosts).
  const anchor = buildAnchor(before, normalized, req.quote);
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}`,
    requestKind: "explain",
    baseVersion: baseVersionOf(before),
  };

  // Dedupe: identical active request, or an already-stored identical expansion.
  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find(
      (a) => a.type === "expansion" && a.anchor.quotedText === req.quote && a.jobId === active.id,
    );
    return {
      annotationId: existing?.id ?? "",
      jobId: active.id,
      deduplicated: true,
    };
  }
  // PRD §12 reuse (#10): the same anchor+quote on the same base version
  // reopens the stored expansion instead of generating a second one. Closed
  // expansions reopen (dotted-link → expand in place); deleted expansions
  // are gone so a repeat is legitimately a new request. A new base version
  // (new commits) invalidates: anchor.version must match current version.
  const storedDup = before.annotations.find(
    (a) =>
      a.type === "expansion" &&
      a.anchor.quotedText === req.quote &&
      anchorSameHost(a.anchor, anchor) &&
      a.anchor.version === before.version.n &&
      !a.error &&
      !a.expansion?.error &&
      (a.expansion?.blocks.length ?? 0) > 0,
  );
  if (storedDup) {
    if (!storedDup.open) {
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((x) => x.id === storedDup.id);
        if (found) found.open = true;
      });
    }
    return { annotationId: storedDup.id, reused: true };
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
    // Persistent conversation: the next turn's change list resumes from
    // this turn's cursor (sharedctx wire advances it only on success).
    conversationKey: annotationId,
    // Issue #50: the app shows the selection in the card header; a body
    // line that merely repeats it is dropped when the reply is parsed.
    echoCandidates: [quote],
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
      // Stream finished cards into the expansion as blocks. A multi-card
      // reply repeats block IDs across cards (#116): dedupe so one anchor
      // matches one block.
      const blocks = dedupeBlockIds(cards.flatMap((c) => c.blocks));
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

  // Fail-fast (no job ever enqueued, e.g. UNVIBE_AGENT=none): surface
  // the fill error in the HTTP response itself so the UI can show the
  // clear "no agent configured" state. Normal job errors stay on the job.
  // Handlers return the fill error (or null); the no-job branch awaits
  // the handler so the response carries a settled outcome.
  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      // The job (if any) already reported via onJob; unblock the HTTP
      // response even when no job was ever enqueued (fail-fast agent).
      capture.settled();
      const blocks = res.cards.flatMap((c) => c.blocks) as Block[];
      // Stored targets are canonical (real file keys); repaired tokens
      // resolve to their fix, unverified stay flagged (PRD §4.5). Dedupe
      // repeated block IDs from multi-card replies (#116).
      const canon = aliasCanonicalizer(getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
      const fixed = dedupeBlockIds(remapAliasTargets(blocks, res.validation.tokens, canon));
      // Inline diagrams go through the same finalize + one repair turn as
      // Add-diagram blocks (#130), so stored blocks carry a real status.
      // A failed repair keeps the error-status blocks; the card prose is
      // unaffected.
      let stored: Block[];
      {
        const first = await finalizeFresh(ctx, fixed);
        if (first.needsRepair) {
          try {
            const level =
              getSnapshotOrThrow(reviews, reviewId).annotations.find((a) => a.id === annotationId)?.expansion
                ?.level ?? "standard";
            const repaired = await repairDiagrams(
              ctx,
              {
                card: `Explain: ${quote}`,
                level,
                dedupeAnchor: `ann:${annotationId}`,
                requestKind: "explain-diagram-repair",
                threadId: annotationId,
                conversationKey: annotationId,
                echoCandidates: [quote],
              },
              first.blocks,
              first.messages,
            );
            stored = (await finalizeFresh(ctx, repaired)).blocks;
          } catch {
            stored = first.blocks;
          }
        } else {
          stored = first.blocks;
        }
      }
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        if (!found.open && found.expansion.blocks.length > 0) {
          // Closed while filling: keep the content for the dotted-link preview.
          found.expansion.blocks = stored;
          found.expansion.revision += 1;
          found.working = null;
          found.expansion.working = null;
          return;
        }
        found.expansion.blocks = stored;
        found.expansion.revision += 1;
        found.working = null;
        found.expansion.working = null;
        found.error = null;
        found.expansion.error = null;
        found.jobId = undefined;
        found.expansion.jobId = undefined;
      });
      // New expansion content enters the log in full (PRD §9.3 `new-card`).
      // Awaited so tests observe the entry once the fill settles.
      try {
        const jobId = (await capture.wait())?.id;
        const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        const live = getSnapshotOrThrow(reviews, reviewId);
        const filled = live.annotations.find((a) => a.id === annotationId);
        const event = filled ? newCardForExpansion(reviewId, live, filled, sessionId) : null;
        if (event) await recordInteraction(event);
      } catch {
        // Logging never fails the action.
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      if (await suppressFillError(ctx, annotationId)) return null;
      const message = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        if (!found || found.type !== "expansion" || !found.expansion) return;
        found.working = null;
        found.expansion.working = null;
        found.error = message;
        found.expansion.error = message;
        // A degraded turn must leave no card behind: streamed partials
        // may already hold the chatter (#51).
        if (err instanceof DegradedTurnError) found.expansion.blocks = [];
      });
      // Failures produce no shared knowledge: visible error only, no log.
      return message;
    },
  );

  const job = await capture.wait();
  if (job) {
    // A late handler throw must never become an unhandled rejection.
    handled.catch(() => {});
    return { jobId: job.id };
  }
  // No job: the fill settled inline (fail-fast agent). Its error, if any,
  // is already on the annotation's visible error state, so the response
  // stays 200 with no job to stream on.
  await handled;
  return {};
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
