/**
 * `note` action (PRD §4.8): starts a comment with no agent reply.
 *
 * Delegates to `createNoteThread` (comments/threads.ts).
 */
import { createNoteThread } from "../../comments/threads.js";
import { getSnapshotOrThrow, normalizeBlockAnchor, type ActionContext } from "./common.js";
import type { ActionAnchor } from "@unvibe/shared";

export interface NoteRequest {
  quote: string;
  anchor: ActionAnchor;
  text?: string;
}

export async function noteAction(
  ctx: ActionContext,
  req: NoteRequest,
): Promise<{ annotationId: string }> {
  const { reviews, reviewId } = ctx;
  if (req.quote === undefined) throw new Error("quote is required");
  // Issue #138: a Comment on a summary attaches to the hunk's first
  // changed line and never activates the summary — the client maps the
  // hunk anchor to a diff-line anchor; a bare hunk anchor here is a bug.
  if (req.anchor.where === "hunk") {
    throw new Error("a comment on a hunk summary goes to the hunk's first changed line, not the hunk");
  }
  const before = getSnapshotOrThrow(reviews, reviewId);
  // Notes start no agent reply and settle on close (one line via
  // `maybeSettleThread`): nothing enters the log at creation.
  const { id } = await createNoteThread(reviews, reviewId, {
    anchor: normalizeBlockAnchor(before, req.anchor),
    quote: req.quote,
    ...(req.text !== undefined ? { text: req.text } : {}),
  });
  return { annotationId: id };
}
