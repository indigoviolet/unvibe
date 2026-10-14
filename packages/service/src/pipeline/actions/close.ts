/**
 * `close` / `delete` actions (PRD §4.7, §4.8).
 *
 * - `close` on a conversation closes it (the anchor becomes a dotted
 *   link; hover previews, click expands in place). On a comment it closes
 *   the comment (guide: back to its marker; diff: comment icon on the line).
 * - `delete` removes the annotation entirely (and closes its session).
 * - Close only hides the card: a running fill job keeps going and fills
 *   its turn, and `working` stays set so a reopened card still shows it
 *   is working. Only `delete` cancels a running job (PRD §12); comments
 *   never carry jobs.
 */
import type { Annotation } from "@unvibe/shared";
import { deleteInDraft } from "../../comments/threads.js";
import { recordInteraction } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";
import { cancelConversationJob, holdsFillableTurns } from "./conversation.js";
import { deletionFor, wasShared } from "./events.js";

export async function closeAction(
  ctx: ActionContext,
  annotationId: string,
): Promise<{ annotationId: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === annotationId);
  if (!found) throw new Error(`unknown annotation ${annotationId}`);
  // Close only hides the card (owner request): the running job is NOT
  // cancelled and `working` is NOT cleared, so the turn still fills and
  // a reopened card shows the answer (and that it was working).

  await reviews.mutate(reviewId, (draft) => {
    const ann = (draft.annotations as unknown as Annotation[]).find((a) => a.id === annotationId);
    if (!ann) throw new Error(`unknown annotation ${annotationId}`);
    ann.open = false;
    // Closing keeps content for the dotted-link preview; a working job
    // that finishes later still fills the (closed) turn.
  });
  // Close is UI state (never logged). A closed comment or card settles
  // at once: one line in the log so other conversations see it (PRD §9.3).
  if (found.type === "comment") {
    await recordInteraction({ kind: "close", reviewId, annotationId, text: `Closed comment "${annotationId}"` });
  } else {
    await recordInteraction({ kind: "close", reviewId, annotationId, text: `Closed ${annotationId}` });
  }
  try {
    await ctx.sharedctx?.maybeSettleThread(reviewId, annotationId);
  } catch {
    // Settling is best-effort; the close itself already applied.
  }
  return { annotationId };
}

export async function deleteAction(
  ctx: ActionContext,
  targetId: string,
): Promise<{ targetId: string }> {
  const { reviews, reviewId } = ctx;
  const snapshot = getSnapshotOrThrow(reviews, reviewId);
  const found = snapshot.annotations.find((a) => a.id === targetId);
  if (!found) throw new Error(`unknown annotation ${targetId}`);
  if (holdsFillableTurns(found)) {
    cancelConversationJob(ctx, snapshot, targetId);
  }
  // The card's session belongs to the card: close it so it does not linger.
  const sessionId = found.sessionId;
  if (sessionId && ctx.sessions) {
    try {
      await ctx.sessions.closeConversation(sessionId);
    } catch {
      // best-effort
    }
  }

  await reviews.mutate(reviewId, (draft) => {
    // Shared with the comments route (issue #181 dismissal marking rides
    // along for question suggestions on every delete path).
    deleteInDraft(draft, targetId);
  });
  // A deleted item that had been shared leaves a one-line deletion entry
  // (PRD §9.3); unshared working states simply vanish.
  if (wasShared(found)) {
    await recordInteraction(deletionFor(reviewId, found));
  }
  return { targetId };
}
