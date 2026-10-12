/**
 * Version-picker display helpers (issue #36, step 2): pure formatting for
 * the Settings → Version section and the preview badge. No API calls.
 */
import type { SwitchOutcome, UpdateBuildInfo, UpdateChannel } from "@unvibe/shared";

/** First 7 of a sha, like everywhere else in the UI. */
export function shortCommit(commit: string | null | undefined): string | null {
  if (!commit) return null;
  return commit.slice(0, 7);
}

/** Relative time for an ISO stamp ("3h ago"); null when missing/unparsable. */
export function timeAgoIso(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const d = now - ts;
  if (d < 0) return "just now";
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  if (d < 86400_000 * 30) return `${Math.floor(d / 86400_000)}d ago`;
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return null;
  }
}

/**
 * Versions newest build first (issue #73): one flat list ordered by
 * `builtAt` descending. Rows with no (or unparsable) `builtAt` go last,
 * in their existing order. Stable: equal timestamps keep list order.
 */
export function sortVersionsByRecency(channels: UpdateChannel[]): UpdateChannel[] {
  return [...channels]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ta = a.c.builtAt ? Date.parse(a.c.builtAt) : NaN;
      const tb = b.c.builtAt ? Date.parse(b.c.builtAt) : NaN;
      const fa = Number.isFinite(ta);
      const fb = Number.isFinite(tb);
      if (fa && fb && ta !== tb) return (tb as number) - (ta as number);
      if (fa !== fb) return fa ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ c }) => c);
}

/**
 * True when the installed build lags the published row: same channel, both
 * commits known, different. Drives the Update action (same switch flow,
 * from === to, no DB swap).
 */
export function isNewerAvailable(row: UpdateChannel, build: UpdateBuildInfo | null): boolean {
  return row.current && !!build?.commit && !!row.commit && build.commit !== row.commit;
}

/**
 * One blocked job as a quiet line ("explain · demo · running —
 * Streaming answer…"). The service caps the list; the panel adds
 * "+N more" from the full count.
 */
export function blockedJobLine(job: import("@unvibe/shared").UpdateBlockedJob): string {
  const where = job.reviewId ? ` · ${job.reviewId}` : "";
  const what = job.label ? ` — ${job.label}` : "";
  return `${job.kind}${where} · ${job.state}${what}`;
}

/** One-line identity for the running build ("on 0.0.1" / "on 0.0.1-preview… (feat/x · abc1234)"). */
export function buildLine(build: UpdateBuildInfo | null | undefined, fallbackVersion: string): string {
  if (!build) return `on ${fallbackVersion}`;
  const merged = mergedProvenance(build);
  if (merged) return `on ${build.version} (${merged})`;
  const branch = build.sourceBranch ? ` (${build.sourceBranch}` : "";
  const sha = build.sourceBranch && build.commit ? ` · ${shortCommit(build.commit)}` : "";
  const tail = branch ? `${branch}${sha})` : "";
  return `on ${build.version}${tail}`;
}

/**
 * Both sides of a merged preview (issue #41) as "main@abc1234 +
 * feat/x@def5678"; null for releases, branch-as-is previews, and older
 * builds without the fields.
 */
export function mergedProvenance(
  b: Pick<UpdateBuildInfo, "sourceBranch" | "sourceCommit" | "baseBranch" | "baseCommit"> | null | undefined,
): string | null {
  if (!b?.baseBranch || !b?.baseCommit || !b?.sourceBranch || !b?.sourceCommit) return null;
  return `${b.baseBranch}@${b.baseCommit.slice(0, 7)} + ${b.sourceBranch}@${b.sourceCommit.slice(0, 7)}`;
}

/** One-line summary of the last helper outcome. */
export function outcomeLine(outcome: SwitchOutcome): string {
  const when = timeAgoIso(outcome.finishedAt);
  const suffix = when ? ` · ${when}` : "";
  // Forced switch (#36 follow-up): name the jobs the shutdown path stopped.
  const stopped =
    outcome.interruptedJobs !== undefined && outcome.interruptedJobs > 0
      ? ` · ${outcome.interruptedJobs} job${outcome.interruptedJobs === 1 ? "" : "s"} interrupted`
      : "";
  if (outcome.status === "ok") return `Switched to ${outcome.to}${stopped}${suffix}`;
  if (outcome.status === "rolled-back") {
    return `Rolled back to ${outcome.from}${outcome.reason ? ` — ${outcome.reason}` : ""}${stopped}${suffix}`;
  }
  return `Switch failed${outcome.reason ? ` — ${outcome.reason}` : ""}${stopped}${suffix}`;
}
