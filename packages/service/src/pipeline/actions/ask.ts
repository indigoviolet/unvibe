/**
 * `ask` / `reply` / `retry` actions (PRD §4.8).
 *
 * - `ask` creates the thread (`createAskThread`) then fills the agent's
 *   reply with citations via `runInFork` + `appendAgentReply`, streamed
 *   (WS `text` events on the job; the final message carries validated
 *   citations). A retryable failure leaves the thread with a visible
 *   error state and a retry path, never a spinner forever.
 * - `reply` appends a follow-up user message and continues the *same*
 *   conversation session (forked once per thread; further turns go
 *   through `SessionManager.sendOnConversation`).
 * - `retry` rebuilds the failed fill on the *same* thread/expansion id
 *   (the queue's own retry can't re-trigger the completion applier, so a
 *   rebuild is the correct retry).
 *
 * `note` (no agent reply) lives in `note.ts`.
 */
import type { ActionAnchor, Anchor, Annotation, ChatMessage, Job, ParsedCard } from "@unvibe/shared";
import { JOB_PRIORITY, splitReply } from "@unvibe/shared";
import { appendAgentReplyInDraft, buildAnchor, createThreadInDraft, newAnnotationId } from "../../comments/threads.js";
import { recordInteraction, type InteractionEvent } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { withReplayMark } from "../replayMark.js";
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
import { canonicalizeCitations } from "./validate-apply.js";
import { hasOutOfBaseCitations } from "./events.js";
import { anchorSameHost } from "./explain-host.js";
import { pushConversationTurn, runConversationTurn } from "./conversation.js";
import { probeConversationSessionFor } from "./ask-probe.js";

export interface AskRequest {
  quote: string;
  anchor: ActionAnchor;
  message: string;
}

