/**
 * `undo` action (PRD §4.4): revert the card's last change (depth,
 * examples or diagram). No redo, no history trail. Comments and
 * expansions attached to the card survive undo (annotations live outside
 * cards, re-attached to their blocks by id).
 */
import { applyUndo, findCardTargetInDraft, markStaleAnchors, recordInteraction } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function undoAction(
  ctx: ActionContext,
  cardId: string,
): Promise<{ cardId: string; undone: boolean }> {
  const { reviews, reviewId } = ctx;
  getSnapshotOrThrow(reviews, reviewId);
  let undone = false;
  await reviews.mutate(reviewId, (draft) => {
    const t = findCardTargetInDraft(draft, cardId);
    if (!t) throw new Error(`unknown card ${cardId}`);
    undone = applyUndo(t);
    if (undone) markStaleAnchors(draft, cardId);
  });
  // Undo is UI state (PRD §9.3): accepted, never logged.
  if (undone) await recordInteraction({ kind: "undo", reviewId, cardId, text: `Undid last change on ${cardId}` });
  return { cardId, undone };
}
