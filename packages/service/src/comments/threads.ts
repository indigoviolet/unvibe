/**
 * Threads without nesting (issue #273, from #268 spike).
 *
 * Threads live as `Thread` records in the review snapshot (`packages/shared`
 * entities) — the only thing submitted to GitHub. Every change goes through
 * `ReviewStore.mutate` so subscribers get RFC 6902 patches.
 *
 * - `createThreadInDraft` / `createThread`: a reviewer thread anchored
 *   on a guide block, a description paragraph, or a diff line, with
 *   quoted text + prefix/suffix (PRD §7 Anchor). Comment-kind replies are
 *   in the Outbox by default.
 * - `createSuggestedCommentInDraft` / `createSuggestedComment`: agent
 *   findings' suggested comments — a thread on a diff line whose first
 *   reply is the agent's suggestion (`suggested: true`) and is NOT in the
 *   Outbox initially (PRD §4.9).
 * - `replyInDraft` / `replyToThread`: reviewer comment reply.
 * - `setOpenInDraft` / `setThreadOpen`, `setPostInDraft` / `setThreadPost`,
 *   `setDraftInDraft` / `updateThreadDraft`, `deleteInDraft` /
 *   `deleteAnnotation`: open/close, mark Outbox, edit the Outbox draft, delete.
 *
 * The `POST /api/reviews/:id/actions` union (`note`, `close`, `delete`)
 * overlaps this module. The actions route calls `createNoteThread`,
 * `closeAnnotation`, and `deleteAnnotation` below.
 */

import { randomBytes } from "node:crypto";
import type {
  ActionAnchor,
  Anchor,
  AnchorHost,
  Block,
  Reply,
  ReviewSnapshot,
  Thread,
} from "@unvibe/shared";
import type { WritableDraft } from "immer";
import { currentDescriptionHtml, descriptionParagraphText } from "../ingest/description.js";
import type { ReviewStore } from "../state/store.js";
import { commentHostText, findBlock } from "../interaction/l4.js";

export interface CreateThreadParams {
  anchor: ActionAnchor;
  quote: string;
  prefix?: string;
  suffix?: string;
  position?: number;
  /** Issue #166: selection offsets within the host's text, when selected. */
  startOffset?: number;
  /** Issue #166: end of the recorded selection (see `startOffset`). */
  endOffset?: number;
  /** Initial user text (first comment reply when present). */
  text?: string;
}

export interface CreateSuggestedParams {
  anchor: ActionAnchor;
  quote: string;
  prefix?: string;
  suffix?: string;
  position?: number;
  /** Agent suggestion text (required). */
  suggestionText: string;
}

/** New thread ids. Format `ann_<12 hex>` (app-assigned, PRD §7.2). */
export function newAnnotationId(): string {
  return `ann_${randomBytes(6).toString("hex")}`;
}

/** New reply ids. Format `ans_<12 hex>` (app-assigned, PRD §7.2). */
export function newReplyId(): string {
  return `ans_${randomBytes(6).toString("hex")}`;
}

function actionAnchorToHost(anchor: ActionAnchor): AnchorHost {
  switch (anchor.where) {
    case "block":
      return { kind: "block", blockId: anchor.blockId };
    case "description":
      return { kind: "description", paragraphId: anchor.paragraphId };
    case "diff-line": {
      const host: AnchorHost = { kind: "diff-line", fileKey: anchor.fileKey, line: anchor.line };
      const extra = anchor as { endLine?: number; side?: "LEFT" | "RIGHT" };
      if (extra.endLine !== undefined) {
        (host as { endLine?: number }).endLine = extra.endLine;
      }
      if (extra.side !== undefined) {
        (host as { side?: "LEFT" | "RIGHT" }).side = extra.side;
      }
      return host;
    }
    case "hunk":
      return { kind: "hunk", fileKey: anchor.fileKey, contentHash: anchor.contentHash };
    case "comment":
      return { kind: "comment", commentId: anchor.commentId };
    case "code": {
      const host: AnchorHost = { kind: "code", path: anchor.path, commit: anchor.commit, line: anchor.line };
      if (anchor.endLine !== undefined) {
        (host as { endLine?: number }).endLine = anchor.endLine;
      }
      return host;
    }
  }
}

