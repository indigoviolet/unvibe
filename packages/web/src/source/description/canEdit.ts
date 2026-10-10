/**
 * Description edit rule (comments owner; PRD §4.11).
 *
 * Editable only when the user is the PR author and the PR isn't merged:
 * - branch commit messages (`source: "commits"`) are never editable;
 * - a non-open `state` (CLOSED/MERGED) disables editing;
 * - a known viewer who isn't the recorded `author` disables editing;
 * - otherwise the service's `editable` flag decides (it covers old
 *   snapshots without author/state; `PUT …/description` enforces the
 *   strict rule anyway).
 */
interface DescriptionLike {
  source: string;
  editable: boolean;
  author?: string;
  state?: string;
}

export function canEditDescription(
  description: DescriptionLike | null | undefined,
  viewer: string | null | undefined,
): boolean {
  if (!description || description.source !== "pr") return false;
  if (description.state !== undefined && description.state !== "" && description.state !== "OPEN") {
    return false;
  }
  if (description.author !== undefined && viewer != null && viewer !== description.author) {
    return false;
  }
  return description.editable;
}
