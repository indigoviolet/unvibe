/**
 * Conversation cards, issue #136 (Explain is Ask with a default question).
 *
 * One stored card holds a list of turns; a turn is a question plus its
 * answer stored as blocks. This module owns the shared fill path every
 * turn goes through — first Explain turns, reply turns, retries and
 * follow-up answers alike:
 *
 * - `runInFork` (streaming, citation check + one repair turn, usage,
 *   contribution handling), continuing on the card's session for later
 *   turns instead of forking again;
 * - diagram finalize + one repair turn (`finalizeFresh` / `repairDiagrams`,
 *   #130), so a diagram in any answer renders;
 * - degraded-turn handling (`DegradedTurnError`, #51): a complaining turn
 *   fails the job and leaves no blocks behind.
 *
 * Prompt changes are deliberately minimal in slice 1: the first turn of
 * an Explain still uses `explain.md`, later turns use `ask.md` (the
 * merged first-turn + short follow-up prompts land with slice 2).
 */
import { randomBytes } from "node:crypto";
import type { Anchor, Annotation, Block, Job, Turn } from "@unvibe/shared";
import { JOB_PRIORITY, dedupeBlockIds } from "@unvibe/shared";
import { newAnnotationId } from "../../comments/threads.js";
import { recordInteraction } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { DegradedTurnError } from "../../jobs/errors.js";
import {
  baseVersionOf,
  cancelAnnotationJob,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  l4VariablesWithRevealed,
  suppressFillError,
  type ActionContext,
} from "./common.js";
import { aliasCanonicalizer, remapAliasTargets } from "./validate-apply.js";
import { newCardForTurn } from "./events.js";
import { finalizeFresh, repairDiagrams } from "./diagram-finalize.js";

/** Fresh answer id (`ans_<12 hex>`, assigned by the app). */
export function newTurnId(): string {
  return `ans_${randomBytes(6).toString("hex")}`;
}

/**
 * Create a conversation card with its first turn in the working state.
 * `question` is null for Explain (the default question), else the
 * reader's text. Returns the card + turn ids.
 */
export async function createConversationCard(
  ctx: ActionContext,
  anchor: Anchor,
  question: string | null,
  workingLabel: string,
): Promise<{ annotationId: string; turnId: string }> {
  const { reviews, reviewId } = ctx;
  const annotationId = newAnnotationId();
  const turnId = newTurnId();
  const turn: Turn = {
    id: turnId,
    question,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    working: workingLabel,
  };
  await reviews.mutate(reviewId, (draft) => {
    draft.annotations.push({
      id: annotationId,
      type: "conversation",
      anchor,
      open: true,
      messages: [],
      post: false,
      note: false,
      turns: [turn],
      working: workingLabel,
    } as unknown as Annotation);
  });
  return { annotationId, turnId };
}

/** Push a follow-up turn in the working state onto an open card. */
export async function pushConversationTurn(
  ctx: ActionContext,
  annotationId: string,
  question: string,
  workingLabel: string,
): Promise<string> {
  const { reviews, reviewId } = ctx;
  const turnId = newTurnId();
  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!found || found.type !== "conversation") throw new Error(`unknown conversation ${annotationId}`);
    const last = (found.turns ?? [])[(found.turns ?? []).length - 1];
    if (last?.error) {
      throw new Error(`conversation ${annotationId} has a failed turn; retry it first`);
    }
    (found.turns ?? []).push({
      id: turnId,
      question,
      blocks: [],
      level: "standard",
      revision: 1,
      undoStack: [],
      working: workingLabel,
    } as Turn);
    found.working = workingLabel;
    found.error = null;
    found.open = true;
  });
  return turnId;
}

export interface ConversationTurnOptions {
  anchor: Anchor;
  /** `explain` for first Explain turns, `ask` for every later turn (slice 1). */
  template: "explain" | "ask";
  /** User question text (L4 message + echo-strip candidate). */
  message: string;
  /**
   * Stored turns rendered as "conversation so far", sent instead of the
   * empty thread when the session was rebuilt (restart, idle close) and
   * the agent never saw the earlier turns.
   */
  transcript?: string;
  /** Continue on this session instead of forking (later turns, live session). */
  continueSessionId?: string;
  dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string };
  skipDedupe?: boolean;
  echoCandidates: string[];
  replay?: { kind: string; key?: string };
  /** Human label for the repair-turn prompt (question, else `Explain: <quote>`). */
  cardLabel: string;
  workingLabel: string;
}

/**
 * Fill an existing turn via `runInFork`. The turn keeps its id (retry
 * fills in place). Returns the job id when the job started in time.
 */
