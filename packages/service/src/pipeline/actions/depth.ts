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
import { cardTitle } from "./events.js";
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
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean; level?: string }> {
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

  // + at the deepest level with no principle yet: the agent supplies one
  // (principleOnly path below); when the card already has it, there is
  // nothing to do.
  // PRD §12 reuse (#10): stored depth levels and the stored principle block
  // are the cache — no agent call, flagged as reused.
  if (!next) {
    if (direction === "deeper" && !hasPrinciple(blocks)) {
      return depthViaAgent(ctx, cardId, "deep", true);
    }
    return { cardId, level, reused: true };
  }

  // Stored per block per level: switching back is instant, no agent call.
  // The rewritten text entered the log when first generated; the switch
  // itself is stepper state (`depth-state`, never logged).
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
    await recordInteraction({ kind: "depth-state", reviewId, cardId, text: `Depth ${next}: "${cardTitle(getSnapshotOrThrow(reviews, reviewId), cardId)}"` });
    return { cardId, level: next, reused: true };
  }

  const key = {
    anchor: `card:${cardId}`,
    requestKind: "depth",
    depth: next,
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };

  // Normal depth steps fill text levels only; the Underlying-principle block
  // is added solely by + at the deepest level (principleOnly path above),
  // per PRD §4.4 — even when the fixture reply carries one.
  return depthViaAgent(ctx, cardId, next, false);
}

async function depthViaAgent(
  ctx: ActionContext,
  cardId: string,
  target: "simple" | "standard" | "deep",
  addPrinciple = false,
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
  // Replay fixtures are keyed by stable card ids (central/problem); expansion
  // ids are dynamic (`ann_…`), so expansions share one `expansion:<level>`
  // recording (audit #10 E2E). Added as `depth-expansion-deep.md` in the
  // existing reply format.
  const replayKey = cardId.startsWith("ann_") ? `expansion:${target}` : `${cardId}:${target}`;
  const replay = isReplayRunner(pipeline.runner) ? { kind: "depth", key: replayKey } : undefined;

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

  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      capture.settled();
      const replyBlocks = res.cards.flatMap((c) => c.blocks) as Block[];
      await reviews.mutate(reviewId, (draft) => {
        const t = findCardTargetInDraft(draft, cardId);
        if (!t) return;
        const current = (t.kind === "page-card" ? t.card.blocks : t.annotation.expansion!.blocks) as Block[];
        const from = t.kind === "page-card" ? t.card.level : t.annotation.expansion!.level;
        pushUndo(t, [...current], from);
        let merged = mergeDepthText(current, replyBlocks, target);
        // + at the deepest level adds one Underlying-principle block (once,
        // PRD §4.4). Normal depth steps never add it, even when the reply
        // carries one (fixtures include it for the principle path).
        if (addPrinciple && target === "deep" && !hasPrinciple(merged)) {
          const principle = replyBlocks.find((b) => b.type === "aside" && b.kind === "Underlying principle");
          if (principle) merged = [...merged, { ...principle, id: `b-pr-${Date.now().toString(36)}` }];
        }
        setTargetContent(t, merged, target);
        markStaleAnchors(draft, cardId);
      });
      // The rewritten text is card-local shared knowledge (PRD §9.3).
      // Awaited so tests observe the entry once the rewrite settles.
      try {
        const live = getSnapshotOrThrow(reviews, reviewId);
        await recordInteraction({
          kind: "depth-rewrite",
          reviewId,
          cardId,
          text: `Depth ${target}: "${cardTitle(live, cardId)}"`,
        });
      } catch {
        // Logging never fails the action.
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      // No card-level error field: with a job, its error state (Jobs view)
      // is the visible failure; without one (fail-fast agent) the message
      // goes into the HTTP response. Either way the card is unchanged and
      // retryable via the same action.
      return err instanceof Error ? err.message : String(err);
    },
  );

  const job = await capture.wait();
  if (job) {
    handled.catch(() => {});
    return { cardId, jobId: job.id, level: target };
  }
  const fillError = await handled;
  if (fillError) throw new Error(fillError);
  return { cardId, level: target };
}
