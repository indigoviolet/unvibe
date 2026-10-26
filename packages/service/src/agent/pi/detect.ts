/**
 * pi detection (issue #279).
 *
 * Pi is never a dependency: Unvibe only offers the `pi` provider when a
 * `pi` binary is found. Detection is the binary only (PATH lookup, exactly
 * like the agent CLIs), plus an explicit `UNVIBE_PI_BIN` override for
 * unusual installs. Login is pi's business — detection never reads
 * `~/.pi` or any credential; readiness/Doctor report the login state
 * separately through pi's own `auth check`.
 */
import fs from "node:fs";
import path from "node:path";

export const PI_PROVIDER = "pi";

/** Explicit Unvibe override for the pi executable (unusual installs). */
export const PI_BIN_ENV = "UNVIBE_PI_BIN";

function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Minimal `command -v pi` over a PATH value (mirrors readiness/checks.ts). */
export function findPiOnPath(pathValue: string): string | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, "pi");
    try {
      if (isExecutableFile(full)) return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

export interface ResolvedPiBin {
  /** Absolute path to the executable to run. */
  path: string;
  /** Where it came from (for doctor/readiness display). */
  source: string;
}

/**
 * Resolve the pi executable. Returns null when not found (caller reports
 * the install hint). Never throws. `env` and `pathValue` are injectable
 * for tests.
 */
export function resolvePiBin(
  opts: { env?: NodeJS.ProcessEnv; pathValue?: string } = {},
): ResolvedPiBin | null {
  const env = opts.env ?? process.env;
  const pathValue = opts.pathValue ?? env.PATH ?? "";

  const override = (env[PI_BIN_ENV] ?? "").trim();
  if (override) {
    if (isExecutableFile(override)) {
      return { path: override, source: `env ${PI_BIN_ENV}` };
    }
    // Explicit override pointing nowhere: report it anyway so the error
    // names the bad override instead of silently falling through.
    return { path: override, source: `env ${PI_BIN_ENV} (missing)` };
  }

  const found = findPiOnPath(pathValue);
  if (found) return { path: found, source: "login-shell PATH" };
  return null;
}

/** True when the pi provider can be offered (binary present and runnable). */
export function isPiAvailable(
  opts: { env?: NodeJS.ProcessEnv; pathValue?: string } = {},
): boolean {
  const resolved = resolvePiBin(opts);
  if (!resolved) return false;
  if (resolved.source.endsWith("(missing)")) return false;
  return isExecutableFile(resolved.path);
}

/** Plain-words install hint used when pi is absent. */
export function piInstallHint(): string {
  return "Install Pi (https://pi.dev) and ensure `pi` is on your login-shell PATH; Unvibe does not install it for you.";
}
