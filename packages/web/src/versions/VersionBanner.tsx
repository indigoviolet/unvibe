/**
 * New-commits banner (PRD §8, #413, text #421): "N new commits since
 * the guide was written" plus one primary Explain button. X is fixed
 * to the commit the current guide was written at (stamped when the
 * reader lands, so it follows a Re-do); the end is always the head.
 * Explain runs one agent call on click. There is no up-to-date state.
 *
 * Counts come from `versionStatus` on the snapshot (or the refresh
 * `comparison`, normalised by the caller).
 */
import { Button } from "../ui/index.js";
import type { VersionComparisonSummary, VersionStatus } from "@unvibe/shared";
import { newerCommitsSince } from "@unvibe/shared";
import { useReview } from "../state/store.js";
import { SinceBaselineError } from "../guide/PriorReviewOffer.js";
import { explainXLabel, useExplainPass } from "../guide/useExplainPass.js";
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

  // X is fixed: the commit the guide was written at. A rewrite that
  // moved it falls back to the whole listed range.
  const commits = snapshot?.commits ?? [];
  const guideSha = snapshot?.guideHead.sha;
  const fromSha = guideSha ?? commits[0]?.sha ?? snapshot?.version.headSha ?? "";
  const newer = guideSha ? newerCommitsSince(commits, guideSha) : null;
  const count = newer ?? commits.length;
  const noun = count === 1 ? "1 new commit" : `${count} new commits`;
  const fromLabel = fromSha !== "" ? explainXLabel({ sha: fromSha }) : null;

  return (
    <div className="dbar" data-testid="stale-banner" role="status">
      <span className="dbar-group dbar-group-summary">
        <span className="hint">
          {noun} since the guide was written ({versionCountsText(counts)}{" "}
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
          Explaining changes since {fromLabel ?? "…"}…
        </span>
      ) : (
        <span className="dbar-group">
          {/* #421: the banner text never repeats the X, so neither does
              the button. */}
          <Button
            variant="primary"
            size="sm"
            type="button"
            data-testid="explain-button"
            data-tip={fromLabel ? `Explain changes since ${fromLabel}` : undefined}
            onClick={() => start({ sha: fromSha })}
          >
            Explain changes
          </Button>
        </span>
      )}
      {phase.name === "failed" ? (
        <span className="hint explain-error" role="alert" data-testid="explain-error">
          {phase.message}
        </span>
      ) : null}
      {phase.name === "empty" ? (
        <span className="hint" role="status" data-testid="explain-empty">
          No changes to explain since {fromLabel}
        </span>
      ) : null}
      <SinceBaselineError />
    </div>
  );
}
