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
 * - failed-turn handling (`DegradedTurnError`, #51/#180): a turn that
 *   fails on observed facts (empty answer, dead review-tool connection)
 *   fails the job and leaves no blocks behind. The reply's wording is
 *   never judged.
 *
 * Prompts (slice 2): the first turn of both Explain and Ask uses the
 * merged `ask.md`; later turns on a live session use the short
 * `ask_turn.md` (change list + question only), while rebuilt sessions get
 * the full prompt with the stored turns as the transcript.
 *
 * This module also owns the `explain` / `ask` / `reply` / `retry`
 * actions: one stored card, created by either first question and
 * extended by turns.
 */
import { randomBytes } from "node:crypto";
import type { ActionAnchor, Anchor, Annotation, Block, Job, ReviewSnapshot, Turn } from "@unvibe/shared";
import { JOB_PRIORITY, dedupeBlockIds, parseBlocks } from "@unvibe/shared";
import { buildAnchor, newAnnotationId } from "../../comments/threads.js";
import { excerptQuote, mirrorPromotedAnswer, recordInteraction, turnsTextFor } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { DegradedTurnError } from "../../jobs/errors.js";
import {
  anchorKey,
  baseVersionOf,
  cancelAnnotationJob,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  l4VariablesWithRevealed,
  normalizeBlockAnchor,
  suppressFillError,
  type ActionContext,
} from "./common.js";
import { anchorSameHost } from "./explain-host.js";
import { probeConversationSessionFor } from "./ask-probe.js";
import { aliasCanonicalizer, remapAliasTargets } from "./validate-apply.js";
import { newCardForTurn } from "./events.js";
import { finalizeFresh, repairDiagrams } from "./diagram-finalize.js";

/** Fresh answer id (`ans_<12 hex>`, assigned by the app). */
export function newTurnId(): string {
  return `ans_${randomBytes(6).toString("hex")}`;
}

/**
 * True when a turn still owns work: filling, failed, or job-attached
 * (issue #152: promote keeps exactly these turns on the link).
 */
export function isTurnUnsettled(t: Turn): boolean {
  return (
    ((t.working ?? "") !== "" && t.working !== null) ||
    ((t.error ?? "") !== "" && t.error !== null) ||
    t.jobId !== undefined
  );
}

/**
 * Annotations that own fillable turns: conversations, plus promoted
 * links still holding unsettled turns (issue #152: opened as a page
 * mid-fill, the fill keeps running against the link's turns and mirrors
 * onto the page cards).
 */
export function holdsFillableTurns(ann: Annotation | undefined): ann is Annotation {
  if (!ann) return false;
  if (ann.type === "conversation") return true;
  return ann.type === "link" && (ann.turns?.length ?? 0) > 0;
}

/**
 * The conversation card hosted on a hunk (issue #138), if the hunk's
 * idle summary has been activated. Matched by content hash: a hunk whose
 * content changed gets a new hash, so the old card stays with the old
 * version and is never drawn on the new hunk.
 */
export function hunkCardFor(
  snapshot: ReviewSnapshot,
  fileKey: string,
  contentHash: string,
): Annotation | undefined {
  return (snapshot.annotations ?? []).find(
    (a) =>
      a.type === "conversation" &&
      a.anchor.host.kind === "hunk" &&
      a.anchor.host.fileKey === fileKey &&
      a.anchor.host.contentHash === contentHash,
  );
}

/**
 * Ensure the hunk's conversation card (issue #138): created from the
 * stored summary text with no agent call — the first turn carries the
 * default question and the summary parsed into blocks (so inline code
 * and citations render). Reuses and reopens the stored card when the
 * hunk is already activated. The card gets no session here; the first
 * reply in its reply box creates one.
 */
export async function ensureHunkCard(
  ctx: ActionContext,
  fileKey: string,
  contentHash: string,
): Promise<{ annotationId: string; turnId: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const file = (snapshot.files ?? []).find((f) => f.fileKey === fileKey);
  if (!file) throw new Error(`unknown file ${fileKey}`);
  if (!file.hunks.some((h) => h.contentHash === contentHash)) {
    throw new Error(`unknown hunk ${fileKey}:${contentHash}`);
  }
  const summary = (snapshot.hunkStates ?? []).find((s) => s.contentHash === contentHash)?.summary?.trim();
  if (!summary) throw new Error(`hunk ${fileKey}:${contentHash} has no summary yet`);
  const existing = hunkCardFor(snapshot, fileKey, contentHash);
  if (existing) {
    if (!existing.open) {
      await reviews.mutate(reviewId, (draft) => {
        const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === existing.id);
        if (target) target.open = true;
      });
    }
    const firstTurn = (existing.turns ?? [])[0];
    if (!firstTurn) throw new Error(`hunk card ${existing.id} has no turns`);
    return { annotationId: existing.id, turnId: firstTurn.id };
  }
  const version = snapshot.version.n;
  const annotationId = newAnnotationId();
  const turnId = newTurnId();
  const blocks = parseBlocks(summary) as Block[];
  if (blocks.length === 0) throw new Error(`hunk ${fileKey}:${contentHash} summary produced no content`);
  const turn: Turn = {
    id: turnId,
    question: null,
    blocks,
    level: "standard",
    revision: 1,
    undoStack: [],
    working: null,
  };
  await reviews.mutate(reviewId, (draft) => {
    (draft.annotations as unknown as Annotation[]).push({
      id: annotationId,
      type: "conversation",
      anchor: {
        host: { kind: "hunk", fileKey, contentHash },
        quotedText: "",
        prefix: "",
        suffix: "",
        position: 0,
        version,
      },
      open: true,
      pinned: false,
      messages: [],
      post: false,
      turns: [turn],
    } as unknown as Annotation);
  });
  return { annotationId, turnId };
}

