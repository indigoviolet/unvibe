/**
 * Review top rows (issue #31 round 2): the app-wide `ScreenTopBar` with a
 * breadcrumb for the review, then the review-specific `ReviewBar`.
 */
import { ReviewBar } from "./ReviewBar.js";
import { ScreenTopBar } from "./ScreenTopBar.js";
import { useReviewIdentity } from "./reviewIdentity.js";

interface Props {
  reviewId: string;
  guideOpen: boolean;
  sourceOpen: boolean;
  onToggleGuide: () => void;
  onToggleSource: () => void;
}

export function TopBar({ reviewId, guideOpen, sourceOpen, onToggleGuide, onToggleSource }: Props) {
  const { short } = useReviewIdentity(reviewId);
  return (
    <>
      <ScreenTopBar crumbs={[{ label: short }]} showBadge showTips />
      <ReviewBar
        reviewId={reviewId}
        guideOpen={guideOpen}
        sourceOpen={sourceOpen}
        onToggleGuide={onToggleGuide}
        onToggleSource={onToggleSource}
      />
    </>
  );
}
