/**
 * Shared pipeline-stage → plain-words labels (issue #45, entry 44). The
 * start page (`start/StartPage.tsx` `runningLabel`) and the guide empty
 * state (`guide/GuidePage.tsx`) name the same progress with the same
 * words; both read them from here so they cannot drift apart.
 */

/** Short in-progress label for a stage, or undefined when there is none ("otherwise omit"). */
export function stageLabel(stage: string | undefined): string | undefined {
  switch ((stage ?? "").trim().toLowerCase()) {
    case "reader":
      return "Reading the change…";
    case "base":
      return "Preparing…";
    case "critic":
      return "Checking findings…";
    case "concept":
    case "concepts":
      return "Writing concept pages…";
    case "hunk-pass":
      return "Summarizing code…";
    case "go-deeper":
      return "Writing deeper cards…";
    default:
      return undefined;
  }
}

/**
 * What the guide was doing when it failed, for
 * "Something went wrong while …" (issue #45, entry 46).
 */
export function stagePhrase(stage: string | undefined): string {
  switch ((stage ?? "").trim().toLowerCase()) {
    case "reader":
      return "reading the change";
    case "base":
      return "preparing";
    case "critic":
      return "checking findings";
    case "concept":
    case "concepts":
      return "writing concept pages";
    case "hunk-pass":
      return "summarizing code";
    default:
      return "building the guide";
  }
}