export async function askAction(
  ctx: ActionContext,
  req: AskRequest,
): Promise<{ threadId: string; jobId?: string; deduplicated?: boolean; reused?: boolean }> {
  const { jobs, reviews, reviewId } = ctx;
  if (!req.message || req.message.trim() === "") throw new Error("ask message is required");
  // Empty quotes are legal: diff-line clicks and description flows often
  // carry no quote (the header falls back to file:line). Only the type is
  // enforced (the dispatcher 400s a missing quote).
  if (typeof req.quote !== "string") throw new Error("quote is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const normalized = normalizeBlockAnchor(before, req.anchor);
  const anchor = buildAnchor(before, normalized, req.quote);
  // PRD §12 key (#10): the question itself is part of the identity — two
  // different messages on the same anchor must not share a job/result.
  const messageKey = req.message.trim().slice(0, 120);
  const key = {
    anchor: `${anchorKey(normalized)}:${req.quote.slice(0, 80)}:${messageKey}`,
    requestKind: "ask",
    baseVersion: baseVersionOf(before),
  };

  const active = findActiveJob(jobs, reviewId, key);
  if (active) {
    const existing = before.annotations.find((a) => a.type === "thread" && a.jobId === active.id);
    return { threadId: existing?.id ?? "", jobId: active.id, deduplicated: true };
  }

  // PRD §12 reuse (#10): the same message on the same anchor and base
  // version returns the stored thread without an agent call. A different
  // message is legitimately a new request; a deleted thread is gone so a
  // repeat is a new request; a new base version invalidates via
  // anchor.version.
  const storedDup = before.annotations.find((a) => {
    if (a.type !== "thread" || a.note) return false;
    if (a.anchor.quotedText !== req.quote) return false;
    if (!anchorSameHost(a.anchor, anchor)) return false;
    if (a.anchor.version !== before.version.n) return false;
    if (a.error) return false;
    const firstUser = a.messages.find((m) => m.who === "you" && m.text);
    if (!firstUser || firstUser.text?.trim() !== req.message.trim()) return false;
    const hasAi = a.messages.some((m) => m.who === "ai" && (m.text || m.html));
    return hasAi;
  });
  if (storedDup) {
    return { threadId: storedDup.id, reused: true };
  }

  // Thread with the user's first message (guide threads start closed,
  // diff/description threads start open — see threads.ts).
  const threadId = newAnnotationId();
  await reviews.mutate(reviewId, (draft) => {
    const snap = reviews.getSnapshot(reviewId)!;
    const thread = createThreadInDraft(draft, snap, {
      anchor: normalized,
      quote: req.quote,
      text: req.message,
      note: false,
    });
    // Rename to our pre-assigned id so the response is stable.
    const created = (draft.annotations as unknown as Annotation[]).find((a) => a.id === thread.id)!;
    created.id = threadId;
    created.working = "Reading…";
  });

  const res = await runAskFill(ctx, threadId, anchor, { dedupeKey: key });
  return { threadId, ...res };
}

/**
 * Fill an existing thread's pending agent reply via `runInFork` (a fresh
 * fork carrying the full thread history as L4). Used by `ask` and by
 * `retry`/`reply` fallbacks on the same thread id.
 */
export async function runAskFill(
  ctx: ActionContext,
  threadId: string,
  anchor: Anchor,
  opts: { dedupeKey?: { anchor: string; requestKind: string; depth?: string; baseVersion: string }; skipDedupe?: boolean } = {},
): Promise<{ jobId?: string; deduplicated?: boolean }> {
  const { pipeline, reviews, reviewId } = ctx;
  const live = getSnapshotOrThrow(reviews, reviewId);
  const thread = live.annotations.find((a) => a.id === threadId);
  if (!thread) throw new Error(`unknown comment ${threadId}`);
  const key = opts.dedupeKey ?? {
    anchor: `thread:${threadId}`,
    requestKind: "ask",
    baseVersion: baseVersionOf(live),
  };
  if (!opts.skipDedupe) {
    const active = findActiveJob(ctx.jobs, reviewId, key);
    if (active) return { jobId: active.id, deduplicated: true };
  }
  const lastUser = [...thread.messages].reverse().find((m) => m.who === "you" && m.text);
  const message = lastUser?.text ?? "";

  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
    if (!found) return;
    found.working = "Reading…";
    found.error = null;
    found.open = true;
  });

  const latest = getSnapshotOrThrow(reviews, reviewId);
  const current = latest.annotations.find((a) => a.id === threadId)!;
  const variables = await l4VariablesWithRevealed(ctx, latest, anchor, { thread: current, message });
  const capture = captureJobId();
  const replay = isReplayRunner(pipeline.runner) ? { kind: "ask" } : undefined;

  const done = pipeline.runInFork({
    reviewId,
    kind: "ask",
    template: "ask",
    variables,
    priority: JOB_PRIORITY.userRequested,
    dedupeKey: key,
    threadId,
    // Persistent conversation: follow-up turns resume from this turn's
    // cursor (the wire advances it only on success).
    conversationKey: threadId,
    // Issue #50: the thread shows the selection and the question; body
    // lines that merely repeat them are dropped when parsed.
    echoCandidates: [anchor.quotedText, message],
    replay,
    onJob: (job: Job) => {
      capture.onJob(job);
      void reviews
        .mutate(reviewId, (draft) => {
          const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
          if (found) found.jobId = job.id;
        })
        .catch(() => {});
    },
  });

  // Handlers return the fill error (or null); with no job the response
  // awaits the handler so fail-fast errors surface synchronously.
  const handled: Promise<string | null> = done.then(
    async (res): Promise<string | null> => {
      // Unblock the HTTP response even when no job was ever enqueued
      // (fail-fast agent); the fill below proceeds in the background.
      capture.settled();
      const { html, citations } = replyHtml(res.cards);
      const fixedCitations = canonicalizeCitations(citations, getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
      // The app removes the trailing JSON block before display (reply-format
      // §10): store the body, not the raw reply.
      const split = splitReply(res.text);
      const body = split.ok ? split.body.trim() : res.text;
      await reviews.mutate(reviewId, (draft) => {
        appendAgentReplyInDraft(draft, threadId, { text: body, html });
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId)!;
        found.working = null;
        found.error = null;
        found.jobId = undefined;
        const last = found.messages[found.messages.length - 1];
        if (fixedCitations.length > 0) last.citations = fixedCitations;
      });
      // Remember the conversation session for follow-up turns.
      let sessionId: string | undefined;
      try {
        const jobId = (await capture.wait())?.id;
        sessionId = jobId ? ctx.jobs.get(jobId)?.sessionId : undefined;
        if (sessionId) {
          await reviews.mutate(reviewId, (draft) => {
            const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
            if (found) found.sessionId = sessionId;
          });
        }
      } catch {
        // Session tracking is best-effort; replies fall back to a fork.
      }
      // Answers citing fetched code (outside the base pack) are shared in
      // full (PRD §9.3). Threads themselves settle later via close/idle.
      // Awaited so tests observe the entry once the reply settles.
      try {
        if (hasOutOfBaseCitations(res.validation.tokens)) {
          const event: InteractionEvent = {
            kind: "out-of-base-answer",
            reviewId,
            text: body,
            threadId,
            citations: fixedCitations.map((c) => c.target),
          };
          if (sessionId) event.sessionId = sessionId;
          await recordInteraction(event);
        }
      } catch {
        // Logging never fails the action.
      }
      return null;
    },
    async (err: Error): Promise<string | null> => {
      capture.settled();
      if (await suppressFillError(ctx, threadId)) return null;
      const messageText = err instanceof Error ? err.message : String(err);
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
        if (!found) return;
        found.working = null;
        found.error = messageText;
      });
      // Failures produce no shared knowledge: visible error only, no log.
      return messageText;
    },
  );

  const job = await capture.wait();
  if (job) {
    handled.catch(() => {});
    return { jobId: job.id };
  }
  // No job: the fill settled inline (fail-fast agent). Its error, if any,
  // is already on the thread's visible error state, so the response stays
  // 200 with no job to stream on.
  await handled;
  return {};
}