/**
 * First summary block of a hunk card's turn (the nested Explain/Ask
 * anchors here, exactly like a selection in any answer).
 */
function hunkSummaryBlock(ctx: ActionContext, annotationId: string, turnId: string): string {
  const snapshot = getSnapshotOrThrow(ctx.reviews, ctx.reviewId);
  const card = snapshot.annotations.find((a) => a.id === annotationId);
  const turn = card?.turns?.find((t) => t.id === turnId);
  const block = turn?.blocks.find((b) => b.type === "paragraph") ?? turn?.blocks[0];
  if (!turn || !block) throw new Error(`hunk card ${annotationId} has no content`);
  return `${turnId}#${block.id}`;
}

/**
 * `hunk_card`: the explicit hunk control (issue #138). Activates the
 * hunk's idle summary into its conversation card — or reopens it — with
 * no agent call. Selecting summary text and choosing Explain/Ask reaches
 * the same card through those actions with a hunk anchor.
 */
export async function hunkCardAction(
  ctx: ActionContext,
  fileKey: string,
  contentHash: string,
): Promise<{ annotationId: string; turnId: string }> {
  return ensureHunkCard(ctx, fileKey, contentHash);
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
      pinned: false,
      messages: [],
      post: false,
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
  /**
   * `ask` for first turns (both questions) and rebuilt sessions;
   * `ask_turn` for later turns on a live session (change list +
   * question only — no resend of the anchor, card and history).
   */
  template: "ask" | "ask_turn";
  /** User question text (L4 message + echo-strip candidate). */
  message: string;
  /**
   * Stored turns rendered as "conversation so far", sent instead of the
   * empty thread when the session was rebuilt (restart, idle close) and
   * the agent never saw the earlier turns. Only with template `ask`.
   */
  transcript?: string;
  /** Continue on this session instead of forking (later turns, live session). */
  continueSessionId?: string;
  dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string };
  skipDedupe?: boolean;
  echoCandidates: string[];
  /**
   * Replay marker kind: `explain` for default-question first turns,
   * `ask` for everything else (matches the recorded kinds).
   */
  replayKind: "explain" | "ask";
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
    requestKind: "ask",
    baseVersion: baseVersionOf(live),
  };
  if (!opts.skipDedupe) {
    const active = findActiveJob(ctx.jobs, reviewId, key);
    if (active) return { jobId: active.id, deduplicated: true };
  }

  // Reset to the working state (retry clears a visible error here).
  // Promoted links still holding turns fill the same way (issue #152).
  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    const turn = holdsFillableTurns(found) ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
    if (!found || !turn) return;
    found.working = opts.workingLabel;
    found.error = null;
    if (found.type === "conversation") found.open = true;
    turn.working = opts.workingLabel;
    turn.error = null;
    mirrorPromotedAnswer(draft, turnId);
  });

  const latest = getSnapshotOrThrow(reviews, reviewId);
  // Later turns on a live session send only what is new (the change
  // list rides `change_list` via the shared-context wire inside
  // `runInFork`); every other turn sends the full first-turn prompt.
  const variables =
    opts.template === "ask_turn"
      ? { message: opts.message }
      : await l4VariablesWithRevealed(ctx, latest, opts.anchor, { message: opts.message });
  if (opts.transcript !== undefined) variables.thread = opts.transcript;
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: opts.replayKind } : undefined;
  // Connection retry (#51): a continued turn that observably hits a dead
  // review-MCP URL falls back to a fresh fork with the full first-turn
  // prompt (the short follow-up prompt assumes the live session's
  // history). Only built for continued turns; anything else retries on
  // a fresh fork already. The transcript is the stored turns as text
  // (`threadTextFor` renders comment messages, not turns).
  const retryOwner = opts.continueSessionId ? latest.annotations.find((a) => a.id === annotationId) : undefined;
  const retryVariables = retryOwner
    ? await l4VariablesWithRevealed(ctx, latest, opts.anchor, { message: opts.message }).then((vars) => ({
        ...vars,
        thread: turnsTextFor(retryOwner),
      }))
    : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "ask",
    template: opts.template,
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    annotationId,
    // Persistent conversation: the next turn's change list resumes from
    // this turn's cursor (sharedctx wire advances it only on success).
    conversationKey: annotationId,
    ...(opts.continueSessionId ? { continueSessionId: opts.continueSessionId } : {}),
    retryTemplate: "ask",
    ...(retryVariables ? { retryVariables } : {}),
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
            const turn = holdsFillableTurns(found) ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
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
          const turn = holdsFillableTurns(found) ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
          if (turn && !turn.error) {
            turn.blocks = blocks as Block[];
            // Promoted mid-fill (issue #152): the page card is the
            // visible copy, so every partial lands there too.
            mirrorPromotedAnswer(draft, turnId);
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
                requestKind: "ask-diagram-repair",
                annotationId,
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
        const turn = holdsFillableTurns(found) ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
        if (!found || !turn) return;
        // Promoted links are "closed" by shape but the fill lands
        // normally (issue #152): only real conversations take the
        // closed-while-filling branch.
        if (found.type === "conversation" && !found.open && turn.blocks.length > 0) {
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
        // Promoted mid-fill: the page card is the visible copy.
        mirrorPromotedAnswer(draft, turnId);
      });
      // New turn content enters the log in full (PRD §9.3 `new-card`).
      // Awaited so tests observe the entry once the fill settles. Runs
      // before the promoted-turn drop below: the event is built from the
      // link's turns, which a settled promote then moves off the link.
      try {
        const jobId = (await capture.wait())?.id;
        const sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        const snap = getSnapshotOrThrow(reviews, reviewId);
        const filled = snap.annotations.find((a) => a.id === annotationId);
        // The card's session may have been rebuilt under a new id while
        // the turn ran: store what the job actually used — unless the
        // turns already moved off a settled promoted link.
        const stillOwnsTurn = (filled?.turns ?? []).some((t) => t.id === turnId);
        if (sessionId && filled && stillOwnsTurn && filled.sessionId !== sessionId) {
          await reviews.mutate(reviewId, (draft) => {
            const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
            if (target && (target.turns ?? []).some((t) => t.id === turnId)) target.sessionId = sessionId;
          });
        }
        const event = filled ? newCardForTurn(reviewId, snap, filled, turnId, sessionId) : null;
        if (event) await recordInteraction(event);
      } catch {
        // Logging never fails the action.
      }
      // A promoted turn that just settled may be the last one the link
      // owns: with nothing left to fill or retry, the turns move off the
      // link (the page holds the content) and the session closes, since
      // pages have no reply box.
      await dropSettledPromotedTurns(ctx, annotationId);
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      if (await suppressFillError(ctx, annotationId)) return null;
      const message = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
        const turn = holdsFillableTurns(found) ? (found.turns ?? []).find((t) => t.id === turnId) : undefined;
        if (!found || !turn) return;
        found.working = null;
        turn.working = null;
        found.error = message;
        turn.error = message;
        // A failed turn must leave no card behind: streamed partials
        // are not a finished answer (#51).
        if (err instanceof DegradedTurnError) turn.blocks = [];
        // A failed promoted turn stays retryable from the page: its
        // (emptied) blocks still mirror (issue #152).
        mirrorPromotedAnswer(draft, turnId);
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
  const turnJob = holdsFillableTurns(found)
    ? [...(found.turns ?? [])].reverse().find((t) => t.jobId)?.jobId
    : undefined;
  cancelAnnotationJob(ctx.jobs, ctx.reviewId, found?.jobId ?? turnJob);
}

