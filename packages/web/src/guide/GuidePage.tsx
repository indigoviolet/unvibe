/**
 * Guide column (`/review/:id` left pane). Owner: web-guide agent.
 *
 * Loads the snapshot through the unified `api` client (in-memory `mockApi`
 * under `VITE_MOCK=1`, the real service otherwise; WS patches converge it).
 * In-app navigation keeps the page id in the URL with browser back/forward
 * working: the root lives at `/review/:id`, other pages at
 * `/review/:id/page/:pageId` (the route is `/review/:id/*`; see `App.tsx`).
 * Listens for `unvibe:guide-block` (`{ cardId, blockId }` in `detail`,
 * sent by card links): opens the block's
 * page, expands its card, scrolls and highlights it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { isDocumentReview } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { ErrorBoundary, InlineFallback } from "../components/ErrorBoundary.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";
import { GUIDE_BLOCK_EVENT, performAction, scrollToBlock, type GuideBlockRequest } from "./actions.js";
import { emptyGuideState } from "./guideUtils.js";
import { DocumentView } from "./DocumentView.js";
import { PageView } from "./PageView.js";
import { Button, PaneLoading } from "../ui/index.js";
import "./guide-m2.css";

function pageIdFromSplat(splat: string | undefined): string | null {
  if (!splat) return null;
  const m = splat.match(/^page\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * Page key from the address bar. History updates the URL synchronously on
 * navigation while the committed render lags behind under transitions
 * (`v7_startTransition` / v7 wrap the router state update in
 * `startTransition`), so a scroll that fires after leaving started — e.g.
 * the browser revealing the clicked link — must not overwrite the page
 * being left (#248). Returns "" off review routes so it never matches.
 */
