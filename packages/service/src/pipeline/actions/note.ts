/**
 * `note` action (PRD §4.8): starts a thread with no agent reply.
 *
 * Delegates to `createNoteThread` (comments/threads.ts); the note_ack
 * template exists for a future contribution pass, but notes start no
 * agent reply today.
 */
import { createNoteThread } from "../../comments/threads.js";
import { recordInteraction } from "../../interaction/index.js";
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
): Promise<{ threadId: string }> {
  const { reviews, reviewId } = ctx;
  if (req.quote === undefined) throw new Error("quote is required");
  const before = getSnapshotOrThrow(reviews, reviewId);
  const { id } = await createNoteThread(reviews, reviewId, {
    anchor: normalizeBlockAnchor(before, req.anchor),
    quote: req.quote,
    ...(req.text !== undefined ? { text: req.text } : {}),
  });
  recordInteraction({ type: "note.created", reviewId, threadId: id });
  return { threadId: id };
}
