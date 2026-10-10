/**
 * Read-only older versions (comments owner; PRD §8).
 *
 * Same rule as the versions UI (`VersionSwitcher`): viewing `?version=n`
 * with `n` other than the review's current version is read-only — threads,
 * drafts and submit are disabled there. The switcher itself offers the way
 * back to current.
 */
import { useReview } from "../state/store.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";

/** True when the snapshot is loaded and an older version is being viewed. */
export function useIsReadOnlyVersion(): boolean {
  const snapshot = useReview((s) => s.snapshot);
  const viewing = useReviewVersion();
  if (!snapshot || viewing === undefined) return false;
  return viewing !== snapshot.review.currentVersion;
}

/** Non-hook form for event handlers (jump, toolbar actions). */
export function isReadOnlyVersionNow(): boolean {
  const snapshot = useReview.getState().snapshot;
  if (!snapshot) return false;
  const raw = new URLSearchParams(window.location.search).get("version");
  if (raw === null) return false;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) return false;
  return n !== snapshot.review.currentVersion;
}
