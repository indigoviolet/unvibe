/**
 * New-commits banner (PRD §8, #413): "New commits · v1 → v2 (…)" plus
 * range-diff plus Explain. Explain runs one agent call on click with
 * the X chosen beside it (an earlier version, any PR commit, or the
 * reviewer's last GitHub review); the end is always the head. There is
 * no up-to-date state: the banner is the only new-commits signal, and
 * the section header carries its own Explain control for re-runs.
 *
 * Counts come from `versionStatus` on the snapshot (or the refresh
 * `comparison`, normalised by the caller).
 */
import { useState } from "react";
import type { VersionComparisonSummary, VersionStatus } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { SinceBaselineError } from "../guide/PriorReviewOffer.js";
import { defaultExplainX, ExplainXSelect, explainXLabel, type ExplainX } from "../guide/ExplainXSelect.js";
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
  onUpdated: () => void;
}): React.JSX.Element | null {
  const [x, setX] = useState<ExplainX | null>(null);
  const snapshot = useReview((s) => s.snapshot);
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

  const def = snapshot ? defaultExplainX(snapshot) : null;
  const label = explainXLabel(x ?? def ?? { version: counts.fromVersion });

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
      {phase.name === "failed" ? <span className="hint">{phase.message}</span> : null}
      {explaining ? (
        <span className="hint" data-testid="explain-progress" aria-live="polite" role="status">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>{" "}
          Explaining…
        </span>
      ) : (
        <span className="dbar-group">
          <ExplainXSelect reviewId={reviewId} value={x} onChange={setX} />
          <button className="x" type="button" onClick={() => start(x)}>
            Explain changes since {label}
          </button>
        </span>
      )}
      <SinceBaselineError />
    </div>
  );
}

