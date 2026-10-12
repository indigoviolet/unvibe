/**
 * D2 binary discovery (docs/d2-diagrams.md).
 *
 * Unvibe renders D2 diagrams service-side with the user's installed `d2`
 * binary — never a bundled copy. Resolution order:
 * 1. `UNVIBE_D2_BIN` (explicit override for unusual installs),
 * 2. `d2` found on the login-shell PATH (the normal case).
 *
 * Minimum version is the version the spike verified (v0.9.0). Readiness
 * reports a warning (not an error) when missing/too old; doctor prints the
 * install hints. Nothing else in a review may fail because `d2` is absent:
 * diagram blocks get `render.status: "unavailable"`.
 */
import fs from "node:fs";
import path from "node:path";
import { D2_MIN_VERSION } from "@unvibe/shared";

export const D2_MIN = D2_MIN_VERSION;
export const D2_ENV_OVERRIDE = "UNVIBE_D2_BIN";

export const D2_INSTALL_HINTS = [
  "macOS (brew): `brew install d2`",
  "Linux/macOS (official script): `curl -fsSL https://d2lang.com/install.sh | sh -s --` (see https://d2lang.com/tour/install)",
  "via mise: `mise use -g d2` (installs a supported version)",
].join("\n");

export function d2InstallHint(): string {
  return `Install d2 (${D2_MIN}+) and ensure it is on your login-shell PATH; Unvibe does not install it for you.\n${D2_INSTALL_HINTS}`;
}

export function d2UpdateHint(found: string): string {
  return `d2 ${found} found; Unvibe needs ≥ ${D2_MIN} (the oldest version Unvibe works with). Update d2, then Re-check.`;
}

export function d2MissingMessage(): string {
  return `d2 not found on your login-shell PATH. ${d2InstallHint()}`;
}

/** True when the path exists and is executable (file). */
function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Minimal `command -v` over a PATH value (mirrors exec/agent-bins.ts). */
export function findD2OnPath(pathValue: string): string | null {
  const dirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const full = path.join(dir, "d2");
    try {
      if (isExecutableFile(full)) return full;
    } catch {
      // keep looking
    }
  }
  return null;
}

export interface ResolvedD2Bin {
  /** Absolute path to the executable to run. */
  path: string;
  /** Where it came from (for doctor/readiness display). */
  source: string;
}

/**
 * Resolve the `d2` executable. Returns null when not found (caller reports
 * the install hint). Never throws. `env` and `pathValue` are injectable for
 * tests.
 */
export function resolveD2Bin(
  opts: { env?: NodeJS.ProcessEnv; pathValue?: string } = {},
): ResolvedD2Bin | null {
  const env = opts.env ?? process.env;
  const pathValue = opts.pathValue ?? env.PATH ?? "";

  const override = (env[D2_ENV_OVERRIDE] ?? "").trim();
  if (override) {
    if (isExecutableFile(override)) {
      return { path: override, source: `env ${D2_ENV_OVERRIDE}` };
    }
    return { path: override, source: `env ${D2_ENV_OVERRIDE} (missing)` };
  }

  const found = findD2OnPath(pathValue);
  if (found) return { path: found, source: "login-shell PATH" };
  return null;
}

/** Extract the first `x.y.z` from `d2 version` output. */
export function parseD2Version(output: string): string | null {
  const m = output.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Compare dotted versions: -1 / 0 / 1. Non-numeric parts compare as 0. */
export function compareD2Versions(a: string, b: string): number {
  const pa = a.split(".").map((s) => Number(s) || 0);
  const pb = b.split(".").map((s) => Number(s) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** True when `found` meets the minimum D2 version. */
export function meetsD2MinVersion(found: string): boolean {
  return compareD2Versions(found, D2_MIN) >= 0;
}
