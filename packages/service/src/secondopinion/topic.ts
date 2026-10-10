/**
 * Blind-mode topic derivation (PRD §4.10).
 *
 * Decision (documented here): the blind topic is derived from the cited
 * locations plus a neutral template — never from the finding's claim,
 * title, summary, or assessment text.
 *
 * Rationale:
 * - Using the finding's title only when "neutral" is fragile: neutrality
 *   is hard to judge reliably, and the fixture's own titles ("Folds that
 *   end in a bare LF are not unfolded", "The linear-time claim has no
 *   test") already state the verdict. A heuristic allow-list would leak on
 *   exactly the cases that matter.
 * - Generating the topic with the small model (paraphrasing the claim with
 *   an instruction not to reveal the verdict) still feeds the claim into a
 *   model and risks paraphrase leakage; it also adds an extra agent call
 *   and non-determinism to what should be a pure, testable step.
 * - A location-derived topic ("Review the code at … for correctness, edge
 *   cases and test coverage") is neutral by construction, deterministic,
 *   and guarantees the claim text never reaches the prompt. The per-request
 *   cited code carries all the signal the second model needs.
 *
 * `isNeutralTitle` is kept as a documented helper for the alternative the
 * PRD mentions (title-only when neutral), but the runner does NOT use the
 * title for blind topics — it always uses the location template. Tests pin
 * this: neither fixture finding's claim text appears in the blind prompt.
 */

export interface BlindTopicInput {
  /** Cited `diff:` / `code:` / `h:` / `desc:` IDs (canonical targets). */
  citedIds: string[];
  /** File paths for the cited IDs, for readability (may be empty). */
  filePaths?: string[];
}

/**
 * Heuristic neutrality check for a finding title (PRD §4.10 alternative).
 * Titles containing verdict-laden words are non-neutral. Kept for
 * documentation / Settings preview; the blind runner does not use titles.
 */
export function isNeutralTitle(title: string): boolean {
  const t = title.toLowerCase();
  const verdictWords = [
    "not ",
    "not-",
    "n't",
    "fails",
    "fail",
    "missing",
    "lacks",
    "without",
    "no test",
    "no coverage",
    "bug",
    "incorrect",
    "wrong",
    "unsafe",
    "should",
    "must",
    "needs",
    "gap",
    "risk",
    "regression",
    "broken",
  ];
  return !verdictWords.some((w) => t.includes(w));
}

/**
 * Derive a neutral blind topic from cited locations only. Never takes the
 * claim, title, summary, or assessment as input — so callers cannot leak
 * the verdict by accident (the type signature enforces it).
 */
export function deriveBlindTopic(input: BlindTopicInput): string {
  const ids = [...new Set(input.citedIds)].slice(0, 8);
  const paths = [...new Set(input.filePaths ?? [])].slice(0, 4);
  const where =
    ids.length > 0
      ? ids.map((id) => `[[${id}]]`).join(", ")
      : "(no cited locations)";
  const files = paths.length > 0 ? ` in ${paths.join(", ")}` : "";
  return (
    `Independently review the changed code at ${where}${files} ` +
    `for correctness, edge cases and test coverage. ` +
    `Judge only what the code shows; do not assume any prior conclusion.`
  );
}
