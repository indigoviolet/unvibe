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
    // Count by code point so astral characters count once, not twice.
    return Math.max(1, Math.ceil(countCodePoints(text) / 4));
  },
};

/**
 * Code-point length without materialising an array (issue #107): spreading
 * (`[...text].length`) allocates one array entry per character — hundreds
 * of megabytes per call on a tens-of-megabytes diff the ladder estimates
 * several times. This loop counts identically (a lead surrogate followed
 * by a trail surrogate is one code point) with O(1) memory.
 */
export function countCodePoints(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}
import { BASE_PROMPT_CAP_TOKENS, HUNK_PASS_FANOUT_LIMIT } from "@unvibe/shared";

/** Starting guess for the L1 inline budget: ~40k tokens of diff (PRD §9.1). */
export const DEFAULT_INLINE_BUDGET_TOKENS = 40_000;

/**
 * Hard cap for one L1 prompt text in tokens (issue #107).
 *
 * Unlike the inline budget above this is deliberately NOT a setting: a
 * user raising `inlineBudgetTokens` must never reintroduce the provider
 * "Prompt is too long" failure the ladder exists to prevent. Single
 * source of truth in `@unvibe/shared`; this alias keeps existing imports
 * working.
 *
 * No context-window table lives in the codebase (models are known only by
 * id in `settings/models.ts`), so this is a conservative constant: 80k
 * tokens (~320KB) sits well under the six-figure-token windows of the
 * Claude/Codex-class models this app drives, leaving room for the system
 * prompt, tool specs, log batches and the reply.
 */
export const DEFAULT_BASE_PROMPT_CAP_TOKENS = BASE_PROMPT_CAP_TOKENS;

/**
 * Hunk-pass fan-out limit (issue #107): reviews with more hunks than this
 * skip the per-hunk summarise fan-out; summaries go on demand instead
 * (`POST …/hunks/:hash/summarize`, Fold-all, guide-cited hunks). At or
 * under it behaviour is unchanged. Kept a plain constant next to the
 * other budgets (not a setting) so queue growth stays bounded no matter
 * what the user tunes. Single source of truth in `@unvibe/shared` — the
 * web reads the same number instead of duplicating it.
 */
export const DEFAULT_HUNK_PASS_FANOUT_LIMIT = HUNK_PASS_FANOUT_LIMIT;

/**
 * Floor for a leftover cap share (issue #107): when hunk summaries (or
 * changed hunks) get only what is left of the cap after the rest of the
 * message, at least this many tokens remain, so the counts line and its
 * notice always fit.
 */
export const DEFAULT_LEFTOVER_FLOOR_TOKENS = 500;

/** Base-growth batch threshold: ~2k tokens per appended batch (PRD §9.3). */
export const DEFAULT_LOG_BATCH_TOKENS = 2_000;

/** Rebuild when superseded content exceeds this fraction of the base (PRD §9.4). */
export const DEFAULT_REBUILD_SUPERSEDED_RATIO = 0.2;

/** Rebuild when appended log batches exceed this many tokens (PRD §9.4). */
export const DEFAULT_REBUILD_APPENDED_TOKENS = 10_000;