/** Best-effort plain text of a guide block (for prefix/suffix matching). */
function blockText(block: unknown): string {
  const b = block as Record<string, unknown>;
  if (typeof b["text"] === "object" && b["text"] !== null) {
    const t = b["text"] as Record<string, unknown>;
    if (typeof t["standard"] === "string") return t["standard"] as string;
  }
  if (typeof b["code"] === "string") return b["code"] as string;
  if (typeof b["html"] === "string") return stripTags(b["html"] as string);
  if (typeof b["source"] === "string" && (b as { type?: string }).type === "diagram") {
    return b["source"] as string;
  }
  if (Array.isArray(b["items"])) {
    return (b["items"] as Array<Record<string, unknown>>)
      .map((it) => (typeof it["html"] === "string" ? stripTags(it["html"] as string) : ""))
      .join("\n");
  }
  if (Array.isArray(b["inner"])) return "";
  return "";
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function snapshotDescriptionParagraphText(snapshot: ReviewSnapshot, paragraphId: string): string | null {
  const html = currentDescriptionHtml(snapshot.description);
  if (!html) return null;
  return descriptionParagraphText(html, paragraphId);
}

function diffLineContext(
  snapshot: ReviewSnapshot,
  fileKey: string,
  line: number,
): { text: string; prev: string; next: string } | null {
  const file = (snapshot.files ?? []).find((f) => f.fileKey === fileKey);
  if (!file) return null;
  for (const hunk of file.hunks ?? []) {
    for (let i = 0; i < hunk.lines.length; i++) {
      const row = hunk.lines[i];
      const num = row.newLine ?? row.oldLine;
      if (num === line) {
        const prev = i > 0 ? (hunk.lines[i - 1].text ?? "") : "";
        const next = i + 1 < hunk.lines.length ? (hunk.lines[i + 1].text ?? "") : "";
        return { text: row.text ?? "", prev, next };
      }
    }
  }
  return null;
}

function contextAround(haystack: string, needle: string): { prefix: string; suffix: string } {
  const idx = needle ? haystack.indexOf(needle) : -1;
  if (needle === "" || idx < 0) return { prefix: "", suffix: "" };
  const WINDOW = 80;
  return {
    prefix: haystack.slice(Math.max(0, idx - WINDOW), idx),
    suffix: haystack.slice(idx + needle.length, idx + needle.length + WINDOW),
  };
}

/**
 * Build an `Anchor` for a new thread, validating the host exists in the
 * snapshot. `prefix`/`suffix` default to the text around the quote in the
 * host block/paragraph/line (PRD §8 anchor matching).
 */
export function buildAnchor(
  snapshot: ReviewSnapshot,
  anchor: ActionAnchor,
  quote: string,
  opts: { prefix?: string; suffix?: string; position?: number; startOffset?: number; endOffset?: number } = {},
): Anchor {
  const host = actionAnchorToHost(anchor);
  const version = snapshot.version?.n ?? snapshot.review?.currentVersion ?? 1;
  // Issue #166: the client's recorded selection offsets ride the anchor
  // when the anchor came from a live selection; both or neither (a half
  // offset places nothing). Absent everywhere else.
  const recorded =
    opts.startOffset !== undefined && opts.endOffset !== undefined
      ? { startOffset: opts.startOffset, endOffset: opts.endOffset }
      : {};
  if (host.kind === "block") {
    const found = findBlock(snapshot, host.blockId);
    if (!found) throw new Error(`unknown block ${host.blockId}`);
    // Issue #273: the `ans_…` host form is gone. Selections inside a
    // thread reply travel as threadId/sourceReplyId, never as a block
    // anchor — a nested thread is rejected so flat threads stay flat.
    if (found.cardId.startsWith("ans_")) {
      throw new Error("selections inside a thread reply need threadId, not a block anchor");
    }
    const ctx = contextAround(blockText(found.block), quote);
    return {
      // Stored as `<card>#<block>`: block ids repeat across cards (#78).
      host: { kind: "block", blockId: `${found.cardId}#${found.block.id}` },
      quotedText: quote,
      prefix: opts.prefix ?? ctx.prefix,
      suffix: opts.suffix ?? ctx.suffix,
      position: opts.position ?? 0,
      version,
      ...recorded,
    };
  }
  if (host.kind === "description") {
    const text = snapshotDescriptionParagraphText(snapshot, host.paragraphId);
    if (text === null) {
      // Paragraph ids come from the rendered description; unknown ids are
      // a client bug, but keep the message actionable.
      throw new Error(`unknown description paragraph ${host.paragraphId}`);
    }
    const ctx = contextAround(text, quote);
    return {
      host,
      quotedText: quote,
      prefix: opts.prefix ?? ctx.prefix,
      suffix: opts.suffix ?? ctx.suffix,
      position: opts.position ?? 0,
      version,
      ...recorded,
    };
  }
  if (host.kind === "comment") {
    // Issue #214: the host is that thread; its comment replies are the host text.
    const text = commentHostText(snapshot, host.commentId, quote);
    if (text === null) throw new Error(`unknown comment ${host.commentId}`);
    const ctx = contextAround(text, quote);
    return {
      host,
      quotedText: quote,
      prefix: opts.prefix ?? ctx.prefix,
      suffix: opts.suffix ?? ctx.suffix,
      position: opts.position ?? 0,
      version,
      ...recorded,
    };
  }
  if (host.kind === "code") {
    // #81: a file-tab anchor. The file lives outside the snapshot's diff
    // files, so there is nothing to look the quote up in here; the client
    // sends the quote (and any prefix/suffix it recorded). Lines are
    // 1-based; a range past the end is kept as cited.
    if (!host.path || host.path.includes("\0") || host.path.startsWith("/") || host.path.split(/[\\/]/).includes("..")) {
      throw new Error(`invalid code path ${host.path}`);
    }
    if (!host.commit || !/^[0-9a-fA-F]{4,64}$/.test(host.commit)) {
      throw new Error(`invalid code commit ${host.commit}`);
    }
    if (!Number.isSafeInteger(host.line) || host.line < 1) {
      throw new Error(`invalid code line ${String(host.line)}`);
    }
    if (host.endLine !== undefined) {
      if (!Number.isSafeInteger(host.endLine) || host.endLine < host.line) {
        throw new Error(`invalid code endLine ${String(host.endLine)}`);
      }
    }
    return {
      host,
      quotedText: quote,
      prefix: opts.prefix ?? "",
      suffix: opts.suffix ?? "",
      position: opts.position ?? host.line,
      version,
      ...recorded,
    };
  }
  // diff-line: the file must exist; the line should be a real new/old-side
  // number, but we accept any positive line (location computation falls
  // back to the nearest commentable line or the review body).
  const file = (snapshot.files ?? []).find((f) => f.fileKey === host.fileKey);
  if (!file) throw new Error(`unknown file ${host.fileKey}`);
  if (host.kind === "hunk") {
    // Issue #138: the hunk must exist; the summary text lives in
    // hunkStates, read by the hunk-thread creation (not stored here).
    const hunk = file.hunks.find((h) => h.contentHash === host.contentHash);
    if (!hunk) throw new Error(`unknown hunk ${host.fileKey}:${host.contentHash}`);
    return {
      host,
      quotedText: quote,
      prefix: opts.prefix ?? "",
      suffix: opts.suffix ?? "",
      position: opts.position ?? 0,
      version,
      ...recorded,
    };
  }
  if (!Number.isSafeInteger(host.line) || host.line < 1) {
    throw new Error(`invalid diff line ${String(host.line)}`);
  }
  if (host.endLine !== undefined) {
    if (!Number.isSafeInteger(host.endLine) || host.endLine < host.line) {
      throw new Error(`invalid diff endLine ${String(host.endLine)}`);
    }
  }
  const ctx = diffLineContext(snapshot, host.fileKey, host.line);
  return {
    host,
    quotedText: quote,
    prefix: opts.prefix ?? (ctx?.prev ?? ""),
    suffix: opts.suffix ?? (ctx?.next ?? ""),
    position: opts.position ?? host.line,
    version,
    ...recorded,
  };
}

/** One comment reply carrying plain reviewer text. */
export function commentReply(text: string, opts?: { who?: "you" | "agent"; suggested?: boolean; suggestedQuestion?: boolean }): Reply {
  const who = opts?.who ?? "you";
  const html = escapeHtml(text).replace(/\n/g, "<br>");
  const block: Block = {
    type: "paragraph",
    id: "b1",
    text: { standard: html },
    citations: [],
  };
  return {
    id: newReplyId(),
    kind: "comment",
    who: who === "agent" ? "agent" : "you",
    question: null,
    blocks: [block],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...(opts?.suggested ? { suggested: true } : {}),
    ...(opts?.suggestedQuestion ? { suggestedQuestion: true } : {}),
  };
}

/** Draft helper: insert a thread; returns the new thread. */
export function createThreadInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  snapshot: ReviewSnapshot,
  params: CreateThreadParams,
): Thread {
  const quote = params.quote ?? "";
  const anchor = buildAnchor(
    snapshot,
    params.anchor,
    quote,
    {
      prefix: params.prefix,
      suffix: params.suffix,
      position: params.position,
      startOffset: params.startOffset,
      endOffset: params.endOffset,
    },
  );
  const replies: Reply[] = [];
  if (params.text !== undefined && params.text !== "") {
    replies.push(commentReply(params.text));
  }
  // Guide threads start closed; diff + description threads start open
  // (prototype `threadShown`: `t.file || t.desc ? !collapsed : open`).
  // A Comment is in the Outbox by default (issue #135).
  const open = anchor.host.kind === "block" ? false : true;
  const thread: Thread = {
    id: newAnnotationId(),
    type: "thread",
    anchor,
    replies,
    open,
    pinned: false,
    post: true,
    ...(replies.length === 0 ? { reply: "" } : {}),
  };
  draft.annotations.push(thread as Thread);
  return thread;
}

