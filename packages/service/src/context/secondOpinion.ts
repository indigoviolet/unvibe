/**
 * Second-opinion context (PRD §12).
 *
 * The second-opinion model runs in a fresh session with its own base:
 * L0 + L1 + only the cited code. It never sees guide text, other
 * findings, contributions, or the main model's pinned code beyond what is
 * cited.
 *
 * Isolation is structural: this function only accepts the safe inputs
 * (instructions, rendered L1 source, the code-excerpt map, the cited IDs).
 * Guide markdown, findings and contributions have no parameter to travel
 * through, so they cannot leak. Within the excerpt map, only excerpts
 * whose ID is cited are included; everything else — including uncited
 * pinned code — is dropped.
 */
export interface CodeExcerpt {
  /** `code:` or `diff:` ID as it appears in citations. */
  id: string;
  text: string;
}

export interface SecondOpinionInput {
  /** Rendered L0 instructions. */
  instructions: string;
  /** Rendered L1 source (metadata, description/log, diff, file list). */
  sourceText: string;
  /** All available excerpts; only cited ones are included. */
  codeExcerpts: CodeExcerpt[];
  /** Citation IDs from the card or finding under review. */
  citedIds: string[];
}

export interface SecondOpinionContext {
  text: string;
  /** Cited IDs that were included, in input order. */
  includedIds: string[];
  /** Cited IDs with no matching excerpt (dropped, reported for debugging). */
  missingIds: string[];
}

/**
 * Build the second-opinion base text. Deterministic: excerpts render in
 * `citedIds` order; duplicates collapse to first mention.
 */
export function buildSecondOpinionContext(input: SecondOpinionInput): SecondOpinionContext {
  const byId = new Map<string, string>();
  for (const excerpt of input.codeExcerpts) {
    if (!byId.has(excerpt.id)) byId.set(excerpt.id, excerpt.text);
  }
  const seen = new Set<string>();
  const includedIds: string[] = [];
  const missingIds: string[] = [];
  const parts = ["## Cited code", ""];
  for (const id of input.citedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const text = byId.get(id);
    if (text === undefined) {
      missingIds.push(id);
      continue;
    }
    includedIds.push(id);
    parts.push(`### [[${id}]]`, "", text, "");
  }
  if (includedIds.length === 0) parts.push("(no cited code available)", "");
  const text = [input.instructions, input.sourceText, parts.join("\n")].join("\n");
  return { text, includedIds, missingIds };
}
