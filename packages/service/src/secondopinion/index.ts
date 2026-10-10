/**
 * Second opinion (PRD §4.10, §12): isolated runs on any card or finding.
 *
 * - `topic.ts` — blind-mode neutral topic (location-derived, never the claim).
 * - `excerpts.ts` — cited-code excerpt map (diff hunks, description, pins, worktree `code:`).
 * - `base.ts` — own L0 + L1 base per (version, model), fork or byte-identical fallback.
 * - `runner.ts` — request / store / dedupe / cancel / usage / prompt snapshot.
 */
export { deriveBlindTopic, isNeutralTitle } from "./topic.js";
export { buildExcerptMap, readCodeExcerpts } from "./excerpts.js";
export { buildSecondOpinionBaseText, ensureSecondOpinionBase, forkSecondOpinionBase } from "./base.js";
export {
  buildSecondOpinionPrompt,
  checkDistinctModel,
  removeSecondOpinion,
  requestSecondOpinion,
  resolveTarget,
  secondOpinionId,
} from "./runner.js";
export type { SecondOpinionDeps, SecondOpinionRequest } from "./runner.js";
