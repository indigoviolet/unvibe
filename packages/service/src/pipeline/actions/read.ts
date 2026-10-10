/**
 * `read` / `collapse` / `bookmark` actions (PRD §4.4, §4.3).
 *
 * - `read` greys and collapses; unmarking expands. Marking an expansion
 *   read closes it (PRD §4.7).
 * - `collapse` toggles the collapsed flag (collapsed cards show only the
 *   title row, or the first line when untitled).
 * - `bookmark` flips the page saved flag.
 *
 * UI state only: never enters the log (PRD §9.3). `cardId` may be a page
 * card id or an expansion annotation id.
 */
import { findCardTargetInDraft, recordInteraction } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function readAction(
  ctx: ActionContext,
  cardId: string,
  read: boolean,
): Promise<{ cardId: string }> {
  const { reviews, reviewId } = ctx;
  getSnapshotOrThrow(reviews, reviewId);
  await reviews.mutate(reviewId, (draft) => {
    const t = findCardTargetInDraft(draft, cardId);
    if (!t) throw new Error(`unknown card ${cardId}`);
    if (t.kind === "page-card") {
      t.card.read = read;
      // Greys and collapses; unmarking expands it.
      t.card.collapsed = read ? true : false;
    } else {
      t.annotation.expansion!.read = read;
      if (read) {
        // Marking an expansion read closes it the same way Close does.
        t.annotation.expansion!.collapsed = true;
        t.annotation.open = false;
        t.annotation.working = null;
        t.annotation.expansion!.working = null;
      } else {
        t.annotation.expansion!.collapsed = false;
        t.annotation.open = true;
      }
    }
  });
  await recordInteraction({ kind: "read", reviewId, cardId, text: `Marked ${cardId} ${read ? "read" : "unread"}` });
  return { cardId };
}

export async function collapseAction(
  ctx: ActionContext,
  cardId: string,
  collapsed: boolean,
): Promise<{ cardId: string }> {
  const { reviews, reviewId } = ctx;
  getSnapshotOrThrow(reviews, reviewId);
  await reviews.mutate(reviewId, (draft) => {
    const t = findCardTargetInDraft(draft, cardId);
    if (!t) throw new Error(`unknown card ${cardId}`);
    if (t.kind === "page-card") {
      t.card.collapsed = collapsed;
    } else {
      t.annotation.expansion!.collapsed = collapsed;
    }
  });
  await recordInteraction({ kind: "collapse", reviewId, cardId, text: `${collapsed ? "Collapsed" : "Expanded"} ${cardId}` });
  return { cardId };
}

export async function bookmarkAction(
  ctx: ActionContext,
  pageId: string,
  saved: boolean,
): Promise<{ pageId: string }> {
  const { reviews, reviewId } = ctx;
  getSnapshotOrThrow(reviews, reviewId);
  await reviews.mutate(reviewId, (draft) => {
    const page = draft.pages.find((p) => p.id === pageId);
    if (!page) throw new Error(`unknown page ${pageId}`);
    page.saved = saved;
  });
  await recordInteraction({ kind: "bookmark", reviewId, pageId, text: `${saved ? "Saved" : "Unsaved"} page ${pageId}` });
  return { pageId };
}
