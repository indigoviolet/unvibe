/**
 * Card actions (web-guide owner): everything goes through the unified `api`
 * client (in-memory `mockApi` under `VITE_MOCK=1`, the real service
 * otherwise) as `POST /api/reviews/:id/actions`.
 *
 * Read / collapse / bookmark update the snapshot optimistically so the UI
 * responds instantly; a failed request resyncs from the service and toasts.
 * Every action that starts an agent session sets an in-flight entry
 * synchronously at click time (issue #46), hands it over to the snapshot
 * job once it appears, and clears it when the job settles, the request
 * fails, or the answer needs no job (`accepted: false`, `reused`, no
 * `jobId`). `deduplicated` answers follow the existing job.
 */
import type { ActionResponse, ReviewAction, ReviewSnapshot } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { INFLIGHT_TTL_MS, inflightExpired, useReview, type InFlightKind } from "../state/store.js";
import {
  askKey,
  conceptKey,
  explainKey,
  followupKey,
  updateKey,
} from "./inflight.js";

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

/** In-flight target for an action, or null when the kind is purely local. */
function targetForAction(action: ReviewAction): { targetId: string; kind: InFlightKind } | null {
  switch (action.kind) {
    case "depth":
    case "examples":
    case "diagram":
    case "generate":
    case "second_opinion":
      return { targetId: action.cardId, kind: action.kind };
    case "followup":
      return { targetId: followupKey(action.cardId, action.blockId, action.index), kind: "followup" };
    case "explain":
      return { targetId: explainKey(action.anchor), kind: "explain" };
    case "ask":
      return { targetId: askKey(action.anchor), kind: "ask" };
    case "reply":
      return { targetId: action.threadId, kind: "reply" };
    case "retry":
      return { targetId: action.threadId, kind: "retry" };
    case "concept":
      return { targetId: conceptKey(action.slug), kind: "concept" };
    default:
      // read, collapse, bookmark, note, promote, close, delete, undo:
      // purely local, no agent session.
      return null;
  }
}

/** Server id an anchor-keyed entry moves to once the response arrives. */
function serverIdFor(action: ReviewAction, res: ActionResponse): string | null {
  switch (action.kind) {
    case "explain":
      return res.annotationId ?? null;
    case "ask":
      return res.threadId ?? res.annotationId ?? null;
    case "followup":
      return res.annotationId ?? null;
    case "concept":
      return res.pageId ?? null;
    default:
      return null;
  }
}

/** Current revision of a page card or expansion (insert toast baseline). */
function currentRevision(cardId: string): number | undefined {
  const snap = useReview.getState().snapshot;
  for (const p of snap?.pages ?? []) {
    const card = p.cards.find((c) => c.id === cardId);
    if (card) return card.revision;
  }
  const ann = snap?.annotations.find((a) => a.id === cardId);
  if (ann?.type === "expansion" && ann.expansion) return ann.expansion.revision;
  return undefined;
}

/**
 * Resolve once an in-flight entry is gone (job settled and reaped, or an
 * explicit clear). Force-clears on timeout so waiters never hang; the
 * store's own TTL is the backstop for entries nobody waits on.
 */
function waitForInflightGone(targetId: string, timeoutMs: number): Promise<void> {
  if (!useReview.getState().inflight[targetId]) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let timer: number | undefined;
    const finish = (): void => {
      if (done) return;
      done = true;
      unsub();
      window.clearTimeout(timer);
      resolve();
    };
    // Same rule as the store TTL: only force-clear when no live job is
    // attached; a still-running job keeps the wait (and the indicator).
    const arm = (): void => {
      timer = window.setTimeout(() => {
        if (done) return;
        const st = useReview.getState();
        const entry = st.inflight[targetId];
        if (!entry) {
          finish();
          return;
        }
        if (!inflightExpired(entry, st.snapshot?.jobs ?? [], Date.now())) {
          arm();
          return;
        }
        st.clearInflight(targetId);
        finish();
      }, timeoutMs);
    };
    const unsub = useReview.subscribe((s) => {
      if (!s.inflight[targetId]) finish();
    });
    arm();
  });
}

