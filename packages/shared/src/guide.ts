/**
 * Default guide title (issue #102).
 *
 * "Guide" is both the stored root-page title for a review with no real
 * title yet and the marker meaning "no real title": list and top-bar code
 * falls back to the branch name when the title is the default, and
 * wherever the default is displayed it shows as "Guide".
 */
export const DEFAULT_GUIDE_TITLE = "Guide";

/**
 * True when the title means "this review has no real title yet".
 */
export function isDefaultGuideTitle(title: string | null | undefined): boolean {
  return title === DEFAULT_GUIDE_TITLE;
}