/**
 * Render the agent's reply cards to thread HTML (paragraphs joined).
 *
 * Issue #103: thread replies never show follow-up suggestions. `follow-up`
 * blocks are discarded, as is a bare `Follow-ups` heading the parser left
 * as plain text (a heading shape outside the `### Follow-ups` convention,
 * or one with no list under it) — plus a list directly under such a
 * heading, which can only be orphaned suggestions. A `## Follow-up(s)`
 * line is a card boundary to the parser, so a card carrying that title is
 * suggestions too and is skipped whole.
 */
function replyHtml(cards: ParsedCard[]): {
  html: string;
  citations: { target: string; unverified?: boolean }[];
} {
  const parts: string[] = [];
  const citations: { target: string; unverified?: boolean }[] = [];
  for (const card of cards) {
    if (card.title && isFollowUpsHeading(card.title)) continue;
    const blocks = card.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.type === "paragraph" && isFollowUpsHeading(b.text.standard)) {
        // A leftover "Follow-ups" heading: drop it and a list of orphaned
        // suggestions directly under it.
        if (blocks[i + 1]?.type === "list") i++;
        continue;
      }
      if (b.type === "paragraph") {
        parts.push(`<p>${b.text.standard}</p>`);
        for (const c of b.citations ?? []) citations.push({ ...c });
      } else if (b.type === "list") {
        parts.push(`<ul>${b.items.map((it) => `<li>${it.html ?? ""}</li>`).join("")}</ul>`);
        for (const it of b.items) for (const c of it.citations ?? []) citations.push({ ...c });
      } else if (b.type === "table" || b.type === "code") {
        const body = b.type === "table" ? b.html : `<pre><code>${escapeHtml(b.code)}</code></pre>`;
        parts.push(body);
        for (const c of b.citations ?? []) citations.push({ ...c });
      } else if (b.type === "diagram") {
        parts.push(`<pre class="d2">${escapeHtml(b.source)}</pre>`);
        if (b.caption) parts.push(`<p>${b.caption}</p>`);
        for (const c of b.citations ?? []) citations.push({ ...c });
      } else if (b.type === "aside") {
        const { html: inner, citations: innerCites } = replyHtml([{ title: null, blocks: b.inner }]);
        parts.push(`<aside><strong>${escapeHtml(b.kind)}</strong>${inner}</aside>`);
        for (const c of innerCites) citations.push(c);
        for (const c of b.citations ?? []) citations.push({ ...c });
      } else if (b.type === "follow-up") {
        // Issue #103: thread replies never show follow-up suggestions, even
        // when the model still sends them.
        continue;
      }
    }
  }
  return { html: parts.join("\n"), citations };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when rendered inline HTML is just a `Follow-ups` heading line. */
