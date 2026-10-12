/**
 * Description-pane naming (issue #86, finding 22): the tab reads
 * "Commits" for a branch review (no PR) and "PR description" for a PR
 * review. One place decides, keyed on `review.prNumber` (absent for
 * branch-only reviews); every tab, heading and comment-location label
 * reads it. An unknown snapshot keeps the old name.
 */
import type { ReviewSnapshot } from "@unvibe/shared";

export type DescriptionPaneName = "PR description" | "Commits";

export function descriptionPaneName(snapshot: ReviewSnapshot | null | undefined): DescriptionPaneName {
  if (!snapshot) return "PR description";
  return snapshot.review.prNumber == null ? "Commits" : "PR description";
}
