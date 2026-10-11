/**
 * `diagram` action (PRD §4.4): insert a diagram block after the
 * paragraphs it relates to, never duplicating one already there.
 *
 * Diagrams are Mermaid; the source is validated to parse and the agent
 * is asked for one repair when it does not.
 */
import type { Block, Job } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTarget,
  findCardTargetInDraft,
  insertDiagrams,
  isValidMermaid,
  markStaleAnchors,
  mermaidProblem,
  pushUndo,
  recordInteraction,
  setTargetContent,
  targetLevel,
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

export async function diagramAction(
  ctx: ActionContext,
  cardId: string,
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const target = findCardTarget(snapshot, cardId);
  if (!target) throw new Error(`unknown card ${cardId}`);
  const key = {
    anchor: `card:${cardId}`,
    requestKind: "diagram",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };

  const level = targetLevel(target);
  const variables = { card: cardPromptText(snapshot, cardId), level };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "diagram" } : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "diagram",
    template: "diagram",
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
      let fresh = res.cards.flatMap((c) => c.blocks) as Block[];
      const bad = fresh.filter((b) => b.type === "diagram" && !isValidMermaid(b.source));
      if (bad.length > 0) {
        // One repair turn for the unparseable diagram; a failed repair
        // leaves the card unchanged (job error is the visible failure).
        try {
          fresh = await repairDiagrams(ctx, cardId, level, fresh, bad as Block[]);
        } catch {
          return null;
        }
      }
      let added = 0;
      await reviews.mutate(reviewId, (draft) => {
        const t = findCardTargetInDraft(draft, cardId);
        if (!t) return;
        const current = (t.kind === "page-card" ? t.card.blocks : t.annotation.expansion!.blocks) as Block[];
        const out = insertDiagrams(current, fresh);
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
            kind: "diagram-added",
            reviewId,
            cardId,
            text: `Added diagram to "${cardTitle(live, cardId)}"`,
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

/** One repair turn: re-ask with the parse problem + previous source inline. */
async function repairDiagrams(
  ctx: ActionContext,
  cardId: string,
  level: string,
  fresh: Block[],
  bad: Block[],
): Promise<Block[]> {
  const { pipeline, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const problems = bad
    .filter((b) => b.type === "diagram")
    .map((b) => `- ${mermaidProblem((b as { source: string }).source)}:\n\`\`\`mermaid\n${(b as { source: string }).source}\n\`\`\``)
    .join("\n");
  const variables = {
    card: `${cardPromptText(snapshot, cardId)}\n\nThe previous diagram failed to parse:\n${problems}\nFix the Mermaid source and reply again.`,
    level,
  };
  const live = getSnapshotOrThrow(reviews, reviewId);
  const res = await pipeline.runInFork({
    reviewId,
    kind: "diagram",
    template: "diagram",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: {
      anchor: `card:${cardId}`,
      requestKind: "diagram-repair",
      baseVersion: baseVersionOf(live),
    },
    cardId,
    ...(isReplayRunner(pipeline.runner) ? { replay: { kind: "diagram" } } : {}),
  });
  const retry = res.cards.flatMap((c) => c.blocks) as Block[];
  const stillBad = retry.filter((b) => b.type === "diagram" && !isValidMermaid(b.source));
  if (stillBad.length > 0) {
    throw new Error(`diagram repair failed: ${mermaidProblem((stillBad[0] as { source: string }).source)}`);
  }
  // Merge: repaired diagrams replace the broken ones; keep the rest.
  const repairedSources = new Set(
    retry.filter((b) => b.type === "diagram").map((b) => (b as { source: string }).source),
  );
  const kept = fresh.filter((b) => b.type !== "diagram" || isValidMermaid((b as { source: string }).source));
  void repairedSources;
  return [...kept, ...retry.filter((b) => b.type === "diagram" || (b.type === "aside" && b.kind === "Diagram"))];
}
