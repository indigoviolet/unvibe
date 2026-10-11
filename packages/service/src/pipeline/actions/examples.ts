/**
 * `examples` action (PRD §4.4): insert example blocks after the
 * paragraphs they relate to, never duplicating one already there.
 */
import type { Block, Job } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTargetInDraft,
  insertExamples,
  markStaleAnchors,
  pushUndo,
  recordInteraction,
  setTargetContent,
  targetBlocks,
  targetLevel,
  findCardTarget,
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

export async function examplesAction(
  ctx: ActionContext,
  cardId: string,
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const target = findCardTarget(snapshot, cardId);
  if (!target) throw new Error(`unknown card ${cardId}`);
  const key = {
    anchor: `card:${cardId}`,
    requestKind: "examples",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };

  // PRD §12 reuse (#10): when every paragraph already has an example after
  // it, a repeat returns the stored blocks with no agent call. A card with
  // new paragraphs (open slots) or with examples deleted (undo) is
  // legitimately a new request.
  if (examplesSaturated(targetBlocks(target))) {
    return { cardId, reused: true };
  }

  const level = targetLevel(target);
  const variables = { card: cardPromptText(snapshot, cardId), level };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "examples", key: cardId } : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "examples",
    template: "examples",
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
      const fresh = res.cards.flatMap((c) => c.blocks) as Block[];
      // Examples may also arrive nested in the reply's own structure;
      // collect every Example aside recursively.
      const collected = collectExamples(fresh);
      let added = 0;
      await reviews.mutate(reviewId, (draft) => {
        const t = findCardTargetInDraft(draft, cardId);
        if (!t) return;
        const current = (t.kind === "page-card" ? t.card.blocks : t.annotation.expansion!.blocks) as Block[];
        const out = insertExamples(current, collected);
        if (out.added === 0) return;
        const from = t.kind === "page-card" ? t.card.level : t.annotation.expansion!.level;
        pushUndo(t, [...current], from);
        setTargetContent(t, out.blocks, from);
        markStaleAnchors(draft, cardId);
        added = out.added;
      });
      if (added > 0) {
        try {
          const live = getSnapshotOrThrow(reviews, reviewId);
          await recordInteraction({
            kind: "example-added",
            reviewId,
            cardId,
            text: `Added ${added} example${added === 1 ? "" : "s"} to "${cardTitle(live, cardId)}"`,
          });
        } catch {
          // Logging never fails the action.
        }
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      // With a job, its error state is the visible failure; without one
      // (fail-fast agent) the message goes into the HTTP response.
      return err instanceof Error ? err.message : String(err);
    },
  );

  const job = await capture.wait();
  if (job) {
    handled.catch(() => {});
    return { cardId, jobId: job.id };
  }
  const fillError = await handled;
  if (fillError) throw new Error(fillError);
  return { cardId };
}

function collectExamples(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === "aside" && b.kind === "Example") out.push(b);
    else if (b.type === "aside") out.push(...collectExamples(b.inner));
  }
  return out;
}

/**
 * True when the card already carries examples on every paragraph that can
 * take one (the same open-slot rule `insertExamples` uses). A repeat then
 * reuses the stored blocks with no agent call (PRD §12, #10).
 */
function examplesSaturated(blocks: Block[]): boolean {
  let paragraphs = 0;
  let covered = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].type !== "paragraph") continue;
    paragraphs++;
    const next = blocks[i + 1];
    if (next?.type === "aside" && (next as { kind?: string }).kind === "Example") covered++;
  }
  return paragraphs > 0 && covered >= paragraphs;
}
