/**
 * Base growth (PRD §9.3): append log batches to the base session as new
 * turns once ~2k tokens have accumulated (threshold from settings:
 * `logBatchTokens`), so the cached prefix stays valid and later forks see
 * them.
 *
 * Forks taken *before* a batch get those entries through their change list
 * instead: the base remembers its log seq (`logSeq`), each fork records the
 * seq it saw, and `filterChangeList` serves everything newer. No duplicates
 * (a fork taken after the batch starts past it), nothing missed (a fork
 * taken before gets the batch as a change list).
 */
import type { LogEntry } from "@unvibe/shared";
import { charTokenEstimator, type TokenEstimator } from "../context/tokens.js";
import { batchLogEntries, formatLogBatch, formatLogEntry } from "../context/log.js";

export interface GrowthPlan {
  /** Batches ready to append (each becomes one new turn on the base). */
  batches: LogEntry[][];
  /** Entries still below the threshold (kept for the next turn). */
  pending: LogEntry[];
  /** Token estimate of the pending tail. */
  pendingTokens: number;
}

/**
 * Split the not-yet-appended tail of the log into ready batches + pending.
 * Pure: `appendedThroughSeq` is the base's `logSeq` (entries at or below it
 * are already in the base). Ready batches each fit in `batchTokens`.
 */
export function planGrowth(
  log: LogEntry[],
  appendedThroughSeq: number,
  opts: { batchTokens: number; estimator?: TokenEstimator } = { batchTokens: 2000 },
): GrowthPlan {
  const estimator = opts.estimator ?? charTokenEstimator;
  const tail = log.filter((e) => e.seq > appendedThroughSeq);
  const batches = batchLogEntries(tail, { estimator, batchTokens: opts.batchTokens });
  if (batches.length === 0) return { batches: [], pending: [], pendingTokens: 0 };
  // Greedy batching overshoots only on single oversized entries: every batch
  // but possibly the last is "full". Hold the last batch back while it is
  // under the threshold so small trickles accumulate instead of churning the
  // base with tiny turns.
  const last = batches[batches.length - 1];
  const lastTokens = last.reduce((n, e) => n + estimator.estimateTokens(formatLogEntry(e)), 0);
  if (batches.length === 1 && lastTokens < opts.batchTokens) {
    // Single under-threshold batch: not ready yet — it accumulates until it
    // reaches the threshold (or the caller forces it with `forceBatches`).
    // (A single *over-threshold* batch holds one oversized entry and is
    // ready immediately; it falls through below.)
    return { batches: [], pending: tail, pendingTokens: lastTokens };
  }
  if (batches.length === 1) return { batches, pending: [], pendingTokens: 0 };
  const ready = batches.slice(0, -1);
  return { batches: ready, pending: last, pendingTokens: lastTokens };
}

/**
 * Force-append everything past `appendedThroughSeq` as batches regardless of
 * the threshold (idle flush, shutdown, tests). Pure.
 */
export function forceBatches(
  log: LogEntry[],
  appendedThroughSeq: number,
  opts: { batchTokens: number; estimator?: TokenEstimator } = { batchTokens: 2000 },
): LogEntry[][] {
  const tail = log.filter((e) => e.seq > appendedThroughSeq);
  return batchLogEntries(tail, { estimator: opts.estimator ?? charTokenEstimator, batchTokens: opts.batchTokens });
}

/** Render one batch as the text of a new turn on the base session. */
export function renderBatchTurn(entries: LogEntry[]): { seq: number; text: string } {
  return { seq: entries[entries.length - 1].seq, text: formatLogBatch(entries) };
}