/**
 * Drop a promoted link's turns once every moved turn has settled
 * successfully (issue #152): the page holds the content, the session
 * closes since pages have no reply box. Failed turns stay for Retry.
 */
export async function dropSettledPromotedTurns(ctx: ActionContext, annotationId: string): Promise<void> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found || found.type !== "link" || (found.turns?.length ?? 0) === 0) return;
  if ((found.turns ?? []).some(isTurnUnsettled)) return;
  const sessionId = found.sessionId;
  await reviews.mutate(reviewId, (draft) => {
    const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!target || target.type !== "link") return;
    if ((target.turns ?? []).some(isTurnUnsettled)) return;
    delete target.turns;
    delete target.promotedTurns;
    delete target.sessionId;
  });
  // The card's session belongs to the card: close it so it does not linger.
  if (sessionId && ctx.sessions) {
    try {
      await ctx.sessions.closeConversation(sessionId);
    } catch {
      // best-effort
    }
  }
}

export interface ExplainRequest {
  quote: string;
  anchor: ActionAnchor;
  /** Issue #166: the client's recorded selection offsets, when selected. */
  offsets?: { start: number; end: number };
}

export interface AskRequest {
  quote: string;
  anchor: ActionAnchor;
  message: string;
  /** Issue #166: the client's recorded selection offsets, when selected. */
  offsets?: { start: number; end: number };
}

