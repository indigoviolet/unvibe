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

/** True for aborts (`AbortError` DOMExceptions and Node's `AbortError`). */
export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}
