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
import type { ActionAnchor, Anchor, Annotation, Block, ChatMessage, Job, ParsedCard } from "@unvibe/shared";
import { JOB_PRIORITY, parseCards, splitReply } from "@unvibe/shared";
import { appendAgentReplyInDraft, buildAnchor, createThreadInDraft, newAnnotationId } from "../../comments/threads.js";
import { l4Variables, recordInteraction, type InteractionEvent } from "../../interaction/index.js";
import { isReplayRunner } from "../../agent/factory.js";
import { RetryableError } from "../../jobs/errors.js";
import { validateReply } from "../../validate/index.js";
import { lookupWithAliases } from "./validate-apply.js";
import { withReplayMark } from "../replayMark.js";
import { loadTemplatesDirSync, renderTemplate } from "../../prompts/index.js";
import type { TokenUsage } from "@unvibe/shared";
import {
  anchorKey,
  baseVersionOf,
  cancelAnnotationJob,
  captureJobId,
  findActiveJob,
  getSnapshotOrThrow,
  normalizeBlockAnchor,
  suppressFillError,
  type ActionContext,
} from "./common.js";
import { canonicalizeCitations } from "./validate-apply.js";
import { hasOutOfBaseCitations } from "./events.js";
import { changeListVariable, ingestAgentTurn } from "../sharedctx-wire.js";
import { anchorSameHost } from "./explain.js";

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
  const variables = l4Variables(latest, anchor, { thread: current, message });
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
 * `reply`: follow-up user message in an existing thread on the *same*
 * conversation session. Falls back to a fresh `runAskFill` fork when the
 * session is gone (restart pruned it) — still one thread, one reply.
 */
export async function replyAction(
  ctx: ActionContext,
  threadId: string,
  message: string,
): Promise<{ threadId: string; jobId?: string }> {
  const { reviews, reviewId, sessions } = ctx;
  if (!message || message.trim() === "") throw new Error("reply message is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const thread = before.annotations.find((a) => a.id === threadId);
  if (!thread) throw new Error(`unknown comment ${threadId}`);
  if (thread.type !== "thread") throw new Error(`annotation ${threadId} is not a thread`);
  if (thread.error) {
    // A failed turn must be retried explicitly; a new message on top of
    // a failure would hide the retry path.
    throw new Error(`thread ${threadId} has a failed reply; retry it first`);
  }

  await reviews.mutate(reviewId, (draft) => {
    const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId)!;
    (found.messages as ChatMessage[]).push({ who: "you", text: message });
    found.working = "Reading…";
    found.error = null;
    found.open = true;
  });

  const sessionId = thread.sessionId;
  if (sessionId && sessions) {
    // The conversation session may have died with a restart (agent
    // subprocesses do not survive SIGKILL, and a fresh process has no live
    // sessions). Probe it: when it cannot be reopened, drop the id so the
    // fallback below forks fresh with the full thread history as L4 —
    // same thread, same reply, no stuck error.
    try {
      await sessions.ensureConversation(sessionId);
    } catch {
      await reviews.mutate(reviewId, (draft) => {
        const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
        if (found) delete found.sessionId;
      });
      return { threadId, ...(await runAskFill(ctx, threadId, thread.anchor, { skipDedupe: true })) };
    }
    return replyOnSession(ctx, threadId, sessionId);
  }
  // Fallback: fresh fork with the full thread history as L4.
  return { threadId, ...(await runAskFill(ctx, threadId, thread.anchor, { skipDedupe: true })) };
}

/**
 * Follow-up turn on an existing conversation session: one prompt turn
 * via `SessionManager.sendOnConversation`, streamed, validated with one
 * repair turn, applied with `appendAgentReply`. Own job (user priority)
 * so the HTTP response carries its `jobId` and close/delete can cancel it.
 */
