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
 * Compare release versions (issue #231): numeric `major.minor.patch`
 * first, then a missing pre-release beats a present one (`0.0.1` is
 * newer than `0.0.1-preview.x.y`), two pre-releases compare lexically.
 * Unparseable cores compare as 0. Returns -1 / 0 / 1.
 */
export function compareReleaseVersions(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; pre: string | null } => {
    const m = /^(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(v.trim());
    if (!m) return { nums: [], pre: v };
    return { nums: m[1].split(".").map(Number), pre: m[2] ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.nums.length, pb.nums.length); i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * The release channel carrying an update for the running build
 * (issue #231), or null when up to date or undeterminable:
 * - release builds compare the release version against the running one;
 * - preview builds compare by date: the release was published after
 *   the running preview was built.
 * Missing versions, build times or unparseable dates mean null — the
 * caller shows no icon and no error.
 */
export function findUpdateAvailable(
  build: UpdateBuildInfo | null,
  channels: UpdateChannel[],
): UpdateChannel | null {
  if (!build?.channel || !build.version) return null;
  const release = channels.find((c) => c.ref === "release" && c.kind === "release");
  if (!release?.version) return null;
  if (build.channel.startsWith("preview/")) {
    if (!build.builtAt || !release.builtAt) return null;
    const built = Date.parse(build.builtAt);
    const published = Date.parse(release.builtAt);
    if (!Number.isFinite(built) || !Number.isFinite(published)) return null;
    return published > built ? release : null;
  }
  return compareReleaseVersions(release.version, build.version) > 0 ? release : null;
}

/** Display state of one channel row for the installed channel and the rest. */
export type ChannelRowState = "update-available" | "installed" | "other";

export function channelRowState(row: UpdateChannel, build: UpdateBuildInfo | null): ChannelRowState {
  if (!row.current) return "other";
  return isNewerAvailable(row, build) ? "update-available" : "installed";
}

/** Short header badge for a preview build, e.g. "preview · main-rc · 6818b23". */
export function badgeLabel(build: Pick<UpdateBuildInfo, "sourceBranch" | "sourceCommit" | "commit">): string {
  const sha = shortCommit(build.sourceCommit ?? build.commit);
  if (!build.sourceBranch) return sha ? `preview · ${sha}` : "preview";
  return sha ? `preview · ${build.sourceBranch} · ${sha}` : `preview · ${build.sourceBranch}`;
}

/** Full badge detail for the tooltip: version, both bases and build time. */
export function badgeTitle(build: UpdateBuildInfo, now: number = Date.now()): string {
  const merged = mergedProvenance(build);
  const sha = shortCommit(build.sourceCommit ?? build.commit);
  const from = merged ?? (build.sourceBranch ? (sha ? `${build.sourceBranch} · ${sha}` : build.sourceBranch) : null);
  const built = build.builtAt ? (timeAgoIso(build.builtAt, now) ?? build.builtAt) : null;
  const parts = [`Preview build ${build.version}`];
  if (from) parts.push(`from ${from}`);
  if (built) parts.push(`built ${built}`);
  return `${parts.join(" · ")} — open Settings → Version to switch back.`;
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
