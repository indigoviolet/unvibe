/**
 * `diagram` action (PRD §4.4): insert a D2 diagram block after the
 * paragraphs it relates to, never duplicating one already there.
 *
 * D2 pipeline (docs/d2-diagrams.md): extract `link:`
 * values → validate cites → compile-check via the binary → either failure
 * triggers exactly one repair turn → render light + dark → cache by hash.
 * When the binary is unavailable, cite validation is kept, the block is
 * marked `unavailable`, and the endpoint renders later on demand.
 */
import type { Block, Job, Persona } from "@unvibe/shared";
import { isCardVariant, JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTarget,
  findCardTargetInDraft,
  insertDiagrams,
  markStaleAnchors,
  mirrorPromotedAnswer,
  pushUndo,
  recordInteraction,
  setTargetContent,
  targetBlocks,
  targetLevel,
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
import { finalizeFresh, repairDiagrams } from "./diagram-finalize.js";
import { personaFor, personaVariantPromptText, variantFor } from "./persona.js";

export async function diagramAction(
  ctx: ActionContext,
  cardId: string,
  opts?: { personaId?: string },
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const persona = opts?.personaId ? personaFor(ctx, opts.personaId) : undefined;
  if (opts?.personaId && persona) {
    return diagramOnVariant(ctx, cardId, opts.personaId, persona);
  }
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
  const blocks = targetBlocks(target);
  if (blocks.some((b) => b.type === "diagram")) {
    return { cardId, reused: true };
  }

  const level = targetLevel(target);
  const variables = { card: cardPromptText(snapshot, cardId), level };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "diagram" } : undefined;
  // Issue #50: the walkthrough must not open by repeating the card title
  // (an answer's question, else the card's quoted text).
  const echoTitle = storedCardTitle(snapshot, cardId) ?? answerEchoTitle(snapshot, cardId);

  const done = pipeline.runInFork({
    reviewId,
    kind: "diagram",
    template: "diagram",
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
      let fresh = res.cards.flatMap((c) => c.blocks) as Block[];
      // Finalize D2 blocks (cite validation + compile-check + render).
      // Either failure → exactly one repair turn.
      const finalized = await finalizeFresh(ctx, fresh);
      if (finalized.needsRepair) {
        try {
          fresh = await repairDiagrams(
            ctx,
            {
              card: cardPromptText(snapshot, cardId),
              level,
              dedupeAnchor: `card:${cardId}`,
              requestKind: "diagram-repair",
              cardId,
            },
            fresh,
            finalized.messages,
          );
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
        const current = targetBlocks(t) as Block[];
        const out = insertDiagrams(current, fresh);
        if (out.added === 0) return;
        const from = targetLevel(t);
        pushUndo(t, [...current], from);
        setTargetContent(t, out.blocks, from);
        markStaleAnchors(draft, cardId);
        mirrorPromotedAnswer(draft, cardId);
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

/**
 * Issue #349 step 2: Add diagram on a persona's version — the variant's
 * own blocks, handled by that persona in its own session for the card.
 */
async function diagramOnVariant(
  ctx: ActionContext,
  cardId: string,
  personaId: string,
  persona: Persona,
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { pipeline, jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const variant = variantFor(snapshot, cardId, personaId);
  if (!variant) throw new Error(`persona ${personaId} has not run on card ${cardId} yet`);
  const key = {
    anchor: `persona:${cardId}:${personaId}`,
    requestKind: "diagram",
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };
  const blocks = variant.blocks as Block[];
  if (blocks.some((b) => b.type === "diagram")) {
    return { cardId, reused: true };
  }

  const variables = { card: personaVariantPromptText(snapshot, cardId, personaId), level: variant.level };
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "diagram" } : undefined;
  const echoTitle = storedCardTitle(snapshot, cardId) ?? answerEchoTitle(snapshot, cardId);

  const done = pipeline.runInFork({
    reviewId,
    kind: "diagram",
    template: "diagram",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    cardId,
    persona,
    conversationKey: `persona:${cardId}:${personaId}`,
    ...(variant.sessionId ? { continueSessionId: variant.sessionId } : {}),
    ...(echoTitle ? { echoCandidates: [echoTitle] } : {}),
    replay,
    onJob: (job: Job) => capture.onJob(job),
  });

  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      capture.settled();
      const jobId = (await capture.wait())?.id;
      const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
      let fresh = res.cards.flatMap((c) => c.blocks) as Block[];
      const finalized = await finalizeFresh(ctx, fresh);
      if (finalized.needsRepair) {
        try {
          fresh = await repairDiagrams(
            ctx,
            {
              card: personaVariantPromptText(getSnapshotOrThrow(reviews, reviewId), cardId, personaId),
              level: variant.level,
              dedupeAnchor: `persona:${cardId}:${personaId}`,
              requestKind: "diagram-repair",
              cardId,
              conversationKey: `persona:${cardId}:${personaId}`,
              persona,
            },
            fresh,
            finalized.messages,
          );
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
        const targetCard = (draft.pages ?? [])
          .flatMap((p) => p.cards ?? [])
          .find((c) => c.id === cardId);
        const v = targetCard?.variants?.[personaId];
        if (!targetCard || !v || !isCardVariant(v)) return;
        const out = insertDiagrams(v.blocks as Block[], fresh);
        if (out.added === 0) return;
        v.undoStack.push({ blocks: [...v.blocks], level: v.level });
        v.blocks = out.blocks;
        v.revision += 1;
        if (sessionId) v.sessionId = sessionId;
        markStaleAnchors(draft, cardId);
        mirrorPromotedAnswer(draft, cardId);
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
