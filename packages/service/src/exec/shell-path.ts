/**
 * macOS gotcha (PRD §14): apps opened from Finder don't inherit the shell's
 * PATH. On startup the service reads it from a login+interactive shell so
 * it can find `gh`, `git`, `claude`, `codex` and mise-installed tools.
 *
 * This module is a thin compat wrapper over the shared diagnostics PATH
 * probe (`../diagnostics/path-probe.js`), so `unvibe doctor` and the
 * running service cannot disagree. See that module for the full algorithm:
 * scrubbed env (only what a GUI process would have), login+interactive
 * shells (so `.zshrc`/`.bashrc`/fish config are read), delimiters around
 * the value (robust to prompts/banners/garbage), per-shell timeout with a
 * fallback chain. The resolved probed PATH is *merged* with the inherited
 * PATH (probed entries first, inherited extras appended) so nothing
 * already visible is ever lost.
 */
import {
  INTERACTIVE_SHELL_TIMEOUT_MS,
  mergePaths as mergePathsNew,
  probeEffectivePath,
} from "../diagnostics/path-probe.js";

export const LOGIN_SHELL_TIMEOUT_MS = INTERACTIVE_SHELL_TIMEOUT_MS;

export interface LoginShellPath {
  /** The raw PATH printed by the login shell. */
  loginPath: string;
  /** Which shell answered. */
  shell: string;
  /** Login entries first, then any inherited entries not already listed. */
  merged: string;
}

/** Deduplicated merge: `first` wins order, then unseen entries of `second`. */
export function mergePaths(first: string, second: string): string {
  return mergePathsNew(first, second);
}

/**
 * Probe the login shell for PATH. Returns null when no shell answered
 * (caller keeps the inherited PATH). Never throws, never hangs past
 * `timeoutMs` per shell.
 */
export async function resolveLoginShellPath(
  opts: { shell?: string; timeoutMs?: number } = {},
): Promise<LoginShellPath | null> {
  const timeoutMs = opts.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS;
  try {
    const probed = await probeEffectivePath({ shell: opts.shell, timeoutMs });
    if (!probed) return null;
    return { loginPath: probed.probedPath, shell: probed.shell, merged: probed.effectivePath };
  } catch {
    return null;
  }
}

/**
 * Best-effort login-shell PATH; falls back to the current PATH.
 * Kept for backwards compatibility; new code prefers
 * {@link resolveLoginShellPath} / {@link applyLoginShellPath}.
 */
export async function resolvePathFromLoginShell(): Promise<string> {
  const found = await resolveLoginShellPath();
  return found ? found.merged : (process.env.PATH ?? "");
}

/**
 * Apply the login-shell PATH to this process (before anything spawns
 * git/gh/agent adapters). Returns the detail, or null when nothing
 * changed. Never throws.
 */
export async function applyLoginShellPath(
  opts: { shell?: string; timeoutMs?: number } = {},
): Promise<{ before: string; after: string; shell: string } | null> {
  const before = process.env.PATH ?? "";
  const found = await resolveLoginShellPath(opts);
  if (!found || found.merged === before) return null;
  process.env.PATH = found.merged;
  return { before, after: found.merged, shell: found.shell };
}
