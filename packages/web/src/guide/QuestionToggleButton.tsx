/**
 * ?-mode toggle for the review top bar (issue #388).
 *
 * One icon button next to Refresh / Debug / Copy guide, in the same
 * icon-button style, with the tooltip "Pick terms you don't understand".
 * It hides wherever the other review-only buttons hide (document
 * reviews, loading / failed / empty opens), plus the static demo, whose
 * recordings can't answer arbitrary picked terms.
 */
import { isDocumentReview } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { useReview } from "../state/store.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";
import { STATIC_DEMO } from "../demo.js";
import { clearQuestionHighlights } from "./question.js";

export function QuestionToggleButton(): React.JSX.Element | null {
  const snapshot = useReview((s) => s.snapshot);
  const questionMode = useReview((s) => s.questionMode);
  const setQuestionMode = useReview((s) => s.setQuestionMode);
  const versionParam = useReviewVersion();
  const readOnly =
    versionParam !== undefined && snapshot !== null && versionParam !== snapshot.review.currentVersion;
  if (snapshot === null || isDocumentReview(snapshot)) return null;
  if ((snapshot.ingest?.status ?? "ready") !== "ready") return null;
  if (STATIC_DEMO) return null;
  const root = snapshot.pages.find((p) => p.kind === "root") ?? snapshot.pages[0];
  if (!root || root.cards.length === 0) return null;

  const toggle = (): void => {
    if (useReview.getState().questionMode) {
      clearQuestionHighlights();
      useReview.getState().setQuestionMode(false);
    } else {
      setQuestionMode(true);
    }
  };

  return (
    <button
      className="ib"
      type="button"
      data-tip="Pick terms you don't understand"
      data-testid="question-toggle"
      aria-label="Pick terms you don't understand"
      aria-pressed={questionMode}
      disabled={readOnly}
      onClick={toggle}
    >
      <Icon name="question" />
    </button>
  );
}
