/**
 * Error classification for AgentEvent error reporting.
 *
 * Retryable: rate limits, overload, adapter crash / process exit, transient
 * network. Everything else (auth, invalid params, unknown session after
 * close) is non-retryable so callers do not spin.
 */

const RETRYABLE_PATTERNS = [
  /rate.?limit/i,
  /\b429\b/,
  /overloaded/i,
  /\b529\b/,
  /\b503\b/,
  /service unavailable/i,
  /temporar/i,
  /try again/i,
  /quota.*exceed/i,
  /quota.*exhaust/i,
  /econnreset/i,
  /epipe/i,
  /etimedout/i,
  /timed out/i,
  /timeout/i,
  /adapter (crash|crashed|exited|died|closed)/i,
  /process (exited|closed|died|terminated)/i,
  /connection (closed|lost|reset)/i,
  /session not found/i, // Claude fork-before-resume ordering; caller retries after resume
  /internal error/i, // ACP wraps most failures as -32603; details disambiguate below
];

const NON_RETRYABLE_PATTERNS = [
  /auth/i,
  /unauthori[sz]ed/i,
  /invalid (params|model|session|request)/i,
  /not authenticated/i,
  /permission denied/i,
  /not found.*model/i,
  /unknown model/i,
  // Issue #107: a prompt that does not fit is deterministic, not
  // transient — retrying loops forever on the provider's "Internal error:
  // Prompt is too long". (Explicit non-retryable wins over the generic
  // "internal error" retryable pattern below.)
  /prompt (is )?too (long|large)/i,
  /input .*too (long|large)/i,
];

export function isRetryableError(err: unknown): boolean {
  const msg = errorMessage(err);
  // Explicit non-retryable wins (e.g. "auth required" also matches "internal error" wrappers).
  for (const re of NON_RETRYABLE_PATTERNS) {
    if (re.test(msg)) {
      // "Session not found" is retryable (fork ordering); don't let generic
      // "not found" rules win. The explicit check above is for models/params.
      if (/session not found/i.test(msg)) return true;
      return false;
    }
  }
  for (const re of RETRYABLE_PATTERNS) {
    if (re.test(msg)) return true;
  }
  // ACP JSON-RPC error codes: -32603 is generic; look at details when present.
  const code = errorCode(err);
  if (code === -32603) {
    // Generic internal error with no known-transient detail: not retryable
    // by default, except the fork-ordering case handled above.
    return /session not found/i.test(msg);
  }
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const data = (err as { data?: unknown }).data;
    const base = err.message;
    if (data !== undefined) {
      try {
        return `${base} :: ${JSON.stringify(data).slice(0, 500)}`;
      } catch {
        return base;
      }
    }
    return base;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err).slice(0, 1000);
  } catch {
    return String(err);
  }
}

function errorCode(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "number") return c;
    const data = (err as { data?: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const dc = (data as { code?: unknown }).code;
      if (typeof dc === "number") return dc;
    }
  }
  return undefined;
}

/** Cancellation is signalled via stopReason, never as an error event. */
export function isCancelError(err: unknown): boolean {
  return /cancelled/i.test(errorMessage(err));
}