export async function runConversationTurn(
  ctx: ActionContext,
  annotationId: string,
  turnId: string,
  opts: ConversationTurnOptions,
): Promise<{ jobId?: string; deduplicated?: boolean }> {
  const { pipeline, reviews, reviewId } = ctx;
  const live = getSnapshotOrThrow(reviews, reviewId);
  const key = opts.dedupeKey ?? {
    anchor: `ann:${annotationId}:${opts.message.slice(0, 80)}`,
    requestKind: opts.template === "explain" ? "explain" : "ask",
    baseVersion: baseVersionOf(live),
  };
  if (!opts.skipDedupe) {
    const active = findActiveJob(ctx.jobs, reviewId, key);
    if (active) return { jobId: active.id, deduplicated: true };
  }

  // Reset to the working state (retry clears a visible error here).
  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    const turn = found?.type === "conversation" ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
    if (!found || !turn) return;
    found.working = opts.workingLabel;
    found.error = null;
    found.open = true;
    turn.working = opts.workingLabel;
    turn.error = null;
  });

  const latest = getSnapshotOrThrow(reviews, reviewId);
  const variables = await l4VariablesWithRevealed(ctx, latest, opts.anchor, { message: opts.message });
  if (opts.transcript !== undefined) variables.thread = opts.transcript;
  const capture = captureJobId();
  const replay = opts.replay ?? (isReplayRunner(pipeline.runner) ? { kind: opts.template } : undefined);

  const done = pipeline.runInFork({
    reviewId,
    kind: opts.template,
    template: opts.template,
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    threadId: annotationId,
    // Persistent conversation: the next turn's change list resumes from
    // this turn's cursor (sharedctx wire advances it only on success).
    conversationKey: annotationId,
    ...(opts.continueSessionId ? { continueSessionId: opts.continueSessionId } : {}),
    // Issue #50: the app shows the selection in the card header; a body
    // line that merely repeats it is dropped when the reply is parsed.
    echoCandidates: opts.echoCandidates,
    ...(replay ? { replay } : {}),
    onJob: (job: Job) => {
      capture.onJob(job);
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          if (found) {
            found.jobId = job.id;
            const turn = found.type === "conversation" ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
            if (turn) turn.jobId = job.id;
          }
        })
        .catch(() => {});
    },
    onPartial: (cards) => {
      // Stream finished cards into the turn as blocks. A multi-card
      // reply repeats block IDs across cards (#116): dedupe so one anchor
      // matches one block.
      const blocks = dedupeBlockIds(cards.flatMap((c) => c.blocks));
      if (blocks.length === 0) return;
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
          const turn = found?.type === "conversation" ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
          if (turn && !turn.error) {
            turn.blocks = blocks as Block[];
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
            const turn = getSnapshotOrThrow(reviews, reviewId).annotations
              .find((a) => a.id === annotationId)?.turns?.find((t) => t.id === turnId);
            const repaired = await repairDiagrams(
              ctx,
              {
                card: opts.cardLabel,
                level: turn?.level ?? "standard",
                dedupeAnchor: `ann:${annotationId}`,
                requestKind: `${opts.template}-diagram-repair`,
                threadId: annotationId,
                conversationKey: annotationId,
                echoCandidates: opts.echoCandidates,
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
        const turn = found?.type === "conversation" ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
        if (!found || !turn) return;
        if (!found.open && turn.blocks.length > 0) {
          // Closed while filling: keep the content for the dotted-link preview.
          turn.blocks = stored;
          turn.revision += 1;
          turn.working = null;
          found.working = null;
          return;
        }
        turn.blocks = stored;
        turn.revision += 1;
        turn.working = null;
        turn.error = null;
        turn.jobId = undefined;
        found.working = null;
        found.error = null;
        found.jobId = undefined;
      });
      // New turn content enters the log in full (PRD §9.3 `new-card`).
      // Awaited so tests observe the entry once the fill settles.
      try {
        const jobId = (await capture.wait())?.id;
        const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        const snap = getSnapshotOrThrow(reviews, reviewId);
        const filled = snap.annotations.find((a) => a.id === annotationId);
        // The card's session may have been rebuilt under a new id while
        // the turn ran: store what the job actually used.
        if (sessionId && filled && filled.sessionId !== sessionId) {
          await reviews.mutate(reviewId, (draft) => {
            const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
            if (target) target.sessionId = sessionId;
          });
        }
        const event = filled ? newCardForTurn(reviewId, snap, filled, turnId, sessionId) : null;
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
        const turn = found?.type === "conversation" ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
        if (!found || !turn) return;
        found.working = null;
        turn.working = null;
        found.error = message;
        turn.error = message;
        // A degraded turn must leave no card behind: streamed partials
        // may already hold the chatter (#51).
        if (err instanceof DegradedTurnError) turn.blocks = [];
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
  // is already on the turn's visible error state, so the response stays
  // 200 with no job to stream on.
  await handled;
  return {};
}

/** Cancel the job filling a conversation turn (used by close/delete). */
export function cancelConversationJob(ctx: ActionContext, snapshot: { annotations: Annotation[] }, annotationId: string): void {
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  const turnJob =
    found?.type === "conversation"
      ? [...(found.turns ?? [])].reverse().find((t) => t.jobId)?.jobId
      : undefined;
  cancelAnnotationJob(ctx.jobs, ctx.reviewId, found?.jobId ?? turnJob);
}
