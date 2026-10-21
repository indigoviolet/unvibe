/**
 * PATH for the updater's npm (issue #170).
 *
 * mise wraps each Node version's `npm` so a global install runs
 * `mise reshim` afterwards — a bare `mise` call that needs `mise` on PATH.
 * The service (especially login-started, where launchd/systemd give a
 * minimal PATH) and the detached helper must therefore run npm with a
 * PATH that contains mise. First try: find mise without any shell
 * (env vars, well-known install locations — the login-shell PATH missed
 * it on the owner's Mac, where mise is activated only interactively).
 * The login-shell-merged PATH (`diagnostics/path-probe.ts`: probed
 * entries first, then unseen inherited entries) is still merged in, and
 * the interactive-shell PATH is the mise lookup's last resort.
 *
 * Deliberately no reshim-skipping variable: the wrapper honors
 * `MISE_SKIP_RESHIM`, but skipping it would leave mise's shims stale after
 * the install. The right PATH lets the reshim run; a wrapper that still
 * fails after a completed install is classified honestly by the switch
 * core (`update/switch.ts`), which verifies the build in place.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergePaths, probeEffectivePath, resolveInteractivePath } from "../diagnostics/path-probe.js";
import { findMiseBinStatic, findMiseInDirs } from "./mise-find.js";

export { findMiseInDirs, miseStaticCandidates } from "./mise-find.js";

export interface UpdatePathEnvOptions {
  inheritedPath?: string;
  shell?: string;
  timeoutMs?: number;
  candidates?: string[];
  scrubEnv?: NodeJS.ProcessEnv;
  /** Home for the well-known mise locations (tests inject a temp home). */
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  exists?: (p: string) => boolean;
}

export interface FindMiseOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  exists?: (p: string) => boolean;
  inheritedPath?: string;
  /** Interactive-shell PATH when already probed (avoids a second probe). */
  interactivePath?: string | null;
  /** Probe the interactive shell (last resort). Set false to skip it. */
  probeInteractive?: boolean;
  shell?: string;
  timeoutMs?: number;
  candidates?: string[];
}

/** Locate the mise binary. Never throws; null when there is none. */
export async function findMiseBin(opts: FindMiseOptions = {}): Promise<string | null> {
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();
  const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
  try {
    const statik = findMiseBinStatic({ env, homeDir, exists, inheritedPath: opts.inheritedPath });
    if (statik) return statik;
    let interactivePath = opts.interactivePath;
    if (interactivePath === undefined && opts.probeInteractive !== false) {
      const probed = await resolveInteractivePath({
        ...(opts.shell !== undefined ? { shell: opts.shell } : {}),
        timeoutMs: opts.timeoutMs ?? 5000,
        ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
      }).catch(() => null);
      interactivePath = probed?.probedPath ?? null;
    }
    if (interactivePath) return findMiseInDirs(interactivePath.split(path.delimiter), exists);
  } catch {
    // Finding mise must never stop an update.
  }
  return null;
}

/**
 * Login-shell-merged PATH for one npm run, with the mise binary's
 * directory first when mise can be found without a shell (see above).
 * Never throws: when nothing answers, the inherited PATH is returned.
 */
export async function resolveUpdatePathEnv(opts: UpdatePathEnvOptions = {}): Promise<{ PATH: string }> {
  const inheritedPath = opts.inheritedPath ?? process.env.PATH ?? "";
  let base = inheritedPath;
  let probedPath: string | null = null;
  try {
    const found = await probeEffectivePath({
      ...(opts.shell !== undefined ? { shell: opts.shell } : {}),
      timeoutMs: opts.timeoutMs ?? 5000,
      ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
      ...(opts.scrubEnv !== undefined ? { scrubEnv: opts.scrubEnv } : {}),
      inheritedPath,
    });
    if (found && found.effectivePath) {
      base = found.effectivePath;
      probedPath = found.probedPath;
    }
  } catch {
    // A wedged probe must not stop the update; inherit instead.
  }
  const mise = await findMiseBin({
    env: opts.env ?? process.env,
    ...(opts.homeDir !== undefined ? { homeDir: opts.homeDir } : {}),
    ...(opts.exists !== undefined ? { exists: opts.exists } : {}),
    inheritedPath,
    interactivePath: probedPath,
    probeInteractive: probedPath === null,
    ...(opts.shell !== undefined ? { shell: opts.shell } : {}),
    timeoutMs: opts.timeoutMs ?? 5000,
    ...(opts.candidates !== undefined ? { candidates: opts.candidates } : {}),
  });
  if (mise) return { PATH: mergePaths(path.dirname(mise), base) };
  return { PATH: base };
}
