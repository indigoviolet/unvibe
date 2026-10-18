/**
 * Retryable failures (PRD §12 "back off on rate limits").
 *
 * A job's `run` function throws {@link RetryableError} to ask the queue for
 * exponential back-off with jitter instead of a terminal `error` state.
 * Callers that drive an `AgentRunner` translate retryable agent `error`
 * events into this error; anything else thrown is terminal.
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * A turn failed on a fact the service observes: the answer was empty
 * (issues #51, #180 — the reply's wording is never judged). Terminal
 * (never retried): the reply is deterministic for the session. Action
 * handlers clear streamed partials on this error so no card keeps a
 * half-finished answer; the message lands in the job error on the
 * Debug page.
 */
export class DegradedTurnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DegradedTurnError";
  }
}

/**
 * A review-MCP call observably failed to connect mid-turn (#51, #180):
 * the failure may be transient, so the caller retries the turn once on
 * a fresh session. A second failure is terminal. Subclasses
 * DegradedTurnError so partial-clearing applies either way.
 */
export class DegradedConnError extends DegradedTurnError {
  constructor(message: string) {
    super(message);
    this.name = "DegradedConnError";
  }
}

/**
 * Partial usage of a turn that ended early (issue #151): a streaming
 * collector attaches the usage it already counted (and the text it
 * already streamed) to the error it throws, so the job layer can record
 * it instead of losing the tokens. `partialUsageReported` is set by
 * whoever records it, so a rethrow never double-counts.
 */
export interface PartialUsageCarrier {
  partialUsage?: { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number };
  partialText?: string;
  partialUsageReported?: boolean;
}

export function attachPartialUsage(
  err: unknown,
  usage: { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number },
  text?: string,
): Error {
  const e = (err instanceof Error ? err : new Error(String(err))) as Error & PartialUsageCarrier;
  e.partialUsage = { ...usage };
  if (text !== undefined) e.partialText = text;
  return e;
}

export function partialUsageOf(err: unknown): PartialUsageCarrier["partialUsage"] {
  if (typeof err !== "object" || err === null) return undefined;
  const u = (err as PartialUsageCarrier).partialUsage;
  if (!u || (u.inputTokens === 0 && u.cachedReadTokens === 0 && u.cachedWriteTokens === 0 && u.outputTokens === 0)) return undefined;
  return u;
}

/** True for aborts (`AbortError` DOMExceptions and Node's `AbortError`). */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
