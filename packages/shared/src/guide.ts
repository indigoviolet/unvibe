/**
 * Default guide title (issue #102).
 *
 * "Guide" is both the stored root-page title for a review with no real
 * title yet and the marker meaning "no real title": list and top-bar code
 * falls back to the branch name when the title is the default, and
 * wherever the default is displayed it shows as "Guide".
 */
import type { ReviewSnapshot } from "./api.js";

export const DEFAULT_GUIDE_TITLE = "Guide";

/**
 * True when the title means "this review has no real title yet".
 */
export function isDefaultGuideTitle(title: string | null | undefined): boolean {
  return title === DEFAULT_GUIDE_TITLE;
}

/**
 * Issue #388 (? mode): the cards a Rewrite covers — every written page
 * card on every guide page, in guide order. Pending (un-generated)
 * cards are skipped, persona variants are never targeted (Guide version
 * only), and thread replies are not guide cards. Shared so the client
 * (sync in-flight state) and the service (the fan-out) agree.
 */
export function questionRewriteTargetIds(snapshot: ReviewSnapshot): string[] {
  return (snapshot.pages ?? []).flatMap((p) =>
    (p.cards ?? []).filter((c) => !c.pending).map((c) => c.id),
  );
}