export interface PerformOptions {
  /** False skips the failure toast (the caller toasts); still resyncs. */
  toast?: boolean;
}

export async function performAction(
  reviewId: string,
  action: ReviewAction,
  opts?: PerformOptions,
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
  // Set synchronously: `performAction` is called (not awaited) in click
  // handlers, so everything before the first await runs at click time.
  const target = targetForAction(action);
  const beforeRevision =
    target && (action.kind === "examples" || action.kind === "diagram")
      ? currentRevision(target.targetId)
      : undefined;
  if (target) useReview.getState().beginInflight(target.targetId, target.kind);
  // Generation guard: a newer click may re-begin the same key while this
  // request is in flight; only this generation's response may settle it.
  const mySeq = target ? useReview.getState().inflight[target.targetId]?.seq : undefined;
  const mine = (): boolean =>
    !target || useReview.getState().inflight[target.targetId]?.seq === mySeq;
  let res: ActionResponse;
  try {
    res = await api.action(reviewId, action);
  } catch (err) {
    if (target && mine()) useReview.getState().clearInflight(target.targetId);
    if (opts?.toast !== false) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no agent configured/i.test(msg)) {
        toast("No agent configured — set up Claude or Codex in Settings → Models to generate.");
      } else {
        toast(`Action failed: ${friendlyError(err)}`);
      }
    }
    await resync(reviewId);
    throw err;
  }
  if (target && mine()) {
    const st = useReview.getState();
    if (!res.accepted || res.reused || !res.jobId) {
      // No job to follow (mock instant state, stored result, undo): the
      // content is already patched or arrives with the next snapshot.
      st.clearInflight(target.targetId);
    } else {
      const serverId = serverIdFor(action, res);
      const finalId = serverId ?? target.targetId;
      if (serverId && serverId !== target.targetId) st.retargetInflight(target.targetId, serverId);
      st.attachInflightJob(finalId, res.jobId);
    }
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
  // Audit-10 (#10) reuse: the service returned the stored result with no job.
  // Tell the user when a repeat adds nothing (deepest + with principle
  // already, saturated examples/diagram); other reuses are silent since the
  // stored content is already visible.
  if (res.reused) {
    if (action.kind === "depth") {
      toast("Already at the deepest level — nothing more to add.");
    } else if (action.kind === "examples" || action.kind === "diagram") {
      toast("Nothing more to add to this card.");
    }
  }
  if (beforeRevision !== undefined && res.jobId && target) {
    // The fill is async: watch the entry until its job settles, then say
    // so when the revision never moved (replaces the old polling loop).
    const jobId = res.jobId;
    const cardId = target.targetId;
    void waitForInflightGone(cardId, INFLIGHT_TTL_MS).then(() => {
      const job = useReview.getState().snapshot?.jobs.find((j) => j.id === jobId);
      if (job?.state === "done" && currentRevision(cardId) === beforeRevision) {
        toast("Nothing more to add to this card.");
      }
    });
  }
  return res;
}

/**
 * Examples/diagrams insert blocks after the paragraphs they relate to and
 * never duplicate one already there (fire-and-forget; failures toast
 * through `performAction`).
 */
export function performInsertAction(
  reviewId: string,
  cardId: string,
  kind: "examples" | "diagram",
): void {
  void performAction(reviewId, { kind, cardId }).catch(() => {
    // performAction already toasted; the control stays so the user can retry.
  });
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
  const key = updateKey(reviewId);
  useReview.getState().beginInflight(key, "update");
  const mySeq = useReview.getState().inflight[key]?.seq;
  const mine = (): boolean => useReview.getState().inflight[key]?.seq === mySeq;
  api
    .update(reviewId)
    .then((res) => {
      if (!mine()) return;
      if (res.jobId) useReview.getState().attachInflightJob(key, res.jobId);
      else useReview.getState().clearInflight(key);
      // The update pass clears staleness when it lands; the entry follows
      // its job and the TTL is the backstop.
      void waitForInflightGone(key, INFLIGHT_TTL_MS);
    })
    .catch((err: unknown) => {
      if (mine()) useReview.getState().clearInflight(key);
      toast(`Update failed: ${friendlyError(err)}`);
    });
}
