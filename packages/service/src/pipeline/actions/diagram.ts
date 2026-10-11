/**
 * `diagram` action (PRD §4.4): insert a D2 diagram block after the
 * paragraphs it relates to, never duplicating one already there.
 *
 * D2 pipeline (docs/diagram-options.md §7, five steps): extract `link:`
 * values → validate cites → compile-check via the binary → either failure
 * triggers exactly one repair turn → render light + dark → cache by hash.
 * When the binary is unavailable, cite validation is kept, the block is
 * marked `unavailable`, and the endpoint renders later on demand.
 */
import type { Block, DiagramBlock, Job } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTarget,
  findCardTargetInDraft,
  insertDiagrams,
  markStaleAnchors,
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
import { resolveD2Bin, meetsD2MinVersion } from "../../diagrams/bins.js";
import { probeD2Version } from "../../diagrams/render.js";
import { finalizeDiagramBlock } from "../../diagrams/pipeline.js";
import { DiagramCache } from "../../diagrams/cache.js";

export async function diagramAction(
  ctx: ActionContext,
  cardId: string,
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
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

  // PRD §12 reuse (#10): a card that already carries a diagram returns the
  // stored block with no agent call ("never duplicating one already there",
  // PRD §4.4). A card whose diagram was removed (undo/delete) is
  // legitimately a new request.
  const blocks = target.kind === "page-card" ? target.card.blocks : (target.annotation.expansion?.blocks ?? []);
  if (blocks.some((b) => b.type === "diagram")) {
    return { cardId, reused: true };
  }

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
      // Finalize D2 blocks (cite validation + compile-check + render).
      // Either failure → exactly one repair turn.
      const finalized = await finalizeFresh(ctx, fresh);
      if (finalized.needsRepair) {
        try {
          fresh = await repairDiagrams(ctx, cardId, level, fresh, finalized.messages);
          // Finalize the repair output too (single pass; failures after
          // repair leave the card unchanged with a job-visible error).
          const second = await finalizeFresh(ctx, fresh);
          if (second.needsRepair) {
            throw new Error(`diagram repair failed: ${second.messages.join("; ").slice(0, 300)}`);
          }
          fresh = second.blocks;
        } catch {
          return null;
        }
      } else {
        fresh = finalized.blocks;
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

/** Run the D2 finalize pipeline over fresh blocks (diagram blocks only). */
async function finalizeFresh(
  ctx: ActionContext,
  fresh: Block[],
): Promise<{ blocks: Block[]; needsRepair: boolean; messages: string[] }> {
  const { pipeline, reviewId } = ctx;
  const lookup = pipeline.lookupForDiagrams(reviewId);
  const d2bin = resolveD2Bin({});
  let d2version: string | null = null;
  if (d2bin) {
    try {
      const v = await probeD2Version(pipeline.commands, d2bin.path);
      if (v && meetsD2MinVersion(v)) d2version = v;
    } catch {
      d2version = null;
    }
  }
  const cache = new DiagramCache({
    dataDir: pipeline.dataDir,
    ...(ctx.fixturesDir ?? pipeline.fixturesDir ? { fixturesDir: (ctx.fixturesDir ?? pipeline.fixturesDir)! } : {}),
  });

  const out: Block[] = [];
  let needsRepair = false;
  const messages: string[] = [];
  for (const b of fresh) {
    if (b.type !== "diagram") {
      out.push(b);
      continue;
    }
    const d = b as DiagramBlock;
    const caption = typeof d.caption === "string" ? d.caption : undefined;
    const finalized = await finalizeDiagramBlock(d.source, caption, {
      runner: pipeline.commands,
      dataDir: pipeline.dataDir,
      ...(ctx.fixturesDir ?? pipeline.fixturesDir ? { fixturesDir: (ctx.fixturesDir ?? pipeline.fixturesDir)! } : {}),
      lookup,
      d2bin: d2version ? d2bin : null,
      d2version,
      cache,
    });
    // Preserve the parser's block id (finalize uses a placeholder).
    out.push({ ...finalized.block, id: d.id });
    if (finalized.needsRepair) {
      needsRepair = true;
      messages.push(...finalized.messages);
    }
  }
  return { blocks: out, needsRepair, messages };
}

/** One repair turn: re-ask with validator/compiler messages + previous source. */
async function repairDiagrams(
  ctx: ActionContext,
  cardId: string,
  level: string,
  fresh: Block[],
  messages: string[],
): Promise<Block[]> {
  const { pipeline, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const problems = messages.join("\n");
  const prevSources = fresh
    .filter((b) => b.type === "diagram")
    .map((b) => `\`\`\`d2\n${(b as DiagramBlock).source}\n\`\`\``)
    .join("\n");
  const variables = {
    card: `${cardPromptText(snapshot, cardId)}\n\nThe previous diagram failed validation:\n${problems}\n${prevSources}\nFix the D2 source (citations and syntax) and reply again.`,
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
  const diagrams = retry.filter((b) => b.type === "diagram");
  if (diagrams.length === 0) {
    throw new Error(`diagram repair failed: no diagram in repair reply`);
  }
  const kept = fresh.filter((b) => b.type !== "diagram");
  return [...kept, ...diagrams];
}
