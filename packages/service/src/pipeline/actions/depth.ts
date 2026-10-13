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
import type { Block, DepthLevel, Job } from "@unvibe/shared";
import { JOB_PRIORITY, freshBlockId } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTarget,
  findCardTargetInDraft,
  hasLevelText,
  hasPrinciple,
  markStaleAnchors,
  mergeDepthText,
  pushUndo,
  recordInteraction,
  setTargetContent,
  stepLevel,
  targetBlocks,
  targetLevel,
  withFreshAsideId,
} from "../../interaction/index.js";
import { answerEchoTitle, cardTitle, storedCardTitle } from "./events.js";
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
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean; level?: DepthLevel }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const target = findCardTarget(snapshot, cardId);
  if (!target) throw new Error(`unknown card ${cardId}`);
  const level = targetLevel(target);
  const blocks = targetBlocks(target) as Block[];
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
      pushUndo(t, [...targetBlocks(t)], from);
      const current = targetBlocks(t);
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
): Promise<{ cardId: string; jobId?: string; level?: DepthLevel }> {
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
  // Replay fixtures are keyed by stable card ids (central/problem);
  // conversation cards and answers carry dynamic ids (`ann_…`, `ans_…`),
  // so they share one `expansion:<level>` recording (audit #10 E2E).
  // Added as `depth-expansion-deep.md` in the existing reply format.
  const replayKey = cardId.startsWith("ann_") || cardId.startsWith("ans_") ? `expansion:${target}` : `${cardId}:${target}`;
  const replay = isReplayRunner(pipeline.runner) ? { kind: "depth", key: replayKey } : undefined;
  // Issue #50: a rewrite must not open by repeating the card title — for
  // an answer, its question (else the card's quoted text).
  const echoTitle = storedCardTitle(snapshot, cardId) ?? answerEchoTitle(snapshot, cardId);

  const done = pipeline.runInFork({
    reviewId,
    kind: "depth",
    template: "depth",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    cardId,
    ...(echoTitle ? { echoCandidates: [echoTitle] } : {}),
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
        const current = targetBlocks(t) as Block[];
        const from = targetLevel(t);
        pushUndo(t, [...current], from);
        let merged = mergeDepthText(current, replyBlocks, target);
        // + at the deepest level adds one Underlying-principle block (once,
        // PRD §4.4). Normal depth steps never add it, even when the reply
        // carries one (fixtures include it for the principle path).
        if (addPrinciple && target === "deep" && !hasPrinciple(merged)) {
          const principle = replyBlocks.find((b) => b.type === "aside" && b.kind === "Underlying principle");
          // Fresh ID within this body (#116), like example/diagram inserts.
          if (principle) merged = [...merged, withFreshAsideId(principle, freshBlockId(merged, `b-pr-${Date.now().toString(36)}`))];
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
