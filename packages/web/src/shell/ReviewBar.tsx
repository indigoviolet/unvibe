/**
 * Review bar (issue #141): the only bar on a review, carrying everything
 * review-specific. Full width above both panes; stays in place when the
 * panes scroll.
 *
 * - Left: a home control back to the start page (first in focus order),
 *   then the review identity (`owner/name#N`, linking to GitHub for PR
 *   reviews, #94, new tab, #244: boxed with the shared Button styling
 *   like the Comments button) and the PR status icon when the PR has one
 *   (#234: none when open), the Refresh button next to the status icon
 *   (#241: same handler/check/banner as the diff toolbar owned, tooltip
 *   "Refresh", hidden for document reviews which never had it),
 *   the version selector next to it (issue #120; hidden for
 *   single-version reviews, the current version annotated in the
 *   dropdown, an older shown version flagged with a warning border),
 *   and Debug as an icon button (hidden until the review finishes
 *   opening, issue #92). #235: no PR title here (it lives as the guide
 *   heading), no open-externally button (the GitHub link opens the PR),
 *   no preview/full-access badges (front page only). No Settings gear:
 *   Settings is reached from the start page. #239: home, GitHub link,
 *   status icon and Debug line up on the bottom.
 * - Middle: the `[ Guide | Source ]` pane selector. Each segment toggles
 *   its pane (issue #83); `#toggleRight` stays on the Source segment.
 * - Right: Comments and Submit side by side, Submit as the primary button,
 *   plus the live job count (running · queued, issue #98) once the review
 *   is open and at least one job is live — a link to the Debug jobs list.
 */
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { isDocumentReview } from "@unvibe/shared";
import { CommentsMenu } from "../comments/CommentsMenu.js";
import { Icon } from "../components/Icon.js";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
import { comparisonToBanner } from "../versions/VersionBanner.js";
import { useRefreshState } from "../versions/refreshStore.js";
import { useRefresh } from "../versions/useRefresh.js";
import { refreshErrorNotice } from "../versions/versionUtils.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";
import { PrBadges } from "../ui/index.js";
import { jobCounts } from "./jobCounts.js";
import { useReviewIdentity } from "./reviewIdentity.js";
import { SubmitPanel } from "./SubmitPanel.js";

export function ReviewBar({
  reviewId,
  guideOpen,
  sourceOpen,
  onToggleGuide,
  onToggleSource,
}: {
  reviewId: string;
  guideOpen: boolean;
  sourceOpen: boolean;
  onToggleGuide: () => void;
  onToggleSource: () => void;
}): React.JSX.Element {
  const { short, prUrl, prState, reviewDecision } = useReviewIdentity(reviewId);
  // #92: the Debug page needs a finished open (its reads refuse earlier
  // states), so the icon waits until the review is ready. One snapshot
  // subscription (never behind a short-circuit) so the hook order is
  // stable across the loading → ready transition.
  const snapshot = useReview((s) => s.snapshot);
  const ingestReady =
    (snapshot?.ingest.status ?? "ready") === "ready" && (snapshot?.version?.n ?? 0) >= 1;
  // #98: live job count for this review (running · queued). The open
  // itself is not a job (ingest state, never a snapshot job), so the count
  // waits for the finished open like the Debug icon. Nothing renders when
  // idle, so no space is reserved; last in the right corner so appearing
  // never shifts the title or the buttons. Plain link text (no live
  // region) so screen readers are not spammed on every change.
  const counts = jobCounts(snapshot?.jobs ?? []);
  const showJobs = ingestReady && counts.running + counts.queued > 0;
  const jobsLabel = `${counts.running} running, ${counts.queued} queued`;
  // #241: Refresh lives here now (moved from the diff toolbar). Same
  // handler/check/banner as before; hidden for document reviews, which
  // never had it. Tooltip is exactly "Refresh".
  const { refreshing, doRefresh } = useRefresh(reviewId);
  const versionParam = useReviewVersion();
  const readOnly =
    versionParam !== undefined && snapshot !== null && versionParam !== snapshot.review.currentVersion;
  const isDocument = snapshot ? isDocumentReview(snapshot) : false;
  // Refresh on open: a cheap fetch-and-compare, no agent time (PRD §8).
  // Skipped while viewing an older version, and a no-op for reviews with
  // no git source (demo) or document reviews. Check-only: new commits
  // surface as the banner (never auto-applied, no jobs start); PR state
  // and decision update silently through the snapshot WS patch (#230).
  // No polling. The guard keeps StrictMode/remounts to one call per
  // review open.
  const sourceRepoId = snapshot?.review.repoId;
  const autoRefreshKey = useRef<string | null>(null);
  useEffect(() => {
    if (versionParam !== undefined || !sourceRepoId || sourceRepoId === "demo") return;
    if (snapshot && isDocumentReview(snapshot)) return;
    const key = `${reviewId}@${sourceRepoId}`;
    if (autoRefreshKey.current === key) return;
    autoRefreshKey.current = key;
    let cancelled = false;
    api
      .refresh(reviewId)
      .then((r) => {
        if (cancelled) return;
        if (r.newVersion && r.comparison) {
          const snap = useReview.getState().snapshot;
          const current = snap?.review.currentVersion ?? r.comparison.newVersion;
          useRefreshState.getState().setBanner(reviewId, comparisonToBanner(r.comparison, current));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) toast(refreshErrorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, versionParam, sourceRepoId, snapshot]);
  useEffect(() => () => useRefreshState.getState().clearReview(reviewId), [reviewId]);
  return (
    <div className="rbar" id="reviewbar">
      <div className="rid">
        <Link
          className="ib bd"
          to="/"
          aria-label="Back to the start page"
          title="Back to the start page"
        >
          <Icon name="home" />
        </Link>
        {prUrl ? (
          <a
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            title="Open PR on GitHub"
          >
            {short}
          </a>
        ) : (
          <span className="num">{short}</span>
        )}
        <PrBadges prState={prState} reviewDecision={reviewDecision} />
        {!isDocument ? (
          <button
            className="ib bd"
            type="button"
            data-tip="Refresh"
            aria-label="Refresh"
            disabled={refreshing || readOnly}
            onClick={() => void doRefresh()}
          >
            <Icon name="refresh" />
          </button>
        ) : null}
        <VersionSwitcher />
        {ingestReady ? (
          <Link
            className="ib bd"
            to={`/review/${encodeURIComponent(reviewId)}/debug`}
            aria-label="Debug"
            title="Debug"
          >
            <Icon name="bug" />
          </Link>
        ) : null}
      </div>
      <span className="seg" role="group" aria-label="Panes">
        <button type="button" aria-pressed={guideOpen} onClick={onToggleGuide}>
          Guide
        </button>
        <button
          id="toggleRight"
          type="button"
          aria-pressed={sourceOpen}
          onClick={onToggleSource}
        >
          Source
        </button>
      </span>
      <span className="ra">
        <CommentsMenu reviewId={reviewId} />
        <SubmitPanel reviewId={reviewId} primary />
        {showJobs ? (
          <Link
            className={`jcount${counts.running > 0 ? " live" : ""}`}
            to={`/review/${encodeURIComponent(reviewId)}/debug`}
            aria-label={jobsLabel}
            title={jobsLabel}
          >
            {counts.running} · {counts.queued}
          </Link>
        ) : null}
      </span>
    </div>
  );
}