/** Draft helper: agent-suggested comment (PRD §4.9). */
export function createSuggestedCommentInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  snapshot: ReviewSnapshot,
  params: CreateSuggestedParams,
): Thread {
  if (params.anchor.where !== "diff-line") {
    throw new Error("suggested comments must anchor on a diff line");
  }
  if (!params.suggestionText || params.suggestionText.trim() === "") {
    throw new Error("suggestionText is required");
  }
  const anchor = buildAnchor(
    snapshot,
    params.anchor,
    params.quote ?? "",
    { prefix: params.prefix, suffix: params.suffix, position: params.position },
  );
  const thread: Thread = {
    id: newAnnotationId(),
    type: "thread",
    anchor,
    replies: [commentReply(params.suggestionText, { who: "agent", suggested: true })],
    open: true,
    pinned: false,
    post: false,
  };
  draft.annotations.push(thread as Thread);
  return thread;
}

function findThread(draft: WritableDraft<ReviewSnapshot>, commentId: string): Thread {
  const found = (draft.annotations as Thread[]).find((a) => a.id === commentId);
  if (!found) throw new Error(`unknown comment ${commentId}`);
  return found as WritableDraft<Thread> as unknown as Thread;
}

/** Draft helper: reviewer comment reply. */
export function replyInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  text: string,
): void {
  if (!text || text.trim() === "") throw new Error("reply text is required");
  const thread = findThread(draft, commentId);
  thread.replies.push(commentReply(text));
  thread.reply = "";
  thread.open = true;
}

