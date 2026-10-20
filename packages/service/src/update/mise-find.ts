/**
 * Finding mise without any shell (issue #170, reopened).
 *
 * mise's npm wrapper calls bare `mise` after a global install; the
 * login-shell PATH missed mise on the owner's Mac (mise is often
 * activated only in the interactive rc file, which a login
 * non-interactive shell never reads). This module checks, in order:
 * `MISE_BIN` / `MISE_INSTALL_PATH` from the env, the well-known install
 * locations (`~/.local/bin`, Homebrew prefixes), then the directories
 * of a given PATH. The interactive-shell PATH is layered on top by
 * `update-env.ts` as a last resort — it is not here because the
 * self-contained update-helper bundle may only contain `src/update/`
 * sources plus node builtins (no shell probe).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Candidate mise binary paths from env vars and install locations. */
export function miseStaticCandidates(env: NodeJS.ProcessEnv, homeDir: string): string[] {
  const out: string[] = [];
  const push = (p: string | undefined): void => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (env.MISE_BIN) {
    push(env.MISE_BIN);
    push(path.join(env.MISE_BIN, "mise"));
  }
  if (env.MISE_INSTALL_PATH) {
    push(path.join(env.MISE_INSTALL_PATH, "mise"));
    push(path.join(env.MISE_INSTALL_PATH, "bin", "mise"));
  }
  if (homeDir) push(path.join(homeDir, ".local", "bin", "mise"));
  push("/opt/homebrew/bin/mise");
  push("/usr/local/bin/mise");
  return out;
}

/** First `mise` executable found in `dirs`, or null. */
export function findMiseInDirs(dirs: string[], exists: (p: string) => boolean): string | null {
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, "mise");
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface FindMiseStaticOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  exists?: (p: string) => boolean;
  inheritedPath?: string;
}

/**
 * Mise from env vars, well-known locations, or the given PATH's
 * directories — no shell involved. Never throws; null when none.
 */
export function findMiseBinStatic(opts: FindMiseStaticOptions = {}): string | null {
  const env = opts.env ?? process.env;
  const homeDir = opts.homeDir ?? os.homedir();
  const exists = opts.exists ?? ((p: string) => fs.existsSync(p));
  try {
    for (const candidate of miseStaticCandidates(env, homeDir)) {
      if (exists(candidate)) return candidate;
    }
    const inheritedPath = opts.inheritedPath ?? env.PATH ?? "";
    return findMiseInDirs(inheritedPath.split(path.delimiter), exists);
  } catch {
    return null;
  }
}
