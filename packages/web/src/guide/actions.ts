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
import { api, friendlyError } from "../api/client.js";
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
    toast("That action needs the service — open this review against the real service to generate.");
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
            // Marking read greys + collapses; unmarking expands (PRD §4.4).
            return { ...c, read: action.read, collapsed: action.read ? true : false };
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
    const msg = err instanceof Error ? err.message : String(err);
    if (/no agent configured/i.test(msg)) {
      toast("No agent configured — set up Claude or Codex in Settings → Models to generate.");
    } else {
      toast(`Action failed: ${friendlyError(err)}`);
    }
    await resync(reviewId);
    throw err;
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
 * Follow-up chip click (PRD §4.3 "Go deeper"): clicking a suggestion adds
 * its answer (the `followup` action) and the suggestion disappears (the
 * service consumes the item when it creates the answer expansion).
 */
export function performFollowUp(
  reviewId: string,
  cardId: string,
  blockId: string,
  index: number,
): void {
  const snap = useReview.getState().snapshot;
  // Follow-ups may live on page cards or on expansion cards (cardId is an
  // annotation id for the latter); fall back to a global block search when
  // the addressed card does not carry the block (anchor drift).
  const allCards = [
    ...(snap?.pages.flatMap((p) => p.cards) ?? []),
    ...((snap?.annotations ?? [])
      .filter((a) => a.type === "expansion" && a.expansion)
      .map((a) => ({ id: a.id, blocks: a.expansion!.blocks })) as never[] as { id: string; blocks: { id: string; type: string }[] }[]),
  ];
  const card = allCards.find((c) => c.id === cardId) as
    | { blocks: { id: string; type: string; items?: { label: string }[] }[] }
    | undefined;
  let block = card?.blocks.find((b) => b.id === blockId);
  if (!block || block.type !== "follow-up") {
    // Global fallback: find the follow-up block anywhere by id.
    outer: for (const c of allCards) {
      for (const b of (c as { blocks: { id: string; type: string }[] }).blocks) {
        if (b.id === blockId && b.type === "follow-up") {
          block = b as never;
          break outer;
        }
      }
    }
  }
  if (!block || (block as { type: string }).type !== "follow-up") return;
  const items = (block as { items: { label: string }[] }).items;
  if (!items[index]) return;
  void performAction(reviewId, { kind: "followup", cardId, blockId, index }).catch(() => {
    // performAction already toasted; the chip stays so the user can retry.
  });
}

/** Stale-card Update button (PRD §8): runs the service update pass. */
export function performUpdate(reviewId: string): void {
  api.update(reviewId).catch((err: unknown) => {
    toast(`Update failed: ${friendlyError(err)}`);
  });
}
