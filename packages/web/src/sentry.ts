/**
 * Dev-only error reporting to Sentry (issue #29).
 *
 * `__SENTRY_DSN__` is set by `vite.config.ts` from `SENTRY_DSN_REACT`, and
 * only in the Vite dev server: in `vite build` it is `""`, so this branch
 * and the `@sentry/react` import are dropped from the bundle and the built
 * app still contacts nothing but the service (PRD §16 Privacy).
 */
export function initSentry(): void {
  // Keep the import inside this `if`: with the DSN defined as "" the whole
  // block is removed before bundling, so the SDK never enters the module
  // graph (or `web-meta.json`, which feeds the release notices).
  if (__SENTRY_DSN__) {
    void import("@sentry/react")
      .then((Sentry) => {
        Sentry.init({ dsn: __SENTRY_DSN__, environment: "development" });
      })
      .catch(() => {
        // reporting is best-effort
      });
  }
}

/**
 * Report a caught render error (issue #101). Same path as `initSentry`:
 * the import lives inside the DSN check so builds (DSN `""`) drop the
 * whole block and the SDK never enters the bundle. Never throws:
 * callers are error paths that must keep their own behaviour.
 */
export function reportWebError(error: unknown, extra?: Record<string, unknown>): void {
  if (__SENTRY_DSN__) {
    void import("@sentry/react")
      .then((Sentry) => {
        Sentry.captureException(error, extra ? { extra } : undefined);
      })
      .catch(() => {
        // reporting is best-effort
      });
  }
}