async function replyOnSession(
  ctx: ActionContext,
  threadId: string,
  sessionId: string,
): Promise<{ threadId: string; jobId?: string }> {
  const { jobs, reviews, reviewId, sessions, pipeline } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const thread = snapshot.annotations.find((a) => a.id === threadId)!;

  const promptsDir = ctx.promptsDir ?? process.env.UNVIBE_PROMPTS_DIR ?? "prompts";
  const lib = loadTemplatesDirSync(promptsDir);
  const tpl = lib.get("ask");
  if (!tpl) throw new Error("unknown prompt template ask");
  const lastUser = [...thread.messages].reverse().find((m) => m.who === "you" && m.text);
  // Filtered change list since this conversation's cursor (the wire seeds
  // it at the base seq on first use); falls back to "(no changes)" when
  // the shared-context service is absent (tests).
  const wireDeps =
    ctx.settings && ctx.sessions
      ? {
          reviews,
          sessions: ctx.sessions,
          settings: ctx.settings,
          promptsDir,
          ...(ctx.sharedctx ? { sharedctx: ctx.sharedctx } : {}),
        }
      : null;
  const l4 = l4Variables(snapshot, thread.anchor, { thread, message: lastUser?.text ?? "" });
  const variables = wireDeps
    ? changeListVariable(wireDeps, reviewId, "ask", l4, { conversationKey: threadId })
    : { ...l4, change_list: "(no changes)" };
  let prompt = renderTemplate(tpl, variables);
  if (isReplayRunner(pipeline.runner)) prompt = withReplayMark(prompt, { kind: "ask" });

  const enqueued = jobs.enqueue({
    reviewId,
    kind: "ask",
    provider: "main",
    model: "main",
    priority: JOB_PRIORITY.userRequested,
    dedupe: {
      anchor: `thread:${threadId}:${(lastUser?.text ?? "").slice(0, 40)}`,
      requestKind: "ask-reply",
      baseVersion: baseVersionOf(snapshot),
    },
    threadId,
    promptSnapshot: prompt,
    run: async (jobCtx) => {
      jobCtx.setPromptSnapshot(prompt);
      // #122: never continue from a stale log — wait for the previous
      // turn's bookkeeping (base growth) to land first.
      await pipeline.drainBookkeeping(reviewId);
      const send = sessions!.sendOnConversation.bind(sessions);
      const usage: TokenUsage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
      const collect = async (text: string): Promise<string> => {
        let out = "";
        const res = await send(sessionId, text, { signal: jobCtx.signal });
        usage.inputTokens += res.usage.inputTokens;
        usage.cachedReadTokens += res.usage.cachedReadTokens;
        usage.cachedWriteTokens += res.usage.cachedWriteTokens;
        usage.outputTokens += res.usage.outputTokens;
        for (const chunk of chunkByWords(res.text, 64)) {
          if (jobCtx.signal.aborted) throw new Error("aborted");
          out += chunk;
          jobCtx.reportText(chunk);
        }
        return out;
      };
      for (let attempt = 0; ; attempt++) {
        try {
          const text = await collect(attempt === 0 ? prompt : repairPromptText());
          throwIfMcpRefusalLocal(text);
          // Issue #50: the thread shows the selection and the question.
          const parsed = parseAndValidateLocal(ctx, reviewId, text, [
            thread.anchor.quotedText,
            lastUser?.text ?? "",
          ]);
          if (parsed.validation.needsRepairTurn && attempt === 0) continue;
          jobCtx.reportUsage(usage);
          await recordUsageLocal(ctx, reviewId, usage);
          const { html, citations } = replyHtml(parsed.cards);
          const fixedCitations = canonicalizeCitations(citations, getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
          const turnSplit = splitReply(text);
          const turnBody = turnSplit.ok ? turnSplit.body.trim() : text;
          await reviews.mutate(reviewId, (draft) => {
            appendAgentReplyInDraft(draft, threadId, { text: turnBody, html });
            const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId)!;
            found.working = null;
            found.error = null;
            found.jobId = undefined;
            const last = found.messages[found.messages.length - 1];
            if (fixedCitations.length > 0) last.citations = fixedCitations;
          });
          // Same-session turns ingest contributions, advance the cursor and
          // grow the base exactly like fork turns (best-effort). #122: the
          // reply is applied above; bookkeeping joins the per-review chain
          // (still awaited before the job ends, so a crash leaves the job
          // visibly interrupted, never silently unbookkept).
          await pipeline.finishBookkeeping(reviewId, async () => {
            if (wireDeps?.sharedctx && wireDeps.settings && wireDeps.sessions) {
              try {
                const lookup = lookupWithAliases(getSnapshotOrThrow(reviews, reviewId), ctx.fixturesDir);
                await ingestAgentTurn(
                  {
                    reviews,
                    sessions: wireDeps.sessions,
                    settings: wireDeps.settings,
                    promptsDir,
                    sharedctx: wireDeps.sharedctx,
                  },
                  reviewId,
                  {
                    sessionId,
                    threadId,
                    conversationKey: threadId,
                    data: turnSplit.ok ? turnSplit.data : null,
                    snapshot: getSnapshotOrThrow(reviews, reviewId),
                    lookup,
                    appendToBase: (baseKey, batch) => wireDeps.sessions.appendLogBatch(baseKey, batch),
                  },
                );
              } catch {
                // best-effort
              }
            }
          });
          // Answers citing fetched code are shared in full (PRD §9.3).
          try {
            if (hasOutOfBaseCitations(parsed.validation.tokens)) {
              await recordInteraction({
                kind: "out-of-base-answer",
                reviewId,
                text: turnBody,
                threadId,
                citations: fixedCitations.map((c) => c.target),
                sessionId,
              });
            }
          } catch {
            // Logging never fails the action.
          }
          return;
        } catch (err) {
          if (err instanceof RetryableError && attempt < 3) {
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
            continue;
          }
          if (await suppressFillError(ctx, threadId)) throw err;
          const msg = err instanceof Error ? err.message : String(err);
          await reviews.mutate(reviewId, (draft) => {
            const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
            if (found) {
              found.working = null;
              found.error = msg;
            }
          });
          // Failures produce no shared knowledge: visible error only, no log.
          throw err;
        }
      }
    },
  });
  void reviews
    .mutate(reviewId, (draft) => {
      const found = (draft.annotations as unknown as Annotation[]).find((a) => a.id === threadId);
      if (found) found.jobId = enqueued.id;
    })
    .catch(() => {});
  return { threadId, jobId: enqueued.id };
}