function addressBarPageKey(reviewId: string): string {
  const prefix = `/review/${reviewId}`;
  const { pathname } = window.location;
  if (pathname === prefix || pathname === `${prefix}/`) return "root";
  if (!pathname.startsWith(`${prefix}/`)) return "";
  return pageIdFromSplat(pathname.slice(prefix.length + 1)) ?? "root";
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
  const pageKey = pageId ?? "root";
  // Guide error-state retry (issue #86, finding 14): re-enqueue the
  // unfinished pipeline stages, then converge on the fresh snapshot.
  const [retrying, setRetrying] = useState(false);
  const retryGuide = (): void => {
    setRetrying(true);
    api
      .resume(reviewId)
      .then(() => api.review(reviewId))
      .then((snap) => setSnapshot(snap))
      .catch((err: unknown) => {
        toast(`Couldn't retry the guide: ${friendlyError(err)}`);
      })
      .finally(() => setRetrying(false));
  };

  // Reader state (M4): per-page scroll position restored on back/forward.
  // Saved continuously on scroll and synchronously when leaving a page;
  // restored once the new page has laid out. The page never scrolls on its
  // own while the user reads (no scroll on patches — only here, on navigation).
  const scrollPos = useRef(new Map<string, number>());
  // The page being rendered now. Leaving a page swaps its content before the
  // old listener is removed, and the browser's clamp to the new content can
  // fire one last scroll event; it must not overwrite the old page's position.
  const currentPageKey = useRef(pageKey);
  currentPageKey.current = pageKey;
  // The page whose scroll events are noise right now: the page being left
  // (from navigation start until the next page commits) and the page being
  // entered (until its restore has applied). A page-switch clamp to 0 must
  // not overwrite the saved position on either side (#266).
  const quietKey = useRef<string | null>(null);
  useEffect(() => {
    const el = document.getElementById("page");
    if (!el) return;
    const onScroll = (): void => {
      if (quietKey.current === pageKey) return;
      if (currentPageKey.current !== pageKey) return;
      // The address bar leads the committed render under transitions: once
      // it shows another page, this page is being left — ignore the scroll.
      if (addressBarPageKey(reviewId) !== pageKey) return;
      scrollPos.current.set(pageKey, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pageKey, reviewId]);
  useEffect(() => {
    const el = document.getElementById("page");
    if (!el) return;
    // This page committed: its own scroll events count again (the leaving
    // page's clamp, if still queued, is refused by the guards above).
    quietKey.current = pageKey;
    const saved = scrollPos.current.get(pageKey) ?? 0;
    let frames = 0;
    let raf = 0;
    const apply = (): void => {
      // A navigation since this effect ran — or a still-lagging commit
      // whose URL already shows another page — must not write here (#266).
      if (currentPageKey.current !== pageKey) return;
      if (addressBarPageKey(reviewId) !== pageKey) return;
      // Wait until the content can hold the offset: under a slow frame
      // budget the first layout may be short (fonts, highlight) and an
      // early write clamps to 0 and stays there. Bounded: a page that
      // shrank still restores to its (clamped) top. A zero offset needs
      // no wait.
      if (saved > 0 && el.scrollHeight < saved + el.clientHeight && frames < 30) {
        frames += 1;
        raf = window.requestAnimationFrame(apply);
        return;
      }
      el.scrollTop = saved;
      quietKey.current = null;
    };
    raf = window.requestAnimationFrame(apply);
    return () => window.cancelAnimationFrame(raf);
  }, [pageKey, reviewId]);

  const onOpenPage = useCallback(
    (next: string | null) => {
      // Capture the position being left synchronously: the scroll event for
      // it may not have been dispatched yet (fast click, throttled frame),
      // and events after navigation starts are ignored by the guards above.
      // Mark it quiet so the page-switch clamp can't overwrite it (#266).
      const leaving = currentPageKey.current;
      if ((next ?? "root") !== leaving) {
        const el = document.getElementById("page");
        if (el) scrollPos.current.set(leaving, el.scrollTop);
        quietKey.current = leaving;
      }
      navigate(next === null ? `/review/${reviewId}` : `/review/${reviewId}/page/${encodeURIComponent(next)}`);
    },
    [navigate, reviewId],
  );

  // Browser back/forward: `popstate` fires after the URL changes but before
  // the transition commits, so capture the position being left here too.
  // `navigate()` (above) uses `pushState`, which never fires `popstate`.
  useEffect(() => {
    const onPopState = (): void => {
      const next = addressBarPageKey(reviewId);
      if (!next || next === currentPageKey.current) return;
      const el = document.getElementById("page");
      if (el) scrollPos.current.set(currentPageKey.current, el.scrollTop);
      quietKey.current = currentPageKey.current;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [reviewId]);

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

  // Card deep links (`/review/:id#C-<cardId>`): the snapshot loads async,
  // so poll briefly for the card element instead of relying on the
  // browser's initial-hash scroll.
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
      <div className="doc pane-loading-pad">
        <PaneLoading label="Building the guide" />
      </div>
    );
  }

  // #92: async open — loading shows the shared preparing state; failed shows the error + Retry.
  // The PR title/number/author rode the create request (TopBar shows them
  // from the summary); the loading state itself carries no step label (#232).
  const ingestStatus = snapshot.ingest.status;
  if (ingestStatus === "loading") {
    return (
      <div className="doc pane-loading-pad" data-testid="review-loading">
        <PaneLoading label="Building the guide" />
      </div>
    );
  }
  if (ingestStatus === "failed") {
    const error = snapshot.ingest?.error ?? "could not open the review";
    const pr = snapshot.review.prNumber !== undefined ? `PR #${snapshot.review.prNumber}` : snapshot.review.branch;
    return <FailedOpen reviewId={reviewId} prLabel={pr} error={error} />;
  }
  if (ingestStatus === "empty") {
    const error = snapshot.ingest?.error ?? "No changes to review: the diff is empty.";
    const pr = snapshot.review.prNumber !== undefined ? `PR #${snapshot.review.prNumber}` : snapshot.review.branch;
    return <EmptyOpen reviewId={reviewId} prLabel={pr} error={error} />;
  }

  // Issue #222: a document review's left pane is the document itself.
  if (isDocumentReview(snapshot)) {
    return <DocumentView reviewId={reviewId} onOpenPage={onOpenPage} />;
  }

  // #179: a version whose diff is empty (e.g. a refresh emptied it) says
  // so here instead of the stale guide or "No guide yet / diff is ready".
  // Gated on a real multi-version state so plain no-files fixtures and
  // pipeline-error snapshots keep their own states.
  const isEmptyVersion =
    snapshot.files.every((f) => f.hunks.length === 0 && !f.isBinary) &&
    (snapshot.versionStatus?.empty === true || snapshot.review.versions.length > 1 || snapshot.version.n > 1);
  if (isEmptyVersion) {
    return (
      <EmptyVersionGuide
        versionN={snapshot.version.n}
        versionCount={snapshot.review.versions.length}
        hasGuide={pages.some((p) => p.cards.length > 0)}
      />
    );
  }

  const current = pageId === null ? pages.find((p) => p.kind === "root") ?? pages[0] : lookupPage(pageId);
  // Reviews whose guide is not built yet have no pages; the version
  // selector lives in the review bar, so it still switches here.
  if (!current && pageId === null) {
    const empty = emptyGuideState(snapshot.pipeline, snapshot.jobs ?? []);
    // #232: while the guide builds, both panes share one modest loading
    // state (indicator + short label) — no title-size heading, no stage
    // label, no commentary sentences.
    if (empty.kind === "building") {
      return (
        <div className="doc pane-loading-pad" data-testid="guide-empty" data-state="building">
          <PaneLoading label="Building the guide" />
        </div>
      );
    }
    return (
      <>
        <div className="doc" data-testid="guide-empty" data-state={empty.kind}>
          {empty.kind === "error" ? (
            <>
              <h1 className="title">Couldn't build the guide</h1>
              <p className="hint">{empty.detail}</p>
              <p>
                <Button variant="primary" type="button" disabled={retrying} onClick={retryGuide}>
                  {retrying ? "Retrying…" : "Retry"}
                </Button>
              </p>
            </>
          ) : (
            <>
              <h1 className="title">No guide yet</h1>
              <p className="hint">The guide hasn't been started for this review. The diff is ready to read.</p>
            </>
          )}
        </div>
      </>
    );
  }
  if (!current) {
    return (
      <>
        <div className="doc">
          <h1 className="title">Page not found</h1>
          <p className="hint">
            There is no page <code>{pageId}</code> in this review.{" "}
            <button type="button" className="x" onClick={() => onOpenPage(null)}>
              Back to the guide
            </button>
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <ErrorBoundary
        name="guide-page"
        resetKey={`${reviewId}:${pageKey}`}
        fallback={({ reset }) => (
          <div className="doc">
            <InlineFallback message="Couldn't show the guide: something went wrong" onRetry={reset} />
          </div>
        )}
      >
        <PageView
          reviewId={reviewId}
          page={current}
          lookupPage={lookupPage}
          onOpenPage={onOpenPage}
          onJumpToCard={onJumpToCard}
        />
      </ErrorBoundary>
    </>
  );
}

/** #179: the viewed version's diff is empty (a refresh emptied it). */
export function EmptyVersionGuide({
  versionN,
  versionCount,
  hasGuide,
}: {
  versionN: number;
  versionCount: number;
  hasGuide: boolean;
}) {
  return (
    <div className="doc" data-testid="guide-empty-version">
      <h1 className="title">No changes to review</h1>
      <p className="hint" data-testid="guide-empty-version-message">
        This version&apos;s diff is empty — the branch is the same as its base, so there is nothing to read in v{versionN}.
      </p>
      {versionCount > 1 ? (
        <p className="hint">
          Earlier versions are still available in the version picker above
          {hasGuide ? " — pick one to read its guide and diff" : " — pick one to read its diff"}.
        </p>
      ) : null}
    </div>
  );
}

/** #179: empty diff — nothing to review, with Retry / Remove like #92. */
export function EmptyOpen({ reviewId, prLabel, error }: { reviewId: string; prLabel: string; error: string }) {
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const onRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const snap = await api.retryReview(reviewId);
      setSnapshot(snap);
    } catch (err) {
      setRetryError(friendlyError(err));
    } finally {
      setRetrying(false);
    }
  }, [reviewId, setSnapshot]);
  // The heading already says "No changes to review"; the body explains why.
  const reason = error.replace(/^No changes to review:\s*/i, "");
  const body = reason.charAt(0).toUpperCase() + reason.slice(1);
  return (
    <div className="doc" data-testid="review-empty">
      <h1 className="title">No changes to review</h1>
      <p className="hint" data-testid="review-empty-message">
        {body}
      </p>
      <p className="hint">{prLabel} has no diff to read, so no guide was started.</p>
      <div className="frow" style={{ gap: 8 }}>
        <Button variant="primary" type="button" disabled={retrying} onClick={() => void onRetry()}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
      {retryError ? (
        <p className="hint" role="alert">
          Couldn&apos;t retry: {retryError}
        </p>
      ) : null}
      <p className="hint">You can remove it from Reviews on the start page.</p>
    </div>
  );
}

/** #92: failed open — the error plus Retry (removing happens in Reviews). */
export function FailedOpen({ reviewId, prLabel, error }: { reviewId: string; prLabel: string; error: string }) {
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const onRetry = useCallback(async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const snap = await api.retryReview(reviewId);
      setSnapshot(snap);
    } catch (err) {
      setRetryError(friendlyError(err));
    } finally {
      setRetrying(false);
    }
  }, [reviewId, setSnapshot]);
  return (
    <div className="doc" data-testid="review-failed">
      <h1 className="title">Couldn&apos;t open {prLabel}</h1>
      <p className="hint" data-testid="review-failed-error">
        {error}
      </p>
      <div className="frow" style={{ gap: 8 }}>
        <Button variant="primary" type="button" disabled={retrying} onClick={() => void onRetry()}>
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      </div>
      {retryError ? (
        <p className="hint" role="alert">
          Couldn&apos;t retry: {retryError}
        </p>
      ) : null}
      <p className="hint">You can remove it from Reviews on the start page.</p>
    </div>
  );
}
