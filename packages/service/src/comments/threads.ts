/**
 * Comments without the agent (M6, #136 slice 2).
 *
 * Comments live as `Annotation` records of type `"comment"` in the review
 * snapshot (`packages/shared` entities) — the only thing submitted to
 * GitHub. Every change goes through `ReviewStore.mutate` so subscribers
 * get RFC 6902 patches.
 *
 * - `createThreadInDraft` / `createThread`: a reviewer comment anchored
 *   on a guide block, a description paragraph, or a diff line, with
 *   quoted text + prefix/suffix (PRD §7 Anchor). Comments are for the PR
 *   by default.
 * - `createSuggestedCommentInDraft` / `createSuggestedComment`: agent
 *   findings' suggested comments — a comment on a diff line whose first
 *   message is flagged `suggested` and is NOT marked for the PR (PRD §4.9).
 * - `replyInDraft` / `replyToThread`: user reply.
 * - `setOpenInDraft` / `setThreadOpen`, `setPostInDraft` / `setThreadPost`,
 *   `setDraftInDraft` / `updateThreadDraft`, `deleteInDraft` /
 *   `deleteAnnotation`: open/close, mark for PR, edit For-PR draft, delete.
 *
 * The `POST /api/reviews/:id/actions` union (`note`, `close`, `delete`)
 * overlaps this module. The actions route (another agent) should call
 * `createNoteThread`, `closeAnnotation`, and `deleteAnnotation` below.
 */

import { randomBytes } from "node:crypto";
import type {
  ActionAnchor,
  Anchor,
  AnchorHost,
  Annotation,
  ChatMessage,
  ReviewSnapshot,
} from "@unvibe/shared";
import type { WritableDraft } from "immer";
import { currentDescriptionHtml, descriptionParagraphText } from "../ingest/description.js";
import type { ReviewStore } from "../state/store.js";
import { findBlock } from "../interaction/l4.js";

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
  /** Initial user text (first message when present). */
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
  // diff-line: the file must exist; the line should be a real new/old-side
  // number, but we accept any positive line (location computation falls
  // back to the nearest commentable line or the review body).
  const file = (snapshot.files ?? []).find((f) => f.fileKey === host.fileKey);
  if (!file) throw new Error(`unknown file ${host.fileKey}`);
  if (host.kind === "hunk") {
    // Issue #138: the hunk must exist; the summary text lives in
    // hunkStates, read by the hunk-card creation (not stored here).
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

/** Draft helper: insert a thread; returns the new annotation. */
export function createThreadInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  snapshot: ReviewSnapshot,
  params: CreateThreadParams,
): Annotation {
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
  const messages: ChatMessage[] = [];
  if (params.text !== undefined && params.text !== "") {
    messages.push({ who: "you", text: params.text });
  }
  // Guide comments start closed; diff + description comments start open
  // (prototype `threadShown`: `t.file || t.desc ? !collapsed : open`).
  // A Comment is for the PR by default (issue #135).
  const open = anchor.host.kind === "block" ? false : true;
  const thread: Annotation = {
    id: newAnnotationId(),
    type: "comment",
    anchor,
    open,
    pinned: false,
    messages,
    post: true,
    ...(messages.length === 0 ? { reply: "" } : {}),
  };
  draft.annotations.push(thread as Annotation);
  return thread;
}

/** Draft helper: agent-suggested comment (PRD §4.9). */
export function createSuggestedCommentInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  snapshot: ReviewSnapshot,
  params: CreateSuggestedParams,
): Annotation {
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
  const thread: Annotation = {
    id: newAnnotationId(),
    type: "comment",
    anchor,
    open: true,
    pinned: false,
    messages: [{ who: "ai", text: params.suggestionText, suggested: true }],
    post: false,
  };
  draft.annotations.push(thread as Annotation);
  return thread;
}

function findThread(draft: WritableDraft<ReviewSnapshot>, commentId: string): Annotation {
  const found = (draft.annotations as Annotation[]).find((a) => a.id === commentId);
  if (!found) throw new Error(`unknown comment ${commentId}`);
  if (found.type !== "comment") throw new Error(`annotation ${commentId} is not a comment`);
  return found as WritableDraft<Annotation> as unknown as Annotation;
}

/** Draft helper: user reply. */
export function replyInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  text: string,
): void {
  if (!text || text.trim() === "") throw new Error("reply text is required");
  const thread = findThread(draft, commentId);
  (thread.messages as ChatMessage[]).push({ who: "you", text });
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

/** Draft helper: mark for PR. */
export function setPostInDraft(
  draft: WritableDraft<ReviewSnapshot>,
  commentId: string,
  post: boolean,
): void {
  const thread = findThread(draft, commentId);
  thread.post = post;
  if (post) thread.open = true;
}

/** Draft helper: edit the For-PR draft text (null clears it). */
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
  const idx = (draft.annotations as Annotation[]).findIndex((a) => a.id === commentId);
  if (idx < 0) throw new Error(`unknown comment ${commentId}`);
  // Owner decision (#161): the idle hunk summary is the collapsed state
  // of the hunk card, so deleting a hunk card removes the hunk's stored
  // summary too — the hunk is left with no summary, in the same draft
  // (one crash-safe mutate, logged like other deletes). Re-summarizing
  // can make a new one; the update pass only regenerates summaries for
  // hunks that changed.
  const host = (draft.annotations as Annotation[])[idx].anchor.host;
  if (host.kind === "hunk") {
    const state = draft.hunkStates.find((s) => s.contentHash === host.contentHash);
    if (state) delete state.summary;
  }
  // Issue #181: dismissing a question suggestion resolves its
  // contribution item in the shared context, so agents do not raise it
  // again (re-raises dedupe against stored items, whatever their status).
  const link = (draft.annotations as Annotation[])[idx].openQuestion;
  if (link) {
    const item = draft.contributions.find((c) => c.id === link.contributionId)?.items[link.itemIndex];
    if (item && item.kind === "open_question") item.status = "dismissed";
  }
  (draft.annotations as Annotation[]).splice(idx, 1);
}

/**
 * Exact text that will be posted for a thread: the For-PR draft when set,
 * else the first user message, else the suggested message (prototype
 * `Comments menu` draft fallback).
 */
export function threadPostText(thread: Annotation): string {  if (thread.draft !== undefined && thread.draft !== "") return thread.draft;
  const you = thread.messages.find((m) => m.who === "you" && m.text);
  if (you?.text) return you.text;
  const suggested = thread.messages.find((m) => m.suggested && m.text);
  if (suggested?.text) return suggested.text;
  const first = thread.messages.find((m) => m.text);
  return first?.text ?? "";
}

// --- Store wrappers (all through ReviewStore.mutate) ------------------------

async function mutateThread(
  store: ReviewStore,
  reviewId: string,
  fn: (draft: WritableDraft<ReviewSnapshot>, snapshot: ReviewSnapshot) => Annotation | void,
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
 * Creates a comment (no agent reply); the conversation pipeline owns
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

/** User reply. */
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

/** Mark/unmark a thread For PR. */
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

/** Edit the For-PR draft text (null clears it). */
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


