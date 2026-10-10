/**
 * Guide column (`/review/:id` left pane). Owner: web-guide agent.
 *
 * Loads the snapshot through the unified `api` client (in-memory `mockApi`
 * under `VITE_MOCK=1`, the real service otherwise; WS patches converge it).
 * In-app navigation keeps the page id in the URL with browser back/forward
 * working: the root lives at `/review/:id`, other pages at
 * `/review/:id/page/:pageId` (the route is `/review/:id/*`; see `App.tsx`).
 * Listens for `unvibe:guide-block` (`{ cardId, blockId }` in `detail`,
 * sent by "Restated →" links in the description tab): opens the block's
 * page, expands its card, scrolls and highlights it.
 */
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useReview } from "../state/store.js";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";
import { GUIDE_BLOCK_EVENT, performAction, scrollToBlock, type GuideBlockRequest } from "./actions.js";
import { PageView } from "./PageView.js";
import "./guide-m2.css";

function pageIdFromSplat(splat: string | undefined): string | null {
  if (!splat) return null;
  const m = splat.match(/^page\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function GuidePage({ reviewId }: { reviewId: string }) {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const splat = useParams()["*"];
  const navigate = useNavigate();
  const location = useLocation();
  const versionParam = useReviewVersion();

  useEffect(() => {
    let cancelled = false;
    api
      .review(reviewId, versionParam)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap);
      })
      .catch(() => {
        // Unreachable reviews keep the loading state; the shell shows it.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, versionParam, setSnapshot]);

  const pageId = pageIdFromSplat(splat);

  const onOpenPage = useCallback(
    (next: string | null) => {
      navigate(next === null ? `/review/${reviewId}` : `/review/${reviewId}/page/${encodeURIComponent(next)}`);
    },
    [navigate, reviewId],
  );

  const onJumpToCard = useCallback(
    (cardId: string) => {
      // Contents jumps expand the card when needed (PRD §4.3).
      const snap = useReview.getState().snapshot;
      const card = snap?.pages.flatMap((p) => p.cards).find((c) => c.id === cardId);
      if (card?.collapsed) {
        void performAction(reviewId, { kind: "collapse", cardId, collapsed: false });
      }
      window.setTimeout(() => {
        const el = document.getElementById(`C-${cardId}`);
        if (!el) return;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
      }, card?.collapsed ? 80 : 0);
    },
    [reviewId],
  );

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const { cardId, blockId } = (e as CustomEvent<GuideBlockRequest>).detail;
      scrollToBlock(onOpenPage, pageId ?? "root", cardId, blockId);
    };
    window.addEventListener(GUIDE_BLOCK_EVENT, onRequest);
    return () => window.removeEventListener(GUIDE_BLOCK_EVENT, onRequest);
  }, [onOpenPage, pageId]);

  // Card deep links (`/review/:id#C-<cardId>`, e.g. from Settings → Shared
  // context → Open card): the snapshot loads async, so poll briefly for the
  // card element instead of relying on the browser's initial-hash scroll.
  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!snapshot || !/^C-/.test(hash)) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView({ block: "start" });
        window.clearInterval(timer);
      } else if (++tries > 20) {
        window.clearInterval(timer);
      }
    }, 150);
    return () => window.clearInterval(timer);
  }, [snapshot, location.hash]);

  const pages = snapshot?.pages;
  const lookupPage = useCallback(
    (id: string) => pages?.find((p) => p.id === id),
    [pages],
  );

  if (!snapshot || !pages) {
    return (
      <div className="doc">
        <div className="eyebrow">Guided review</div>
        <h1 className="title">Review {reviewId}</h1>
        <p className="hint">Loading the guide…</p>
      </div>
    );
  }

  const current = pageId === null ? pages.find((p) => p.kind === "root") ?? pages[0] : lookupPage(pageId);
  // The switcher lives above every branch: pipeline-less reviews have no
  // pages yet ("Page not found"), but their versions still switch.
  if (!current) {
    return (
      <>
        <VersionSwitcher />
        <div className="doc">
          <div className="eyebrow">Guided review</div>
          <h1 className="title">Page not found</h1>
          <p className="hint">
            There is no page <code>{pageId}</code> in this review.{" "}
            <button type="button" className="x" onClick={() => onOpenPage(null)}>
              Back to the guided review
            </button>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <VersionSwitcher />
      <PageView
        reviewId={reviewId}
        page={current}
        lookupPage={lookupPage}
        onOpenPage={onOpenPage}
        onJumpToCard={onJumpToCard}
      />
    </>
  );
}
