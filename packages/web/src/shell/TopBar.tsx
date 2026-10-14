/**
 * Review top row (issue #141): the review bar is the only bar on a
 * review. No application top bar, no Settings gear (Settings is reached
 * from the start page); the home control at the review bar's left end
 * goes back to the start page.
 */
import { ReviewBar } from "./ReviewBar.js";

interface Props {
  reviewId: string;
  guideOpen: boolean;
  sourceOpen: boolean;
  onToggleGuide: () => void;
  onToggleSource: () => void;
}

export function TopBar({ reviewId, guideOpen, sourceOpen, onToggleGuide, onToggleSource }: Props) {
  return (
    <ReviewBar
      reviewId={reviewId}
      guideOpen={guideOpen}
      sourceOpen={sourceOpen}
      onToggleGuide={onToggleGuide}
      onToggleSource={onToggleSource}
    />
  );
}
