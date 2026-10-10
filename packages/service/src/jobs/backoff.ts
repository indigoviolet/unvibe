/**
 * Exponential back-off with jitter (PRD §12).
 *
 * `delay = min(base * 2^attempt, max) + rand * base`, where `attempt` is
 * 0-based (0 = first retry). Jitter is injected through `rand` so tests
 * are deterministic.
 */
export function computeBackoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  rand: number,
): number {
  const exp = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(exp, maxMs) + rand * baseMs;
}
