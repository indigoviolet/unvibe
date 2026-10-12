/**
 * Dev-only error reporting to Sentry (issue #29).
 *
 * Off unless `SENTRY_DSN_SERVICE` is in the env (the 1Password Environment
 * provides it through `mise run op`; see DEVELOPMENT.md). `@sentry/node` is
 * a devDependency, external to the service bundle and loaded only here, so
 * an installed release has neither the DSN nor the SDK and the service
 * still contacts nothing but 127.0.0.1 (PRD §16 Privacy).
 */

/** The slice of `@sentry/node` this module uses (tests inject a fake). */
export interface SentrySdk {
  init(options: { dsn: string; environment: string; integrations: { name: string }[] }): unknown;
  onUnhandledRejectionIntegration(options: { mode: "strict" }): { name: string };
  captureException(err: unknown, hint?: { extra?: Record<string, unknown> }): unknown;
  close(timeoutMs?: number): PromiseLike<boolean>;
}

export interface ErrorReporter {
  capture(err: unknown, extra?: Record<string, unknown>): void;
  /** Flush pending events (bounded) before the process exits. */
  close(): Promise<void>;
}

const FLUSH_TIMEOUT_MS = 2000;

let active: ErrorReporter | null = null;

/**
 * Report an error to Sentry when it is on; a no-op otherwise. Never throws:
 * callers are error paths that must keep their own behaviour.
 */
export function reportError(err: unknown, extra?: Record<string, unknown>): void {
  try {
    active?.capture(err, extra);
  } catch {
    // reporting is best-effort
  }
}

/**
 * Start Sentry when the DSN is set. Returns `null` (and stays off) with no
 * DSN, or when the SDK is not installed (a release install that happens to
 * have the variable set).
 */
export async function initSentry(
  env: NodeJS.ProcessEnv = process.env,
  load: () => Promise<SentrySdk> = () => import("@sentry/node"),
): Promise<ErrorReporter | null> {
  const dsn = env.SENTRY_DSN_SERVICE?.trim();
  if (!dsn) return null;
  let sdk: SentrySdk;
  try {
    sdk = await load();
  } catch {
    console.warn("SENTRY_DSN_SERVICE is set but @sentry/node is not installed; error reporting is off");
    return null;
  }
  sdk.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "development",
    // The SDK's default ("warn") keeps the process alive after an unhandled
    // rejection. "strict" reports it and then exits, as Node does without
    // Sentry, so dev fails the same way an installed service does.
    integrations: [sdk.onUnhandledRejectionIntegration({ mode: "strict" })],
  });
  active = {
    capture: (err, extra) => {
      sdk.captureException(err, extra ? { extra } : undefined);
    },
    close: async () => {
      active = null;
      try {
        await sdk.close(FLUSH_TIMEOUT_MS);
      } catch {
        // best-effort flush
      }
    },
  };
  return active;
}
