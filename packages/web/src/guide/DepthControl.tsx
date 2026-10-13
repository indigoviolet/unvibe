/**
 * Shared depth stepper (issue #129): one control for page cards
 * (`CardView`) and expansion cards (`ExpansionCard`).
 *
 * − / + with three level pips and no level names. While a depth change
 * runs, both buttons keep their icons and are disabled — no dots inside
 * the control, in either direction (dots beside the three pips read as a
 * second, broken level indicator). The card's own "Rewriting…" row carries
 * the working state instead.
 */
import type { DepthLevel } from "@unvibe/shared";

export const DEPTH_ORDER: DepthLevel[] = ["simple", "standard", "deep"];

export function DepthControl({
  level,
  disabled,
  depthBusy,
  simplerAtLimit,
  onSimpler,
  onDeeper,
}: {
  /** Current depth level (unknown values fall back to standard pips). */
  level: DepthLevel;
  /** Another control is running, or the text is not ready: both buttons off, icons kept. */
  disabled?: boolean;
  /** A depth change is running (marks the group busy for assistive tech). */
  depthBusy?: boolean;
  /** Already at the simplest level: Simpler stays off. */
  simplerAtLimit?: boolean;
  onSimpler: () => void;
  onDeeper: () => void;
}): React.JSX.Element {
  const depthIndex = DEPTH_ORDER.indexOf(level);
  const safe = depthIndex < 0 ? 1 : depthIndex;
  return (
    <span className="depth" role="group" aria-label="Depth" aria-busy={depthBusy || undefined}>
      <button
        type="button"
        data-tip="Simpler"
        aria-label="Simpler"
        disabled={safe <= 0 || simplerAtLimit || disabled}
        onClick={onSimpler}
      >
        −
      </button>
      <span className="dl" data-tip="Depth">
        <span className="pips" aria-hidden="true">
          {DEPTH_ORDER.map((_, j) => (
            <i key={j} className={j <= safe ? "on" : ""} />
          ))}
        </span>
      </span>
      <button type="button" data-tip="Deeper" aria-label="Deeper" disabled={disabled} onClick={onDeeper}>
        +
      </button>
    </span>
  );
}
