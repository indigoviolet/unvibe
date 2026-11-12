/**
 * `slower` action (PRD §4.4, issue #387): one "Help me understand" press
 * rewrites the card's paragraphs in place, more slowly than the current
 * text. Repeatable and relative — every press is a fresh agent turn
 * against the current text; there are no levels and no stored variants
 * to switch back to. Undo steps back through the presses.
 *
 * Works on page cards and expansion cards (answers) alike, and on a
 * persona's variant (rewritten as that persona, in its session).
 */
import type { Block, Job } from "@unvibe/shared";
import { isCardVariant, JOB_PRIORITY } from "@unvibe/shared";
import {
  cardPromptText,
  findCardTarget,
  findCardTargetInDraft,
  markStaleAnchors,
  mergeSlowerText,
  mirrorPromotedAnswer,
  pushUndo,
  recordInteraction,
  setTargetContent,
  targetBlocks,
  targetRevision,
} from "../../interaction/index.js";
import { personaFor, personaVariantPromptText, variantFor } from "./persona.js";
import { answerEchoTitle, cardTitle, storedCardTitle } from "./events.js";
import { isReplayRunner } from "../../agent/factory.js";
import {
  baseVersionOf,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  type ActionContext,
} from "./common.js";

export async function slowerAction(
  ctx: ActionContext,
  cardId: string,
  opts?: { personaId?: string },
): Promise<{ cardId: string; jobId?: string; deduplicated?: boolean }> {
  const { jobs, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const persona = opts?.personaId ? personaFor(ctx, opts.personaId) : undefined;
  const personaId = opts?.personaId;
  if (personaId) {
    const variant = variantFor(snapshot, cardId, personaId);
    if (!variant) throw new Error(`persona ${personaId} has not run on card ${cardId} yet`);
  } else {
    const target = findCardTarget(snapshot, cardId);
    if (!target) throw new Error(`unknown card ${cardId}`);
  }
  const live = getSnapshotOrThrow(reviews, reviewId);
  const revision = personaId
    ? variantFor(live, cardId, personaId)!.revision
    : targetRevision(findCardTarget(live, cardId)!);
  // Issue #387: one press = one turn against this revision. The
  // revision rides the dedupe key so repeated presses stack instead of
  // collapsing into the still-running job.
  const key = {
    anchor: personaId ? `persona:${cardId}:${personaId}` : `card:${cardId}`,
    requestKind: "slower",
    revision,
    baseVersion: baseVersionOf(snapshot),
  };
  const active = findActiveJob(jobs, reviewId, key);
  if (active) return { cardId, jobId: active.id, deduplicated: true };
  return slowerViaAgent(ctx, cardId, revision, personaId ? { personaId, persona: persona! } : undefined);
}

async function slowerViaAgent(
  ctx: ActionContext,
  cardId: string,
  revision: number,
  personaOpts?: { personaId: string; persona: import("@unvibe/shared").Persona },
): Promise<{ cardId: string; jobId?: string }> {
  const { pipeline, reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const personaId = personaOpts?.personaId;
  const variant = personaId ? variantFor(snapshot, cardId, personaId) : null;
  if (personaId && !variant) throw new Error(`persona ${personaId} has not run on card ${cardId} yet`);
  const key = {
    anchor: personaId ? `persona:${cardId}:${personaId}` : `card:${cardId}`,
    requestKind: "slower",
    revision,
    baseVersion: baseVersionOf(snapshot),
  };
  const variables = {
    card: personaId ? personaVariantPromptText(snapshot, cardId, personaId) : cardPromptText(snapshot, cardId),
  };
  const capture = captureJobId();
  // Persona variants carry their own revision count, so a persona press
  // keys its own recording cluster and never collides with the guide's.
  // Thread replies carry dynamic `ans_…` ids, so they share one
  // `expansion:<revision>` cluster like the old depth recordings did.
  const replayKey =
    personaId ? `persona:${cardId}:${revision}` : cardId.startsWith("ans_") || cardId.startsWith("ann_") ? `expansion:${revision}` : `${cardId}:${revision}`;
  const replay = isReplayRunner(pipeline.runner) ? { kind: "slower", key: replayKey } : undefined;
  // Issue #50: a rewrite must not open by repeating the card title — for
  // an answer, its question (else the card's quoted text).
  const echoTitle = storedCardTitle(snapshot, cardId) ?? answerEchoTitle(snapshot, cardId);

  const done = pipeline.runInFork({
    reviewId,
    kind: "slower",
    template: "slower",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    cardId,
    ...(personaOpts ? { persona: personaOpts.persona, conversationKey: `persona:${cardId}:${personaOpts.personaId}` } : {}),
    ...(personaOpts && variant?.sessionId ? { continueSessionId: variant.sessionId } : {}),
    ...(echoTitle ? { echoCandidates: [echoTitle] } : {}),
    replay,
    onJob: (job: Job) => capture.onJob(job),
  });

  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      capture.settled();
      const replyBlocks = res.cards.flatMap((c) => c.blocks) as Block[];
      if (personaId) {
        const jobId = (await capture.wait())?.id;
        const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        await reviews.mutate(reviewId, (draft) => {
          const targetCard = (draft.pages ?? [])
            .flatMap((p) => p.cards ?? [])
            .find((c) => c.id === cardId);
          const v = targetCard?.variants?.[personaId];
          if (!targetCard || !v || !isCardVariant(v)) return;
          v.undoStack.push({ blocks: [...v.blocks] });
          v.blocks = mergeSlowerText(v.blocks, replyBlocks);
          v.revision += 1;
          if (sessionId) v.sessionId = sessionId;
          markStaleAnchors(draft, cardId);
          mirrorPromotedAnswer(draft, cardId);
        });
      } else {
        await reviews.mutate(reviewId, (draft) => {
          const t = findCardTargetInDraft(draft, cardId);
          if (!t) return;
          const current = targetBlocks(t) as Block[];
          pushUndo(t, [...current]);
          setTargetContent(t, mergeSlowerText(current, replyBlocks));
          markStaleAnchors(draft, cardId);
          mirrorPromotedAnswer(draft, cardId);
        });
      }
      // The rewritten text is card-local shared knowledge (PRD §9.3).
      // Awaited so tests observe the entry once the rewrite settles.
      try {
        const live = getSnapshotOrThrow(reviews, reviewId);
        await recordInteraction({
          kind: "slower-rewrite",
          reviewId,
          cardId,
          text: `Slower rewrite: "${cardTitle(live, cardId)}"`,
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
    return { cardId, jobId: job.id };
  }
  const fillError = await handled;
  if (fillError) throw new Error(fillError);
  return { cardId };
}
