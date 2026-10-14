/**
 * `collapse` / `bookmark` actions (PRD §4.4, §4.3).
 *
 * - `collapse` toggles the collapsed flag (collapsed cards show only the
 *   title row — the real title, else the shared fallback, issue #49).
 * - `bookmark` flips the page saved flag.
 *
 * UI state only: never enters the log (PRD §9.3). `cardId` may be a page
 * card id or a conversation card id.
 *
 * (Issue #136: the read state is removed as a feature — the `read`
 * control and its stored state are gone from all cards.)
 */
import { findCardTargetInDraft, recordInteraction } from "../../interaction/index.js";
import { getSnapshotOrThrow, type ActionContext } from "./common.js";

export async function collapseAction(
  ctx: ActionContext,
  cardId: string,
  collapsed: boolean,
): Promise<{ cardId: string }> {
  const { reviews, reviewId } = ctx;
  getSnapshotOrThrow(reviews, reviewId);
  await reviews.mutate(reviewId, (draft) => {
    const t = findCardTargetInDraft(draft, cardId);
    if (!t) {
      // A conversation card id addresses the card, not one answer.
      const ann = (draft.annotations as unknown as import("@unvibe/shared").Annotation[]).find(
        (a) => a.id === cardId,
      );
      if (!ann || ann.type !== "conversation") throw new Error(`unknown card ${cardId}`);
      ann.collapsed = collapsed;
      return;
    }
    if (t.kind === "page-card") {
      t.card.collapsed = collapsed;
    } else {
      // An answer id collapses its card (answers have no collapsed flag
      // of their own).
      t.annotation.collapsed = collapsed;
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