function isFollowUpsHeading(html: string): boolean {
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .trim();
  return /^(#{1,6}\s*)?follow-?ups?$/i.test(text);
}

/**
 * `reply`: follow-up user message on a conversation card (added as a turn
 * on the card's session) or on an Ask thread (slice 1: Ask still makes
 * threads). A live session is continued; a dead one falls back to a fresh
 * fork with the stored turns as the transcript — same card, same reply.
 */
export async function replyAction(
  ctx: ActionContext,
  annotationId: string,
  message: string,
): Promise<{ annotationId: string; threadId?: string; turnId?: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  if (!message || message.trim() === "") throw new Error("reply message is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const found = before.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown comment ${annotationId}`);
  if (found.type === "conversation") {
    return replyOnConversation(ctx, annotationId, message);
  }
  if (found.type !== "thread") throw new Error(`annotation ${annotationId} is not a thread`);
  const threadId = annotationId;
  if (found.error) {
    // A failed turn must be retried explicitly; a new message on top of
    // a failure would hide the retry path.
    throw new Error(`thread ${threadId} has a failed reply; retry it first`);
  }

  await reviews.mutate(reviewId, (draft) => {
    const target = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId)!;
    (target.messages as ChatMessage[]).push({ who: "you", text: message });
    target.working = "Reading…";
    target.error = null;
    target.open = true;
  });

  // Fallback: fresh fork with the full thread history as L4.
  return { annotationId: threadId, threadId, ...(await runAskFill(ctx, threadId, found.anchor, { skipDedupe: true })) };
}

/**
 * Follow-up turn on a conversation card through the shared turn path
 * (`runConversationTurn`): same streaming, citation check, repair turn,
 * diagram finalize and degraded handling as the first turn. Own job (user
 * priority) so the HTTP response carries its `jobId`.
 */
async function replyOnConversation(
  ctx: ActionContext,
  annotationId: string,
  message: string,
): Promise<{ annotationId: string; turnId: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  const before = getSnapshotOrThrow(reviews, reviewId);
  const card = before.annotations.find((a) => a.id === annotationId);
  if (!card || card.type !== "conversation") throw new Error(`unknown conversation ${annotationId}`);

  const turnId = await pushConversationTurn(ctx, annotationId, message, "Writing reply…");
  const probe = await probeConversationSessionFor(ctx, card);
  const res = await runConversationTurn(ctx, annotationId, turnId, {
    anchor: card.anchor,
    template: "ask",
    message,
    ...(probe.transcript !== undefined ? { transcript: probe.transcript } : {}),
    ...(probe.continueSessionId ? { continueSessionId: probe.continueSessionId } : {}),
    skipDedupe: true,
    echoCandidates: [card.anchor.quotedText, message],
    cardLabel: message,
    workingLabel: "Writing reply…",
  });
  return { annotationId, turnId, ...res };
}

/**
 * `retry`: rebuild the failed fill on the *same* annotation id (the last
 * turn of a conversation card, or an Ask thread fill). The queue's own
 * retry can't re-trigger the completion applier, so a rebuild (same
 * anchor/message, same session when live) is the correct retry; the
 * visible error clears when the new attempt starts.
 */
export async function retryAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string; threadId?: string; turnId?: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown comment ${annotationId}`);
  if (found.type === "conversation") {
    const turns = found.turns ?? [];
    const last = turns[turns.length - 1];
    if (!last) throw new Error(`conversation ${annotationId} has no turn to retry`);
    if (!last.error && !found.error) throw new Error(`conversation ${annotationId} has no failed turn to retry`);
    const firstTurn = last.question === null;
    const probe = await probeConversationSessionFor(ctx, found);
    const message = last.question ?? `Explain: ${found.anchor.quotedText}`;
    const res = await runConversationTurn(ctx, annotationId, last.id, {
      anchor: found.anchor,
      template: firstTurn ? "explain" : "ask",
      message,
      ...(probe.transcript !== undefined ? { transcript: probe.transcript } : {}),
      ...(probe.continueSessionId ? { continueSessionId: probe.continueSessionId } : {}),
      skipDedupe: true,
      echoCandidates: firstTurn ? [found.anchor.quotedText] : [found.anchor.quotedText, message],
      cardLabel: firstTurn ? `Explain: ${found.anchor.quotedText}` : message,
      workingLabel: firstTurn ? "Thinking…" : "Writing reply…",
    });
    return { annotationId, turnId: last.id, ...res };
  }
  if (!found.error) throw new Error(`thread ${annotationId} has no failed reply to retry`);

  const res = await runAskFill(ctx, annotationId, found.anchor, { skipDedupe: true });
  return { annotationId, threadId: annotationId, ...res };
}

/** Cancel the ask job (used by close/delete). */
export function cancelAskJob(ctx: ActionContext, threadId: string): void {
  const snapshot = ctx.reviews.getSnapshot(ctx.reviewId);
  const found = snapshot?.annotations.find((a) => a.id === threadId);
  cancelAnnotationJob(ctx.jobs, ctx.reviewId, found?.jobId);
}
