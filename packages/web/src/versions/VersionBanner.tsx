/**
 * New-commits banner (PRD §8, #413): "New commits · v1 → v2 (…)" plus
 * range-diff plus a plain Explain button. X is fixed to the version the
 * new commits came after — the X picker lives only in the guide (the
 * section header, or the guide-top control when no section exists), so
 * only one picker is ever on screen. Explain runs one agent call on
 * click; the end is always the head. There is no up-to-date state.
 *
 * Counts come from `versionStatus` on the snapshot (or the refresh
 * `comparison`, normalised by the caller).
 */
import type { VersionComparisonSummary, VersionStatus } from "@unvibe/shared";
import { SinceBaselineError } from "../guide/PriorReviewOffer.js";
import { useExplainPass } from "../guide/useExplainPass.js";
import { versionCountsText } from "./versionUtils.js";

export interface BannerCounts {
  fromVersion: number;
  toVersion: number;
  changedHunks: number;
  newHunks: number;
  removedHunks: number;
  rangeDiff: string;
  /** #179: the new version's diff is empty. */
  empty?: boolean;
}

export function statusToBanner(s: VersionStatus): BannerCounts {
  return {
    fromVersion: s.fromVersion,
    toVersion: s.toVersion,
    changedHunks: s.changedHunks,
    newHunks: s.newHunks,
    removedHunks: s.removedHunks,
    rangeDiff: s.rangeDiff,
    ...(s.empty ? { empty: true } : {}),
  };
}

export function comparisonToBanner(
  c: VersionComparisonSummary,
  reviewCurrentVersion: number,
): BannerCounts {
  return {
    fromVersion: c.oldVersion,
    toVersion: Math.max(c.newVersion, reviewCurrentVersion),
    changedHunks: c.changedHunks,
    newHunks: c.newHunks,
    removedHunks: c.removedHunks,
    rangeDiff: c.rangeDiff,
    ...(c.unchangedHunks + c.changedHunks + c.newHunks === 0 ? { empty: true } : {}),
  };
}

export function VersionBanner({
  reviewId,
  counts,
  onUpdated,
}: {
  reviewId: string;
  counts: BannerCounts;
  onUpdated: (stored: boolean) => void;
}): React.JSX.Element | null {
  const { phase, start } = useExplainPass(reviewId, onUpdated);
  const explaining = phase.name === "explaining" ? phase : null;

  if (counts.empty) {
    return (
      <div className="dbar" data-testid="stale-banner" role="status">
        <span className="hint" data-testid="empty-diff-message">
          No changes to review — the diff is now empty. The branch is the same as its base, so there is nothing to explain.
        </span>
      </div>
    );
  }

  // A no-change refresh (e.g. a content-identical rebase) names no new
  // hunks: the banner stays hidden. Single-version reviews never reach
  // here (no `versionStatus` yet).
  if (counts.changedHunks + counts.newHunks + counts.removedHunks === 0) return null;

  // X is fixed: the version the new commits came after.

  return (
    <div className="dbar" data-testid="stale-banner" role="status">
      <span className="dbar-group dbar-group-summary">
        <span className="hint">
          New commits · v{counts.fromVersion} → v{counts.toVersion} ({versionCountsText(counts)}{" "}
          hunks)
        </span>
        {counts.rangeDiff.trim() !== "" ? (
          <details>
            <summary className="hint" style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
              range-diff
            </summary>
            <pre className="code" data-testid="range-diff">
              {counts.rangeDiff}
            </pre>
          </details>
        ) : null}
      </span>
      {explaining ? (
        <span className="hint" data-testid="explain-progress" aria-live="polite" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>{" "}
          Explaining changes since v{counts.fromVersion}…
        </span>
      ) : (
        <span className="dbar-group">
          <button className="x" type="button" onClick={() => start({ version: counts.fromVersion })}>
            Explain changes since v{counts.fromVersion}
          </button>
        </span>
      )}
      {phase.name === "failed" ? (
        <span className="hint explain-error" role="alert" data-testid="explain-error">
          {phase.message}
        </span>
      ) : null}
      {phase.name === "empty" ? (
        <span className="hint" role="status" data-testid="explain-empty">
          No changes to explain since v{counts.fromVersion}
        </span>
      ) : null}
      <SinceBaselineError />
    </div>
  );
}

