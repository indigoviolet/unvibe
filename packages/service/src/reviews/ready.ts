/**
 * #92: refuse actions on loading/failed reviews cleanly (409, plain).
 * Returns the error text, or null when the snapshot is ready (absent
 * ingest status = ready, for pre-#92 rows).
 */
import { ingestStatusOf, type ReviewSnapshot } from "@unvibe/shared";

export function ingestRefusal(snapshot: ReviewSnapshot): string | null {
  const st = ingestStatusOf(snapshot);
  if (st === "ready") return null;
  if (st === "loading") return "review is still loading";
  return `review ingest failed${snapshot.ingest?.error ? `: ${snapshot.ingest.error}` : ""}`;
}