/** The default question, fixed in code (the merged prompt takes it as the message). */
export const DEFAULT_QUESTION = "Explain this.";

function questionEchoCandidates(quote: string, message: string): string[] {
  // Issue #50: the app shows the selection in the card header, and a
  // first-turn question in the answer heading; a body line that merely
  // repeats either is dropped when the reply is parsed.
  return [quote, message];
}

export async function explainAction(
  ctx: ActionContext,
  req: ExplainRequest,
): Promise<{ annotationId: string; turnId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { reviews, reviewId } = ctx;
  // Empty quotes are legal: the anchor still scopes the turn.
  if (typeof req.quote !== "string") throw new Error("quote is required");
  // Issue #138: a hunk anchor activates the hunk's idle summary into a
  // card (no agent call), then this same Explain runs nested on the
  // selected summary text inside that answer.
  if (req.anchor.where === "hunk") {
    const ensured = await ensureHunkCard(ctx, req.anchor.fileKey, req.anchor.contentHash);
    // Issue #166: the recorded offsets belong to the idle summary text,
    // not to the answer block below — they are dropped here on purpose
    // and the nested card places by text match.
    return explainAction(ctx, {
      quote: req.quote,
      anchor: { where: "block", blockId: hunkSummaryBlock(ctx, ensured.annotationId, ensured.turnId) },
    });
  }
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  // Validate the host exists (buildAnchor throws on unknown hosts).
  const anchor = buildAnchor(before, normalized, req.quote, {
    ...(req.offsets !== undefined
      ? { startOffset: req.offsets.start, endOffset: req.offsets.end }
      : {}),
  });
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}`,
    requestKind: "explain",
    baseVersion: baseVersionOf(before),
  };

  // Dedupe: identical active request, or an already-stored identical card.
  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find(
      (a) => a.type === "conversation" && a.anchor.quotedText === req.quote && a.jobId === active.id,
    );
    return {
      annotationId: existing?.id ?? "",
      turnId: existing?.turns?.[0]?.id ?? "",
      jobId: active.id,
      deduplicated: true,
    };
  }
  // PRD §12 reuse (#10): the same anchor+quote on the same base version
  // reopens the stored card instead of generating a second one. Closed
  // cards reopen (dotted-link → expand in place); deleted cards
  // are gone so a repeat is legitimately a new request. A new base version
  // (new commits) invalidates: anchor.version must match current version.
  const storedDup = before.annotations.find(
    (a) =>
      a.type === "conversation" &&
      a.anchor.quotedText === req.quote &&
      anchorSameHost(a.anchor, anchor) &&
      a.anchor.version === before.version.n &&
      !a.error &&
      !(a.turns ?? []).some((t) => t.error) &&
      (a.turns ?? []).some((t) => t.blocks.length > 0),
  );
  if (storedDup) {
    if (!storedDup.open) {
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((x) => x.id === storedDup.id);
        if (found) found.open = true;
      });
    }
    return { annotationId: storedDup.id, turnId: storedDup.turns?.[0]?.id ?? "", reused: true };
  }

  // Immediately visible working state.
  const { annotationId, turnId } = await createConversationCard(ctx, anchor, null, "Thinking…");

  const res = await runConversationTurn(ctx, annotationId, turnId, {
    anchor,
    template: "ask",
    message: DEFAULT_QUESTION,
    dedupeKey: key,
    echoCandidates: questionEchoCandidates(req.quote, DEFAULT_QUESTION),
    replayKind: "explain",
    cardLabel: `Explain: ${excerptQuote(req.quote)}`,
    workingLabel: "Thinking…",
  });
  return { annotationId, turnId, ...res };
}

export async function askAction(
  ctx: ActionContext,
  req: AskRequest,
): Promise<{ annotationId: string; turnId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { reviews, reviewId } = ctx;
  if (!req.message || req.message.trim() === "") throw new Error("ask message is required");
  // Empty quotes are legal: diff-line clicks and description flows often
  // carry no quote (the header falls back to file:line). Only the type is
  // enforced (the dispatcher 400s a missing quote).
  if (typeof req.quote !== "string") throw new Error("quote is required");
  // Issue #138: a hunk anchor activates the hunk's idle summary into a
  // card (no agent call), then this same Ask runs nested on the selected
  // summary text inside that answer.
  if (req.anchor.where === "hunk") {
    const ensured = await ensureHunkCard(ctx, req.anchor.fileKey, req.anchor.contentHash);
    // Issue #166: recorded offsets belong to the idle summary text (see
    // the explain branch) — dropped here too.
    return askAction(ctx, {
      quote: req.quote,
      anchor: { where: "block", blockId: hunkSummaryBlock(ctx, ensured.annotationId, ensured.turnId) },
      message: req.message,
    });
  }
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  const anchor = buildAnchor(before, normalized, req.quote, {
    ...(req.offsets !== undefined
      ? { startOffset: req.offsets.start, endOffset: req.offsets.end }
      : {}),
  });
  // PRD §12 key (#10): the question itself is part of the identity — two
  // different messages on the same anchor must not share a job/result.
  const messageKey = req.message.trim().slice(0, 120);
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}:${messageKey}`,
    requestKind: "ask",
    baseVersion: baseVersionOf(before),
  };

  const active = findActiveJob(ctx.jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find(
      (a) => a.type === "conversation" && a.jobId === active.id,
    );
    return {
      annotationId: existing?.id ?? "",
      turnId: existing?.turns?.[0]?.id ?? "",
      jobId: active.id,
      deduplicated: true,
    };
  }

  // PRD §12 reuse (#10): the same message on the same anchor and base
  // version returns the stored card without an agent call. A different
  // message is legitimately a new request; a deleted card is gone so a
  // repeat is a new request; a new base version invalidates via
  // anchor.version.
  const storedDup = before.annotations.find((a) => {
    if (a.type !== "conversation") return false;
    if (a.anchor.quotedText !== req.quote) return false;
    if (!anchorSameHost(a.anchor, anchor)) return false;
    if (a.anchor.version !== before.version.n) return false;
    if (a.error || (a.turns ?? []).some((t) => t.error)) return false;
    const first = (a.turns ?? [])[0];
    if (!first || first.question?.trim() !== req.message.trim()) return false;
    return first.blocks.length > 0;
  });
  if (storedDup) {
    if (!storedDup.open) {
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((x) => x.id === storedDup.id);
        if (found) found.open = true;
      });
    }
    return { annotationId: storedDup.id, turnId: storedDup.turns?.[0]?.id ?? "", reused: true };
  }

  // Card with the reader's question as its first turn (guide cards start
  // open in place, like Explain).
  const { annotationId, turnId } = await createConversationCard(ctx, anchor, req.message, "Thinking…");

  const res = await runConversationTurn(ctx, annotationId, turnId, {
    anchor,
    template: "ask",
    message: req.message,
    dedupeKey: key,
    echoCandidates: questionEchoCandidates(req.quote, req.message),
    replayKind: "ask",
    cardLabel: req.message,
    workingLabel: "Thinking…",
  });
  return { annotationId, turnId, ...res };
}