/** Draft helper: open/close. */
export function setOpenInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  open: boolean,
): void {
  findThread(draft, commentId).open = open;
}

/** Draft helper: mark Outbox membership (stored `post`). */
export function setPostInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  post: boolean,
): void {
  const thread = findThread(draft, commentId);
  thread.post = post;
  if (post) thread.open = true;
}

/** Draft helper: edit the Outbox draft text (null clears it). */
export function setDraftInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  text: string | null | undefined,
): void {
  const thread = findThread(draft, commentId);
  if (text === null || text === undefined) {
    delete thread.draft;
  } else {
    thread.draft = text;
  }
}

/** Draft helper: unsent reply-box content (null clears it). */
export function setReplyBoxInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  text: string | null | undefined,
): void {
  const thread = findThread(draft, commentId);
  if (text === null || text === undefined) {
    delete thread.reply;
  } else {
    thread.reply = text;
  }
}

/** Draft helper: delete a thread. */
export function deleteInDraft(draft: WritableDraft<ReviewSnapshot>, commentId: string): void {
  const idx = (draft.annotations as Thread[]).findIndex((a) => a.id === commentId);
  if (idx < 0) throw new Error(`unknown comment ${commentId}`);
  // Owner decision (#161): the idle hunk summary is the collapsed state
  // of the hunk thread, so deleting a hunk thread removes the hunk's stored
  // summary too — the hunk is left with no summary, in the same draft
  // (one crash-safe mutate, logged like other deletes). Re-summarizing
  // can make a new one; the update pass only regenerates summaries for
  // hunks that changed.
  const host = (draft.annotations as Thread[])[idx].anchor.host;
  if (host.kind === "hunk") {
    const state = draft.hunkStates.find((s) => s.contentHash === host.contentHash);
    if (state) delete state.summary;
  }
  // Issue #181: dismissing a question suggestion resolves its
  // contribution item in the shared context, so agents do not raise it
  // again (re-raises dedupe against stored items, whatever their status).
  const link = (draft.annotations as Thread[])[idx].openQuestion;
  if (link) {
    const item = draft.contributions.find((c) => c.id === link.contributionId)?.items[link.itemIndex];
    if (item && item.kind === "open_question") item.status = "dismissed";
  }
  (draft.annotations as Thread[]).splice(idx, 1);
}

