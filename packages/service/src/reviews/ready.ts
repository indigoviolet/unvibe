/**
 * #92: refuse actions on reviews that are still opening or failed to open
 * (409, plain reason shown after the caller's "Couldn't …" prefix).
 * Returns the reason text, or null when the snapshot is ready (absent
 * ingest status = ready, for pre-#92 rows).
 */
import { ingestStatusOf, type ReviewSnapshot } from "@unvibe/shared";

export function ingestRefusal(snapshot: ReviewSnapshot): string | null {
  const st = ingestStatusOf(snapshot);
  if (st === "ready") return null;
  if (st === "loading") return "the review is still opening";
  return snapshot.ingest?.error ?? "the review couldn't be opened";
}
