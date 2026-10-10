/**
 * Card actions (M2, web-guide owner): mock mode runs `mockActions` locally,
 * real mode posts to `POST /api/reviews/:id/actions` and lets the service
 * drive jobs + state patches over the WS.
 *
 * Read / collapse / bookmark update the snapshot optimistically in both
 * modes so the UI responds instantly; jobs and patches converge afterwards.
 */
import type { ActionResponse, ReviewAction, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { applySavedState, mockAction, mockBookmark, mockFollowUp } from "../mock/mockActions.js";
import { isMockMode } from "../mock/loadGuideFixture.js";
import { useReview } from "../state/store.js";

function optimistic(fn: (snap: ReviewSnapshot) => ReviewSnapshot): void {
  const { snapshot, setSnapshot } = useReview.getState();
  if (snapshot) setSnapshot(fn(snapshot));
}

/**
 * Scroll to a guide block (used by "Restated →" links): navigates to the
 * block's page when needed, expands a collapsed card, then scrolls and
 * flashes the block.
 */
export function scrollToBlock(
  navigate: (pageId: string | null) => void,
  currentPageId: string,
  cardId: string,
  blockId: string,
): void {
  const snap = useReview.getState().snapshot;
  if (!snap) return;
  const page = snap.pages.find((p) => p.cards.some((c) => c.id === cardId));
  if (!page) return;
  const go = (): void => {
    optimistic((s) => ({
      ...s,
      pages: s.pages.map((p) => ({
        ...p,
        cards: p.cards.map((c) =>
          c.id === cardId && c.collapsed ? { ...c, collapsed: false } : c,
        ),
      })),
    }));
    window.setTimeout(() => {
      const el =
        document.getElementById(`B-${blockId}`) ?? document.getElementById(`C-${cardId}`);
      if (!el) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
      el.classList.add("hl");
      window.setTimeout(() => el.classList.remove("hl"), 2000);
    }, 60);
  };
  if (page.id !== currentPageId) navigate(page.id);
  // Let the page render before scrolling when we just navigated.
  window.setTimeout(go, page.id !== currentPageId ? 80 : 0);
}

export async function performAction(
  reviewId: string,
  action: ReviewAction,
): Promise<ActionResponse> {
  if (isMockMode()) return mockAction(reviewId, action);
  if (action.kind === "read" || action.kind === "collapse") {
    optimistic((snap) => ({
      ...snap,
      pages: snap.pages.map((p) => ({
        ...p,
        cards: p.cards.map((c) => {
          if (c.id !== action.cardId) return c;
          if (action.kind === "read")
            return { ...c, read: action.read, collapsed: action.read ? true : c.collapsed };
          return { ...c, collapsed: action.collapsed };
        }),
      })),
    }));
  }
  if (action.kind === "bookmark") {
    mockBookmark(reviewId, action.pageId, action.saved);
  }
  try {
    return await api.action(reviewId, action);
  } catch (err) {
    toast(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    return { accepted: false };
  }
}

/** Re-apply persisted bookmark state after a fresh snapshot load. */
export function reapplySavedState(reviewId: string): void {
  if (isMockMode()) applySavedState(reviewId);
}

/**
 * Follow-up chip click (PRD §4.3 "Go deeper"): mock mode appends the canned
 * answer; real mode asks the agent anchored on the follow-up's block.
 */
export function performFollowUp(
  reviewId: string,
  cardId: string,
  blockId: string,
  index: number,
): void {
  if (isMockMode()) {
    mockFollowUp(cardId, blockId, index);
    return;
  }
  const snap = useReview.getState().snapshot;
  const card = snap?.pages.flatMap((p) => p.cards).find((c) => c.id === cardId);
  const block = card?.blocks.find((b) => b.id === blockId);
  if (block?.type !== "follow-up") return;
  const item = block.items[index];
  if (!item) return;
  void performAction(reviewId, {
    kind: "ask",
    quote: item.label,
    anchor: { where: "block", blockId },
    message: item.ask ?? item.label,
  });
}
