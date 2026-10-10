/**
 * `depth` action (PRD §4.4): − / + across simpler, standard, first
 * principles.
 *
 * - Rewrites the card's paragraphs in place; depth versions are generated
 *   on demand and kept once made (stored per block per level via
 *   `Block.text`; switching back is instant and costs no agent call).
 * - + at the deepest level adds one "Underlying principle" block (once).
 * - Works on page cards and expansion cards alike.
 * - Undo is a separate `undo` action (the stack is pushed here).
 */
import type { Block, Job } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTargetInDraft,
  hasLevelText,
  hasPrinciple,
  markStaleAnchors,
  mergeDepthText,
  pushUndo,
  recordInteraction,
  setTargetContent,
  stepLevel,
} from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import {
  baseVersionOf,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  type ActionContext,
} from "./common.js";

export async function depthAction(
  ctx: ActionContext,
  cardId: string,
  direction: "simpler" | "deeper",
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; level?: string }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const target = (() => {
    for (const page of snapshot.pages ?? []) {
      const card = (page.cards ?? []).find((c) => c.id === cardId);
      if (card) return { kind: "page-card" as const, card };
    }
    const annotation = (snapshot.annotations ?? []).find((a) => a.id === cardId);
    if (annotation?.type === "expansion" && annotation.expansion) return { kind: "expansion" as const, annotation };
    return null;
  })();
  if (!target) throw new Error(`unknown card ${cardId}`);
  const level = target.kind === "page-card" ? target.card.level : (target.annotation.expansion?.level ?? "standard");
  const blocks = (target.kind === "page-card" ? target.card.blocks : target.annotation.expansion?.blocks) as Block[];
  const next = stepLevel(level, direction);

  // + at the deepest level with no principle yet: the agent may supply
  // one (see below); when the card already has it, there is nothing to do.
  if (!next) {
    if (direction === "deeper" && !hasPrinciple(blocks)) {
      return depthViaAgent(ctx, cardId, "deep");
    }
    return { cardId, level };
  }

  // Stored per block per level: switching back is instant, no agent call.
  if (hasLevelText(blocks, next)) {
    const from = level;
    await reviews.mutate(reviewId, (draft) => {
      const t = findCardTargetInDraft(draft, cardId);
      if (!t) throw new Error(`unknown card ${cardId}`);
      pushUndo(t, t.kind === "page-card" ? [...t.card.blocks] : [...t.annotation.expansion!.blocks], from);
      const current = t.kind === "page-card" ? t.card.blocks : t.annotation.expansion!.blocks;
      setTargetContent(t, current, next);
      markStaleAnchors(draft, cardId);
    });
    recordInteraction({ type: "depth.requested", reviewId, cardId, direction });
    recordInteraction({ type: "depth.completed", reviewId, cardId, level: next, fromAgent: false });
    return { cardId, level: next };
  }

  const key = {
    anchor: `card:${cardId}`,
    requestKind: "depth",
    depth: next,
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };

  return depthViaAgent(ctx, cardId, next, direction);
}

async function depthViaAgent(
  ctx: ActionContext,
  cardId: string,
  target: "simple" | "standard" | "deep",
  direction?: "simpler" | "deeper",
): Promise<{ cardId: string; jobId?: string; level?: string }> {
  const { pipeline, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const key = {
    anchor: `card:${cardId}`,
    requestKind: "depth",
    depth: target,
    baseVersion: baseVersionOf(snapshot),
  };
  const variables = {
    card: cardPromptText(snapshot, cardId),
    level: target,
  };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "depth", key: `${cardId}:${target}` } : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "depth",
    template: "depth",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    cardId,
    replay,
    onJob: (job: Job) => capture.onJob(job),
  });

  if (direction) recordInteraction({ type: "depth.requested", reviewId, cardId, direction });
  void done.then(
    async (res) => {
      const replyBlocks = res.cards.flatMap((c) => c.blocks) as Block[];
      await reviews.mutate(reviewId, (draft) => {
        const t = findCardTargetInDraft(draft, cardId);
        if (!t) return;
        const current = (t.kind === "page-card" ? t.card.blocks : t.annotation.expansion!.blocks) as Block[];
        const from = t.kind === "page-card" ? t.card.level : t.annotation.expansion!.level;
        pushUndo(t, [...current], from);
        let merged = mergeDepthText(current, replyBlocks, target);
        // + at the deepest level may add one Underlying-principle block (once).
        if (target === "deep" && !hasPrinciple(merged)) {
          const principle = replyBlocks.find((b) => b.type === "aside" && b.kind === "Underlying principle");
          if (principle) merged = [...merged, { ...principle, id: `b-pr-${Date.now().toString(36)}` }];
        }
        setTargetContent(t, merged, target);
        markStaleAnchors(draft, cardId);
      });
      recordInteraction({ type: "depth.completed", reviewId, cardId, level: target, fromAgent: true });
    },
    async () => {
      // No card-level error field: the job's error state (Jobs view) is
      // the visible failure; the card is unchanged and retryable via the
      // same action (dedupe cleared once the job settles).
    },
  );

  const job = await capture.wait();
  return job ? { cardId, jobId: job.id, level: target } : { cardId, level: target };
}
