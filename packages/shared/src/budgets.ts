/**
 * Prompt and pipeline budgets shared by the service and the web (issue
 * #107). Single source of truth: both sides import these instead of
 * duplicating the numbers.
 */

/**
 * Hunk-pass fan-out limit: reviews with more hunks than this skip the
 * per-hunk summarise fan-out; summaries go on demand instead (the diff
 * view's per-hunk Summarize action, Fold-all exclusions below). At or
 * under it behaviour is unchanged.
 */
export const HUNK_PASS_FANOUT_LIMIT = 500;

/**
 * Plotline assign-step cap (issue #169): when the reader lands on a
 * degraded rung (files-only or counts-only) with more unassigned hunks
 * than this, the follow-up assign step is skipped and the rest read as
 * "other" — classifying thousands of hunks would cost a second hunk
 * pass. At or under it one small-model job assigns the rest.
 */
export const PLOTLINE_ASSIGN_CAP = 200;

/**
 * Hard cap for one L1 prompt text in tokens (issue #107). No
 * context-window table lives in the codebase (models are known only by
 * id), so this is conservative: 80k tokens (~320KB) sits well under the
 * six-figure-token windows of the Claude/Codex-class models this app
 * drives, leaving room for the system prompt, tool specs, log batches
 * and the reply.
 */
export const BASE_PROMPT_CAP_TOKENS = 80_000;
