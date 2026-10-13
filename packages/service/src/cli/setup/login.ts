/**
 * Start-at-login units (issue #108, PRD §14).
 *
 * `unvibe setup` writes one of these alongside the `unvibe://` handler so
 * the service is already running when the browser opens the bookmark —
 * nothing in the browser can start it. macOS gets a launchd agent,
 * Linux a systemd user unit. Both run the installed CLI's
 * `start --foreground` with the port and data dir baked in at setup time
 * (re-run setup after changing them), and both set `UNVIBE_IDLE_MS=0`: a
 * login-started service never idle-exits. A manually started service
 * keeps the normal idle exit.
 *
 * Only `UNVIBE_PORT`, `UNVIBE_DATA_DIR` and `UNVIBE_IDLE_MS` are baked in —
 * never the whole environment, and never `GITHUB_TOKEN` (PRD §15: `gh`
 * must run with it unset). `PATH` is deliberately not baked in either:
 * the service repairs it from the login shell at every boot
 * (`diagnostics/path-probe.ts`, headless-safe), so a stale PATH cannot
 * strand a login start.
 *
 * Identity, paths, content builders and management live in
 * `update/service-manager.ts` — the self-contained update-helper bundle
 * imports them from there (issue #36 containment), so this module only
 * re-exports them for the setup-facing imports.
 */

export {
  LAUNCHD_LABEL,
  LAUNCHD_PLIST_FILENAME,
  launchdPlistContent,
  launchdPlistPath,
  type LoginUnitOpts,
  SYSTEMD_UNIT_NAME,
  systemdEnv,
  systemdQuote,
  systemdUnitContent,
  systemdUnitPath,
} from "../../update/service-manager.js";
