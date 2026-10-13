/**
 * Review bar (issue #31 round 2): the second row under the top bar on a
 * review, carrying everything review-specific. Full width above both
 * panes; stays in place when the panes scroll.
 *
 * - Left: the review identity (`owner/name#N` + title, truncated with the
 *   full title on hover), the version selector next to it (issue #120;
 *   hidden for single-version reviews, the current version annotated in
 *   the dropdown, an older shown version flagged with a warning border),
 *   the PR label linking to GitHub for PR reviews
 *   (#94, new tab) alongside the link-out icon, and Debug as
 *   an icon button (hidden until the review finishes opening, issue #92).
 * - Middle: the `[ Guide | Source ]` pane selector. Each segment toggles
 *   its pane (issue #83); `#toggleRight` stays on the Source segment.
 * - Right: Comments and Submit side by side, Submit as the primary button,
 *   plus the live job count (running · queued, issue #98) once the review
 *   is open and at least one job is live — a link to the Debug jobs list.
 */
import { Link } from "react-router-dom";
import { CommentsMenu } from "../comments/CommentsMenu.js";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
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
  const { short, title, prUrl } = useReviewIdentity(reviewId);
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
  return (
    <div className="rbar" id="reviewbar">
      <div className="rid">
        {prUrl ? (
          <a className="num" href={prUrl} target="_blank" rel="noreferrer" title="Open PR on GitHub">
            {short}
          </a>
        ) : (
          <span className="num">{short}</span>
        )}
        <b title={title}>{title}</b>
        <VersionSwitcher />
        {prUrl ? (
          <a className="ib bd" href={prUrl} target="_blank" rel="noreferrer" aria-label="Open PR on GitHub" title="Open PR on GitHub">
            <Icon name="open" />
          </a>
        ) : null}
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
