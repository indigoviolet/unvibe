/**
 * Review bar (issue #31 round 2): the second row under the top bar on a
 * review, carrying everything review-specific. Full width above both
 * panes; stays in place when the panes scroll.
 *
 * - Left: the review identity (`owner/name#N` + title, truncated with the
 *   full title on hover), a GitHub link-out for PR reviews, and Debug as
 *   an icon button (hidden until the review finishes opening, issue #92).
 * - Middle: the `[ Guide | Source ]` pane selector. Each segment toggles
 *   its pane (issue #83); `#toggleRight` stays on the Source segment.
 * - Right: Comments and Submit side by side, Submit as the primary button.
 */
import { Link } from "react-router-dom";
import { CommentsMenu } from "../comments/CommentsMenu.js";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
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
  // states), so the icon waits until the review is ready.
  const ingestReady =
    (useReview((s) => s.snapshot?.ingest?.status) ?? "ready") === "ready" &&
    (useReview((s) => s.snapshot?.version?.n) ?? 0) >= 1;
  return (
    <div className="rbar" id="reviewbar">
      <div className="rid">
        <span className="num">{short}</span>
        <b title={title}>{title}</b>
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
      </span>
    </div>
  );
}