/**
 * Exact text that will be posted for a thread: the Outbox draft when set,
 * else the first reviewer reply, else the suggested reply (prototype
 * `Comments menu` draft fallback).
 */
export function threadPostText(thread: Thread): string {
  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const toText = (r: Reply): string => {
    const parts: string[] = [];
    for (const b of r.blocks ?? []) {
      if (b.type === "paragraph") {
        const s = b.text.standard.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        if (s) parts.push(s);
      } else if (b.type === "list") {
        for (const it of b.items ?? []) {
          const s = (it.html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          if (s) parts.push(s);
        }
      } else if (b.type === "code") {
        if (b.code.trim()) parts.push(b.code);
      }
    }
    return parts.join("\n\n");
  };
  const comments = (thread.replies ?? []).filter((r) => r.kind === "comment");
  const you = comments.find((r) => r.who === "you" && toText(r) !== "");
  if (you) return toText(you);
  const suggested = comments.find((r) => r.suggested && toText(r) !== "");
  if (suggested) return toText(suggested);
  const first = comments.find((r) => toText(r) !== "");
  return first ? toText(first) : "";
}

// --- Store wrappers (all through ReviewStore.mutate) ------------------------

async function mutateThread(
  store: ReviewStore,
  reviewId: string,
  fn: (draft: WritableDraft<ReviewSnapshot>, snapshot: ReviewSnapshot) => Thread | void,
): Promise<ReviewSnapshot> {
  const before = store.getSnapshot(reviewId);
  if (!before) throw new Error(`unknown review ${reviewId}`);
  const out = await store.mutate(reviewId, (draft) => {
    fn(draft, before);
  });
  return out.snapshot;
}

/** Create a Note or Ask-first-message thread. Returns the new thread id. */
export async function createThread(
  store: ReviewStore,
  reviewId: string,
  params: CreateThreadParams,
): Promise<{ id: string; snapshot: ReviewSnapshot }> {
  let id = "";
  const snapshot = await mutateThread(store, reviewId, (draft, before) => {
    id = createThreadInDraft(draft, before, params).id;
  });
  return { id, snapshot };
}

/**
 * Actions-route seam: `note` action without agent involvement.
 * Creates a comment reply (no agent reply); the conversation pipeline owns
 * everything that needs the agent.
 */
export async function createNoteThread(
  store: ReviewStore,
  reviewId: string,
  params: {
    anchor: ActionAnchor;
    quote: string;
    text?: string;
    prefix?: string;
    suffix?: string;
    startOffset?: number;
    endOffset?: number;
  },
): Promise<{ id: string; snapshot: ReviewSnapshot }> {
  return createThread(store, reviewId, { ...params });
}

/** Create an agent-suggested comment (critic pipeline seam). */
export async function createSuggestedComment(
  store: ReviewStore,
  reviewId: string,
  params: CreateSuggestedParams,
): Promise<{ id: string; snapshot: ReviewSnapshot }> {
  let id = "";
  const snapshot = await mutateThread(store, reviewId, (draft, before) => {
    id = createSuggestedCommentInDraft(draft, before, params).id;
  });
  return { id, snapshot };
}

/** Reviewer comment reply. */
export async function replyToThread(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
  text: string,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    replyInDraft(draft, commentId, text);
  });
}

/** Open/close a thread. Actions-route seam for `close` (pass `false`). */
export async function setThreadOpen(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
  open: boolean,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    setOpenInDraft(draft, commentId, open);
  });
}

/** Actions-route seam: `close` sets `open` to false. */
export async function closeAnnotation(
  store: ReviewStore,
  reviewId: string,
  annotationId: string,
): Promise<ReviewSnapshot> {
  return setThreadOpen(store, reviewId, annotationId, false);
}

/** Mark/unmark a thread's Outbox membership. */
export async function setThreadPost(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
  post: boolean,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    setPostInDraft(draft, commentId, post);
  });
}

/** Edit the Outbox draft text (null clears it). */
export async function updateThreadDraft(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
  text: string | null | undefined,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    setDraftInDraft(draft, commentId, text);
  });
}

/** Set the unsent reply-box content (null clears it). */
export async function updateReplyBox(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
  text: string | null | undefined,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    setReplyBoxInDraft(draft, commentId, text);
  });
}

/** Delete a thread. Actions-route seam for `delete`. */
export async function deleteAnnotation(
  store: ReviewStore,
  reviewId: string,
  commentId: string,
): Promise<ReviewSnapshot> {
  return mutateThread(store, reviewId, (draft) => {
    deleteInDraft(draft, commentId);
  });
}
