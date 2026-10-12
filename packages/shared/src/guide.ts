/**
 * Default guide title (issue #102).
 *
 * "Guide" is both the stored root-page title for a review with no real
 * title yet and the marker meaning "no real title": list and top-bar code
 * falls back to the branch name when the title is the default.
 *
 * Reviews stored before #102 keep "Guided review" on disk (no data
 * migration); everything that reads the title treats both strings as the
 * default, and wherever the default is displayed it shows as "Guide".
 */
export const DEFAULT_GUIDE_TITLE = "Guide";

/** Pre-#102 stored form of the default title; still on disk in old reviews. Never write this. */
const LEGACY_DEFAULT_GUIDE_TITLE = "Guided review";

/**
 * True when the title means "this review has no real title yet" — either
 * the current default or the legacy stored form. A review whose real,
 * user-meaningful title is literally "Guide" (or "Guided review") is
 * indistinguishable from the default; that was already true for
 * "Guided review" before #102.
 */
export function isDefaultGuideTitle(title: string | null | undefined): boolean {
  return title === DEFAULT_GUIDE_TITLE || title === LEGACY_DEFAULT_GUIDE_TITLE;
}
