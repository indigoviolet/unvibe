/**
 * Token estimation for context budgets (PRD §9.1, §9.3, §9.4).
 *
 * The estimator sits behind an interface so measured provider tokenizers
 * can replace the heuristic without touching the context builder.
 *
 * Default heuristic: ~4 characters per token, rounded up. This is the
 * standard rough factor for English prose mixed with code; it errs on the
 * high side for dense code (which is what we want for an *inline* budget:
 * over-estimating keeps prompts inside the real limit). Documented here so
 * M0/M2 measurements (§19.2) can calibrate it later.
 */
export interface TokenEstimator {
  estimateTokens(text: string): number;
}

/** ~4 chars/token heuristic. Pure, deterministic, platform-independent. */
export const charTokenEstimator: TokenEstimator = {
  estimateTokens(text: string): number {
    if (!text) return 0;
    // Spread by code point so astral characters count once, not twice.
    return Math.max(1, Math.ceil([...text].length / 4));
  },
};

/** Starting guess for the L1 inline budget: ~40k tokens of diff (PRD §9.1). */
export const DEFAULT_INLINE_BUDGET_TOKENS = 40_000;

/** Base-growth batch threshold: ~2k tokens per appended batch (PRD §9.3). */
export const DEFAULT_LOG_BATCH_TOKENS = 2_000;

/** Rebuild when superseded content exceeds this fraction of the base (PRD §9.4). */
export const DEFAULT_REBUILD_SUPERSEDED_RATIO = 0.2;

/** Rebuild when appended log batches exceed this many tokens (PRD §9.4). */
export const DEFAULT_REBUILD_APPENDED_TOKENS = 10_000;
