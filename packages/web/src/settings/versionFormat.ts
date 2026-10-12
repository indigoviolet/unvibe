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

export interface ChannelGroups {
  release: UpdateChannel[];
  releaseRc: UpdateChannel[];
  previews: UpdateChannel[];
}

/** Channels grouped release / release-candidate / previews (each in list order). */
export function groupChannels(channels: UpdateChannel[]): ChannelGroups {
  const groups: ChannelGroups = { release: [], releaseRc: [], previews: [] };
  for (const c of channels) {
    if (c.kind === "release") groups.release.push(c);
    else if (c.kind === "release-rc") groups.releaseRc.push(c);
    else groups.previews.push(c);
  }
  return groups;
}

/**
 * True when the installed build lags the published row: same channel, both
 * commits known, different. Drives the Update action (same switch flow,
 * from === to, no DB swap).
 */
export function isNewerAvailable(row: UpdateChannel, build: UpdateBuildInfo | null): boolean {
  return row.current && !!build?.commit && !!row.commit && build.commit !== row.commit;
}

/** One-line identity for the running build ("on 0.0.1" / "on 0.0.1-preview… (feat/x · abc1234)"). */
export function buildLine(build: UpdateBuildInfo | null | undefined, fallbackVersion: string): string {
  if (!build) return `on ${fallbackVersion}`;
  const branch = build.sourceBranch ? ` (${build.sourceBranch}` : "";
  const sha = build.sourceBranch && build.commit ? ` · ${shortCommit(build.commit)}` : "";
  const tail = branch ? `${branch}${sha})` : "";
  return `on ${build.version}${tail}`;
}

/** One-line summary of the last helper outcome. */
export function outcomeLine(outcome: SwitchOutcome): string {
  const when = timeAgoIso(outcome.finishedAt);
  const suffix = when ? ` · ${when}` : "";
  if (outcome.status === "ok") return `Switched to ${outcome.to}${suffix}`;
  if (outcome.status === "rolled-back") {
    return `Rolled back to ${outcome.from}${outcome.reason ? ` — ${outcome.reason}` : ""}${suffix}`;
  }
  return `Switch failed${outcome.reason ? ` — ${outcome.reason}` : ""}${suffix}`;
}
