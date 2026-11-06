/**
 * Visible feedback links (issue #351 review): each Since-B card or
 * addendum carries the resolved `answers` it was written for —
 * "Answers: <excerpt> ↗". Remote remarks (PR comments, conversation)
 * link out to GitHub; local threads link to the thread on the page;
 * commits render as text. Unknown ids never reach storage (the service
 * drops them at apply time), so every link here resolves.
 */
import type { SinceFeedbackLink } from "@unvibe/shared";

/**
 * Strip a leading "Updated since vN …:" from an addendum body. The
 * prompt tells the agent not to write it, but older passes may have;
 * the dated header above the body already says it. Pure.
 */
export function stripAddendumPrefix(standard: string): string {
  return standard.replace(/^updated since (?:v\d+|[0-9a-f]{7,8})\s*(·[^:]*)?[:\-–—]\s*/i, "");
}

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
  if (answers.length === 0) return null;
  return (
    <div className="since-answers" data-testid="since-answers">
      <span className="since-answers-h">Answers:</span>{" "}
      {answers.map((a, i) => (
        <span key={`${a.kind}-${a.label}-${i}`}>
          {i > 0 ? " · " : null}
          <AnswerLink answer={a} />
        </span>
      ))}
    </div>
  );
}
