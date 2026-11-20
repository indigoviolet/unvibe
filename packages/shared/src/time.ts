/**
 * Relative and exact time formatting (issue #431): the history menu's
 * per-commit relative age. Pure (takes `now` as a parameter), shared so
 * the service and the web app agree. The long forms live where they are
 * used (`timeAgo` on the start page, `timeAgoIso` in the version
 * picker); this file owns only the short menu form plus the exact-time
 * tooltip.
 */

/** Short relative age for a commit timestamp: "now", "5m", "2h", "3d", "1w", "2mo", "1y". */
export function shortAge(ts: number, now: number = Date.now()): string {
  const d = now - ts;
  if (!Number.isFinite(d) || d < 60_000) return "now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h`;
  if (d < 7 * 86400_000) return `${Math.floor(d / 86400_000)}d`;
  if (d < 30 * 86400_000) return `${Math.floor(d / (7 * 86400_000))}w`;
  if (d < 365 * 86400_000) return `${Math.floor(d / (30 * 86400_000))}mo`;
  return `${Math.floor(d / (365 * 86400_000))}y`;
}

/**
 * Exact timestamp in the user's locale ("18 Nov 2026, 14:32" under
 * en-GB): the tooltip behind a `shortAge`. Empty when unformattable.
 */
export function exactTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}
