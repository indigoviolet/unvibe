/**
 * ?-mode tray (issue #388): the picked terms, with Rewrite and Cancel.
 *
 * A small fixed tray listing each picked term (× removes it, unpicking
 * its highlight too) with **Rewrite cards** and **Cancel**. Rewrite
 * posts one `question-rewrite` action and — once the rewrite starts —
 * clears the tray and turns the mode off; the cards show their usual
 * writing state while their jobs run. Cancel (like turning the mode
 * off) clears the terms and highlights with no agent call.
 */
import { useState } from "react";
import { useReview } from "../state/store.js";
import { performQuestionRewrite } from "./actions.js";
import { clearQuestionHighlights, unhighlightQuestionTerm } from "./question.js";

export function QuestionTray({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const questionMode = useReview((s) => s.questionMode);
  const terms = useReview((s) => s.questionTerms);
  const [rewriting, setRewriting] = useState(false);
  if (!questionMode) return null;

  const remove = (id: string): void => {
    unhighlightQuestionTerm(id);
    useReview.getState().removeQuestionTerm(id);
  };
  const cancel = (): void => {
    clearQuestionHighlights();
    useReview.getState().setQuestionMode(false);
  };
  const rewrite = (): void => {
    if (rewriting || terms.length === 0) return;
    setRewriting(true);
    void performQuestionRewrite(reviewId).finally(() => setRewriting(false));
  };

  return (
    <div id="qtray" data-testid="question-tray" role="group" aria-label="Terms you don't understand">
      <span className="qt-label">Terms you don&apos;t understand:</span>
      {terms.length === 0 ? <span className="qt-empty">Select text in any guide card to add it.</span> : null}
      {terms.map((t) => (
        <span className="qt-term" key={t.id} data-testid="question-term">
          <span className="qt-text">{t.text}</span>
          <button
            type="button"
            data-testid="question-term-remove"
            aria-label={`Remove "${t.text}"`}
            onClick={() => remove(t.id)}
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        className="ui-btn"
        data-variant="primary"
        data-size="sm"
        data-testid="question-rewrite"
        disabled={rewriting || terms.length === 0}
        onClick={rewrite}
      >
        {rewriting ? "Rewriting…" : "Rewrite cards"}
      </button>
      <button type="button" className="qt-cancel" data-testid="question-cancel" onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}
