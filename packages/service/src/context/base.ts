/**
 * Base session assembly (PRD §9.2).
 *
 * The base is L0 (system instructions) plus one user message containing
 * L1 + L1b + L2, to which the agent answers "ready". Keyed by
 * (version, guide revision, model). Each conversation is `fork(base)` plus
 * one L4 message; small-model jobs and second opinions never fork the base
 * and build their own smaller contexts (see `secondOpinion.ts`).
 */
import { buildHunkSummaries, buildL1bPinned, buildL1Source, buildL2Guide } from "./layers.js";
import {
  charTokenEstimator,
  DEFAULT_BASE_PROMPT_CAP_TOKENS,
  DEFAULT_LEFTOVER_FLOOR_TOKENS,
  type TokenEstimator,
} from "./tokens.js";
import type { PromptReviewSnapshot } from "./types.js";

export interface BasePackOptions {
  estimator?: TokenEstimator;
  inlineBudgetTokens?: number;
  /** Hard cap for the L1 text (issue #107); defaults to the ladder's cap. */
  baseCapTokens?: number;
  pinnedHunkHashes?: ReadonlySet<string>;
}

export interface BasePack {
  /** (version, guide revision, model) key. */
  key: string;
  /** The L0 system text (instructions template, rendered). */
  system: string;
  /** One message containing L1 + L1b + L2. */
  user: string;
  l1: string;
  l1b: string;
  l2: string;
  hunkSummaries: string;
  overBudget: boolean;
  tokens: number;
}

/** Base key: `<version>/<guideRevision>/<model>`. */
export function baseKey(snapshot: PromptReviewSnapshot): string {
  return `${snapshot.version}/${snapshot.guideRevision}/${snapshot.model}`;
}

/**
 * Build the base pack. Byte-identical for identical inputs: layer builders
 * are pure and concatenated with fixed separators.
 *
 * The hunk summaries get only what is left of the cap after L1 + L1b + L2
 * (issue #107): the `base_pack` template assembles all of these into one
 * message, so two sections near their own caps could otherwise pass the
 * provider's window. The floor keeps the counts line and its notice. The
 * assembled total is asserted: unreachable in practice (L1 is capped and
 * L1b/L2 do not scale with PR size), but a plain error beats the
 * provider's "Prompt is too long".
 */
export function buildBasePack(
  snapshot: PromptReviewSnapshot,
  instructions: string,
  opts: BasePackOptions = {},
): BasePack {
  const estimator = opts.estimator ?? charTokenEstimator;
  const cap = opts.baseCapTokens ?? DEFAULT_BASE_PROMPT_CAP_TOKENS;
  const l1 = buildL1Source(snapshot, { ...opts, baseCapTokens: cap });
  const l1b = buildL1bPinned(snapshot.pinnedCode);
  const l2 = buildL2Guide(snapshot);
  const used =
    estimator.estimateTokens(l1.text) + estimator.estimateTokens(l1b) + estimator.estimateTokens(l2);
  const summariesCap = Math.max(DEFAULT_LEFTOVER_FLOOR_TOKENS, cap - used);
  const hunkSummaries = buildHunkSummaries(snapshot, { ...opts, baseCapTokens: summariesCap });
  const user = [l1.text, l1b, l2].join("\n");
  const total = estimator.estimateTokens(user) + estimator.estimateTokens(hunkSummaries);
  if (total > cap + DEFAULT_LEFTOVER_FLOOR_TOKENS) {
    throw new Error(
      `Review too large for a guide prompt: ${snapshot.files.length} files ` +
        `(over the ${cap}-token prompt cap even after budgeting each section).`,
    );
  }
  return {
    key: baseKey(snapshot),
    system: instructions,
    user,
    l1: l1.text,
    l1b,
    l2,
    hunkSummaries,
    overBudget: l1.overBudget,
    tokens: estimator.estimateTokens(user),
  };
}