function chunkByWords(text: string, size: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (const m of text.match(/\S+\s*|\s+/g) ?? []) {
    if (cur.length > 0 && cur.length + m.length > size && m.trim() !== "") {
      chunks.push(cur);
      cur = m;
    } else {
      cur += m;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const MCP_REFUSAL_RE = /can'?t access (that )?tool/i;
function throwIfMcpRefusalLocal(text: string): void {
  if (MCP_REFUSAL_RE.test(text)) throw new RetryableError("codex MCP refusal flake (no tool attempt); retrying");
}

function repairPromptText(): string {
  return "Some citations in your previous reply could not be verified. Reply with the same content and corrected citation tokens.";
}

function parseAndValidateLocal(
  ctx: ActionContext,
  reviewId: string,
  text: string,
  echoCandidates: string[] = [],
): { cards: ParsedCard[]; validation: ReturnType<typeof validateReply> } {
  // Lightweight mirror of the pipeline's parse+validate (the shared seam
  // owns the full version; this path only runs for same-session turns).
  const split = splitReply(text);
  if (!split.ok && (split.error.kind === "malformed" || split.error.kind === "not-object")) {
    throw new Error(`the agent's reply was not in the expected format (${split.error.kind}: ${split.error.message})`);
  }
  const body = split.ok ? split.body : (split as { body: string }).body;
  // Issue #50: same echo strip as `runInFork` (selection, question).
  const cards = parseCards(body, { echoCandidates });
  const snapshot = ctx.reviews.getSnapshot(reviewId)!;
  const lookup = lookupWithAliases(snapshot, ctx.fixturesDir);
  const blocks = cards.flatMap((c) => c.blocks);
  const anchor =
    split.ok && typeof split.data === "object" && split.data !== null
      ? (split.data as { anchor?: { quote?: string; host?: string } }).anchor
      : undefined;
  const validation = validateReply(blocks as Block[], lookup, {
    ...(anchor?.quote && anchor?.host ? { anchor: { quote: anchor.quote, host: anchor.host } } : {}),
  });
  return { cards, validation };
}

async function recordUsageLocal(ctx: ActionContext, reviewId: string, usage: TokenUsage): Promise<void> {
  try {
    await ctx.reviews.mutate(reviewId, (draft) => {
      const t = draft.usageTotals ?? {
        inputTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        outputTokens: 0,
        createdAt: draft.review.createdAt,
      };
      t.inputTokens += usage.inputTokens;
      t.cachedReadTokens += usage.cachedReadTokens;
      t.cachedWriteTokens += usage.cachedWriteTokens;
      t.outputTokens += usage.outputTokens;
      const total = t.inputTokens + t.cachedReadTokens + t.cachedWriteTokens;
      t.cacheHitRate = total > 0 ? t.cachedReadTokens / total : undefined;
      draft.usageTotals = t;
    });
  } catch {
    // best-effort
  }
}

/**
 * `retry`: rebuild the failed fill on the *same* thread/expansion id.
 * The queue's own retry can't re-trigger the completion applier, so a
 * rebuild (same anchor/message, new fork) is the correct retry; the
 * visible error clears when the new attempt starts.
 */
export async function retryAction(
  ctx: ActionContext,
  threadId: string,
): Promise<{ threadId: string; jobId?: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const thread = snapshot.annotations.find((a) => a.id === threadId);
  if (!thread) throw new Error(`unknown comment ${threadId}`);
  if (!thread.error) throw new Error(`thread ${threadId} has no failed reply to retry`);

  if (thread.type === "expansion") {
    const { runExplainFill } = await import("./explain.js");
    const res = await runExplainFill(ctx, threadId, thread.anchor, thread.anchor.quotedText, { skipDedupe: true });
    return { threadId, ...res };
  }
  const res = await runAskFill(ctx, threadId, thread.anchor, { skipDedupe: true });
  return { threadId, ...res };
}

/** Cancel the ask job (used by close/delete). */
export function cancelAskJob(ctx: ActionContext, threadId: string): void {
  const snapshot = ctx.reviews.getSnapshot(ctx.reviewId);
  const found = snapshot?.annotations.find((a) => a.id === threadId);
  cancelAnnotationJob(ctx.jobs, ctx.reviewId, found?.jobId);
}
