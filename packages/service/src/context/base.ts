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
import { charTokenEstimator, type TokenEstimator } from "./tokens.js";
import type { PromptReviewSnapshot } from "./types.js";

export interface BasePackOptions {
  estimator?: TokenEstimator;
  inlineBudgetTokens?: number;
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
 */
export function buildBasePack(
  snapshot: PromptReviewSnapshot,
  instructions: string,
  opts: BasePackOptions = {},
): BasePack {
  const estimator = opts.estimator ?? charTokenEstimator;
  const l1 = buildL1Source(snapshot, opts);
  const l1b = buildL1bPinned(snapshot.pinnedCode);
  const l2 = buildL2Guide(snapshot);
  const hunkSummaries = buildHunkSummaries(snapshot);
  const user = [l1.text, l1b, l2].join("\n");
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
