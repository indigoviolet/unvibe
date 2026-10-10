/**
 * macOS gotcha (PRD §14): apps opened from Finder don't inherit the shell's
 * PATH. On startup the service reads it from a login shell so it can find
 * `gh`, `git`, `claude`, `codex` and mise-installed tools.
 *
 * Handles zsh (the macOS default), bash, sh and fish: the login shell is
 * probed via the user's `$SHELL` first, then common fallbacks. Each probe
 * has a timeout so a slow dotfile can never hang startup. The resolved
 * login PATH is *merged* with the inherited PATH (login entries first,
 * inherited extras appended) so nothing already visible is ever lost.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";

export const LOGIN_SHELL_TIMEOUT_MS = 10_000;

const FALLBACK_SHELLS = ["/bin/zsh", "/bin/bash", "/bin/sh"];

function shellCandidates(explicit?: string): string[] {
  const list: string[] = [];
  const push = (s: string | undefined): void => {
    if (s && !list.includes(s)) list.push(s);
  };
  push(explicit ?? process.env.SHELL);
  for (const s of FALLBACK_SHELLS) push(s);
  return list;
}

function isExecutable(file: string): Promise<boolean> {
  return fs.promises
    .access(file, fs.constants.X_OK)
    .then(() => true)
    .catch(() => false);
}

/** fish needs `-l -c` as separate words; POSIX shells take `-lc`. */
function probeArgs(shell: string): string[] {
  const base = shell.split("/").pop() ?? "";
  if (base === "fish") return ["-l", "-c", "echo $PATH"];
  return ["-lc", "echo $PATH"];
}

function echoPathWith(shell: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(shell, probeArgs(shell), { timeout: timeoutMs }, (err, stdout) => {
      if (err) return resolve(null);
      const p = stdout.trim();
      resolve(p || null);
    });
  });
}

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
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of [...first.split(":"), ...second.split(":")]) {
    if (part === "" || seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out.join(":");
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
  for (const shell of shellCandidates(opts.shell)) {
    if (!(await isExecutable(shell))) continue;
    try {
      const loginPath = await echoPathWith(shell, timeoutMs);
      if (loginPath) {
        return { loginPath, shell, merged: mergePaths(loginPath, process.env.PATH ?? "") };
      }
    } catch {
      // try the next shell
    }
  }
  return null;
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
