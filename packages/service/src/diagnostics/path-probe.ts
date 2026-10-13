/**
 * Interactive login-shell PATH probing (issue #20).
 *
 * Algorithm (documented here so doctor and service cannot disagree):
 *
 * 1. Capture the inherited PATH (`process.env.PATH`).
 * 2. Build a scrubbed environment containing only what a GUI-launched
 *    process would have: HOME, SHELL, USER, LOGNAME, TMPDIR, LANG, TERM,
 *    plus a system-default PATH (`/usr/bin:/bin:/usr/sbin:/sbin`). In
 *    particular the inherited PATH and any manager env (MISE_*, NVM_*, …)
 *    are NOT passed through, so the answer cannot depend on who started
 *    the process (under `mise run` the right dirs are already in env;
 *    from the helper they are not).
 * 3. For each shell candidate (`$SHELL` first, then zsh/bash/sh/fish
 *    fallbacks that exist and are executable): run it as a login +
 *    interactive shell (`-l -i -c`) so it reads what an interactive
 *    terminal sees (`.zshrc`/`.bashrc`/fish `config.fish`, where mise/nvm
 *    are usually activated). The command prints the PATH wrapped in
 *    delimiters:
 *      `printf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\n" "$PATH"`
 *    (fish: `(string join : $PATH)`). Delimiters make the result robust
 *    to prompts, banners, oh-my-zsh output, `set -u`, or an rc file that
 *    prints garbage to stdout on start — we extract between the markers.
 *    Each probe has a timeout (default 5s) so a slow/hanging rc file can
 *    never hang startup; on timeout/failure we try the next shell.
 * 4. The first shell that answers wins. Effective PATH = probed entries
 *    first, then any inherited entries not already listed (deduplicated),
 *    so nothing already visible is ever lost. We report the shell used,
 *    the probed/inherited/effective PATHs, and the diff both ways.
 *
 * Unit-tested with fake shells/rc files in temp HOMEs (see
 * `test/diagnostics-path.test.ts`): tool only on the interactive PATH, a
 * broken shim first with a working binary later, two managers, rc files
 * that print garbage or hang.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

export const INTERACTIVE_SHELL_TIMEOUT_MS = 5000;
export const SCRUBBED_SYSTEM_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

export const START_MARK = "__UNVIBE_PATH_START__";
export const END_MARK = "__UNVIBE_PATH_END__";

const FALLBACK_SHELLS = ["/bin/zsh", "/bin/bash", "/bin/sh", "/usr/bin/fish", "/bin/fish", "/opt/homebrew/bin/fish"];

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
  return fs.promises.access(file, fs.constants.X_OK).then(() => true).catch(() => false);
}

/** Login + interactive args with delimiters around the value. */
export function interactiveProbeArgs(shell: string): string[] {
  const base = shell.split("/").pop() ?? "";
  if (base === "fish") {
    return ["-l", "-i", "-c", `printf "${START_MARK}%s${END_MARK}\\n" (string join : $PATH)`];
  }
  return ["-l", "-i", "-c", `printf "${START_MARK}%s${END_MARK}\\n" "$PATH"`];
}

/** Scrubbed env: only what a GUI-launched process would have. */
export function buildScrubbedEnv(opts: { home?: string; shell?: string } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const home = opts.home ?? process.env.HOME ?? os.homedir();
  if (home) env.HOME = home;
  const shell = opts.shell ?? process.env.SHELL;
  if (shell) env.SHELL = shell;
  for (const k of ["USER", "LOGNAME"] as const) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  const tmp = process.env.TMPDIR;
  if (tmp !== undefined) env.TMPDIR = tmp;
  env.PATH = SCRUBBED_SYSTEM_PATH;
  env.TERM = "dumb";
  // Intentionally omit everything else (inherited PATH, MISE_*, NVM_*,
  // ASDF_*, HOMEBREW_*, etc.) so the probe cannot depend on the starter.
  return env;
}

function extractDelimitedPath(stdout: string): string | null {
  const re = new RegExp(`${START_MARK}(.*?)${END_MARK}`, "s");
  const m = stdout.match(re);
  if (!m) return null;
  const p = (m[1] ?? "").trim();
  return p || null;
}

function probeOneShell(
  shell: string,
  timeoutMs: number,
  scrubEnv: NodeJS.ProcessEnv,
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(shell, interactiveProbeArgs(shell), { timeout: timeoutMs, env: scrubEnv }, (err, stdout) => {
      if (err && !stdout) return resolve(null);
      try {
        const p = extractDelimitedPath(String(stdout ?? ""));
        resolve(p);
      } catch {
        resolve(null);
      }
    });
  });
}

export interface InteractivePathResult {
  shell: string;
  probedPath: string;
}

/**
 * Probe login+interactive shells from a scrubbed env. Returns the first
 * answer, or null when no shell answered. Never throws, never hangs past
 * `timeoutMs` per shell.
 */
export async function resolveInteractivePath(
  opts: { shell?: string; timeoutMs?: number; scrubEnv?: NodeJS.ProcessEnv; candidates?: string[] } = {},
): Promise<InteractivePathResult | null> {
  const timeoutMs = opts.timeoutMs ?? INTERACTIVE_SHELL_TIMEOUT_MS;
  const scrubEnv = opts.scrubEnv ?? buildScrubbedEnv();
  const candidates = opts.candidates ?? shellCandidates(opts.shell);
  for (const shell of candidates) {
    if (!(await isExecutable(shell))) continue;
    try {
      const probed = await probeOneShell(shell, timeoutMs, scrubEnv);
      if (probed) return { shell, probedPath: probed };
    } catch {
      // try next shell
    }
  }
  return null;
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

export interface ProbedPaths {
  shell: string;
  probedPath: string;
  inheritedPath: string;
  effectivePath: string;
  onlyInProbed: string[];
  onlyInInherited: string[];
}

/** Full PATH picture: probed (scrubbed) + inherited + effective + diffs. */
export async function probeEffectivePath(
  opts: { shell?: string; timeoutMs?: number; scrubEnv?: NodeJS.ProcessEnv; candidates?: string[]; inheritedPath?: string } = {},
): Promise<ProbedPaths | null> {
  const inheritedPath = opts.inheritedPath ?? process.env.PATH ?? "";
  const found = await resolveInteractivePath(opts);
  if (!found) return null;
  const effectivePath = mergePaths(found.probedPath, inheritedPath);
  const probedSet = new Set(found.probedPath.split(":").filter(Boolean));
  const inheritedSet = new Set(inheritedPath.split(":").filter(Boolean));
  const onlyInProbed = [...probedSet].filter((p) => !inheritedSet.has(p));
  const onlyInInherited = [...inheritedSet].filter((p) => !probedSet.has(p));
  return {
    shell: found.shell,
    probedPath: found.probedPath,
    inheritedPath,
    effectivePath,
    onlyInProbed,
    onlyInInherited,
  };
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
  const found = await probeEffectivePath(opts);
  if (!found || found.effectivePath === before) return null;
  process.env.PATH = found.effectivePath;
  return { before, after: found.effectivePath, shell: found.shell };
}
