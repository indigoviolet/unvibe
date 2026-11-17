/**
 * Visible feedback links (issue #351 review): each Since card carries
 * the resolved `answers` it was written for — "Answers: <excerpt> ↗".
 * Remote remarks (PR comments, conversation) link out to GitHub; local
 * threads link to the thread on the page; commits render as text (no
 * stable URL). Issue #413: Answers is for feedback — commit-only
 * Answers lines are hidden (the prompt lists a commit only when no
 * comment, thread or conversation applies).
 */
import type { SinceFeedbackLink } from "@unvibe/shared";

function AnswerLink({ answer }: { answer: SinceFeedbackLink }): React.JSX.Element {
  const text = `${answer.label} — “${answer.excerpt}”`;
  if (answer.url) {
    const external = /^https?:\/\//.test(answer.url);
    return (
      <a
        className="cx"
        href={answer.url}
        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      >
        {text} ↗
      </a>
    );
  }
  return <span>{text}</span>;
}

export function SinceAnswers({ answers }: { answers: SinceFeedbackLink[] }): React.JSX.Element | null {
  // Feedback only: a line answered solely by commits stays hidden.
  const shown = answers.filter((a) => a.kind !== "commit");
  if (shown.length === 0) return null;
  return (
    <div className="since-answers" data-testid="since-answers">
      <span className="since-answers-h">Answers:</span>{" "}
      {shown.map((a, i) => (
        <span key={`${a.kind}-${a.label}-${i}`}>
          {i > 0 ? " · " : null}
          <AnswerLink answer={a} />
        </span>
      ))}
    </div>
  );
}
