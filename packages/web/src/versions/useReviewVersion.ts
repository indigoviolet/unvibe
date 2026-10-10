/**
 * `?version=n` from the URL: viewing an older version read-only (PRD §8).
 *
 * Reads `window.location.search` directly (not the router) so the diff pane
 * stays usable standalone — unit tests, deep links — exactly like the
 * pane's snapshot fetch. Route navigations re-render anyway, so a version
 * switch is picked up.
 */
export function useReviewVersion(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get("version");
  if (raw === null) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}
