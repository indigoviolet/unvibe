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
 * What a review open was doing while loading (issue #92). The start page
 * Reviews row and the review loading page name the same progress with the
 * same words; both read them from here so they cannot drift apart.
 */
export function ingestStepLabel(step: string | undefined): string {
  return (step ?? "").trim().toLowerCase() === "reading diff" ? "Reading the diff…" : "Fetching…";
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
      return "writing concept pages";
    case "hunk-pass":
      return "summarizing code";
    default:
      return "building the guide";
  }
}
