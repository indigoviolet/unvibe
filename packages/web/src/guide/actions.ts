/**
 * Card actions (web-guide owner): everything goes through the unified `api`
 * client (in-memory `mockApi` under `VITE_MOCK=1`, the real service
 * otherwise) as `POST /api/reviews/:id/actions`.
 *
 * Read / collapse / bookmark update the snapshot optimistically so the UI
 * responds instantly; a failed request resyncs from the service and toasts.
 * Depth / examples / diagram / undo / generate are service-driven (jobs +
 * WS patches); in mock mode the stub answers `accepted: false` and the UI
 * toasts that generation needs the service.
 */
import type { ActionResponse, ReviewAction, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";

function optimistic(fn: (snap: ReviewSnapshot) => ReviewSnapshot): void {
  const { snapshot, setSnapshot } = useReview.getState();
  if (snapshot) setSnapshot(fn(snapshot));
}

export const GUIDE_BLOCK_EVENT = "unvibe:guide-block";

export interface GuideBlockRequest {
  cardId: string;
  blockId: string;
}

/** Ask the guide to show a block (used by "Restated →" links and card links). */
export function requestGuideBlock(cardId: string, blockId: string): void {
  window.dispatchEvent(
    new CustomEvent<GuideBlockRequest>(GUIDE_BLOCK_EVENT, { detail: { cardId, blockId } }),
  );
}

async function resync(reviewId: string): Promise<void> {
  try {
    useReview.getState().setSnapshot(await api.review(reviewId));
  } catch {
    // Stay on the optimistic state when the resync itself fails.
  }
}

/**
 * Scroll to a guide block: opens the block's page when needed, expands a
 * collapsed card, then scrolls and flashes the block.
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
  if (page.id !== currentPageId) navigate(page.id === "root" ? null : page.id);
  // Let the page render before scrolling when we just navigated.
  window.setTimeout(go, page.id !== currentPageId ? 80 : 0);
}

function notAvailable(res: ActionResponse): boolean {
  if (!res.accepted) {
    toast("Needs the service: generation runs in a later milestone.");
    return true;
  }
  return false;
}

export async function performAction(
  reviewId: string,
  action: ReviewAction,
): Promise<ActionResponse> {
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
    optimistic((snap) => ({
      ...snap,
      pages: snap.pages.map((p) => (p.id === action.pageId ? { ...p, saved: action.saved } : p)),
    }));
  }
  let res: ActionResponse;
  try {
    res = await api.action(reviewId, action);
  } catch (err) {
    toast(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    await resync(reviewId);
    return { accepted: false };
  }
  if (
    (action.kind === "read" || action.kind === "collapse" || action.kind === "bookmark") &&
    !res.accepted
  ) {
    // Instant UI state (mock) or service rejection: converge on the server.
    await resync(reviewId);
    return res;
  }
  if (notAvailable(res)) return res;
  return res;
}

/**
 * Follow-up chip click (PRD §4.3 "Go deeper"): asks the agent anchored on
 * the follow-up's block.
 */
export function performFollowUp(
  reviewId: string,
  cardId: string,
  blockId: string,
  index: number,
): void {
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

/** Stale-card Update button (PRD §8): runs the service update pass. */
export function performUpdate(reviewId: string): void {
  api.update(reviewId).catch((err: unknown) => {
    toast(`Update failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}
