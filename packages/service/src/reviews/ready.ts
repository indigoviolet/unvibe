/**
 * #92: refuse actions on reviews that are still opening or failed to open
 * (409, plain reason shown after the caller's "Couldn't …" prefix).
 * Returns the reason text, or null when the snapshot is ready.
 */
import { ingestStatusOf, type ReviewSnapshot } from "@unvibe/shared";

export function ingestRefusal(snapshot: ReviewSnapshot): string | null {
  const st = ingestStatusOf(snapshot);
  if (st === "ready") return null;
  if (st === "loading") return "the review is still opening";
  if (st === "empty") return snapshot.ingest?.error ?? "No changes to review: the diff is empty.";
  return snapshot.ingest?.error ?? "the review couldn't be opened";
}