/**
 * `reply`: follow-up user message on a conversation card, added as a turn
 * on the card's session. A live session gets the short prompt (only what
 * is new); a dead one falls back to a fresh fork with the stored turns
 * as the transcript — same card, same reply.
 */
export async function replyAction(
  ctx: ActionContext,
  annotationId: string,
  message: string,
): Promise<{ annotationId: string; turnId: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  if (!message || message.trim() === "") throw new Error("reply message is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const card = before.annotations.find((a) => a.id === annotationId);
  if (!card || card.type !== "conversation") throw new Error(`unknown conversation ${annotationId}`);

  const turnId = await pushConversationTurn(ctx, annotationId, message, "Writing reply…");
  // The reply-box text is consumed by this turn: clear the stored draft
  // like comment replies do, so it can never flow back into the emptied
  // box (or survive a reload) after sending. Follow-up chips keep any
  // typed reply text, so only the reply path clears.
  await reviews.mutate(reviewId, (draft) => {
    const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (target) target.reply = "";
  });
  const probe = await probeConversationSessionFor(ctx, card);
  const live = probe.continueSessionId !== undefined && !probe.rebuilt;
  const res = await runConversationTurn(ctx, annotationId, turnId, {
    anchor: card.anchor,
    template: live ? "ask_turn" : "ask",
    message,
    ...(probe.transcript !== undefined && !live ? { transcript: probe.transcript } : {}),
    ...(probe.continueSessionId ? { continueSessionId: probe.continueSessionId } : {}),
    skipDedupe: true,
    echoCandidates: [card.anchor.quotedText, message],
    replayKind: "ask",
    cardLabel: message,
    workingLabel: "Writing reply…",
  });
  return { annotationId, turnId, ...res };
}

/**
 * `retry`: rebuild the failed fill on the *same* annotation id (the last
 * turn). The queue's own retry can't re-trigger the completion applier,
 * so a rebuild (same anchor/message, same session when live) is the
 * correct retry; the visible error clears when the new attempt starts.
 * Promoted links still holding turns retry the same way (issue #152):
 * the refill mirrors onto the page card.
 */
export async function retryAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string; turnId: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!holdsFillableTurns(found)) throw new Error(`unknown conversation ${annotationId}`);
  const turns = found.turns ?? [];
  const last = turns[turns.length - 1];
  if (!last) throw new Error(`conversation ${annotationId} has no turn to retry`);
  if (!last.error && !found.error) throw new Error(`conversation ${annotationId} has no failed turn to retry`);
  const firstTurn = last.question === null;
  const probe = await probeConversationSessionFor(ctx, found);
  const live = probe.continueSessionId !== undefined && !firstTurn && !probe.rebuilt;
  const message = last.question ?? DEFAULT_QUESTION;
  const res = await runConversationTurn(ctx, annotationId, last.id, {
    anchor: found.anchor,
    template: firstTurn ? "ask" : live ? "ask_turn" : "ask",
    message,
    ...(probe.transcript !== undefined && !live && !firstTurn ? { transcript: probe.transcript } : {}),
    ...(probe.continueSessionId && (live || probe.rebuilt) ? { continueSessionId: probe.continueSessionId } : {}),
    skipDedupe: true,
    echoCandidates: questionEchoCandidates(found.anchor.quotedText, message),
    replayKind: firstTurn ? "explain" : "ask",
    cardLabel: firstTurn ? `Explain: ${excerptQuote(found.anchor.quotedText ?? "")}` : message,
    workingLabel: firstTurn ? "Thinking…" : "Writing reply…",
  });
  if (res.jobId && found.type === "link") {
    // Retry on a promoted link refills the page: the job moves to the
    // mapped card with the content (issue #152).
    const cardId = (found.promotedTurns ?? []).find((m) => m.turnId === last.id)?.cardId;
    if (cardId) {
      try {
        ctx.jobs.retarget(res.jobId, cardId);
      } catch {
        // Unknown job or already settled: the page still resolves the
        // working state through the promoted-turn mapping.
      }
    }
  }
  return { annotationId, turnId: last.id, ...res };
}
