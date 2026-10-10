/**
 * Local checkout detection (start page, PRD §4.2 "finds local checkouts").
 *
 * - `isGitCheckout` validates that a path is a git checkout
 *   (`git rev-parse --git-dir`).
 * - Owner/name come from the `origin` remote when it points at GitHub;
 *   otherwise the checkout is `local/<dirname>`.
 * - `detectCheckouts` lists checkouts under a few configurable roots
 *   (default `~/src`, `~/dev`, …; override with `UNVIBE_REPO_ROOTS`,
 *   `path.delimiter`-separated) without scanning the whole disk: at most
 *   two levels deep, `.git` presence checked via the filesystem first (no
 *   git spawn per directory), heavy dirs skipped.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CommandRunner } from "../exec/index.js";

export interface DetectedCheckout {
  path: string;
  owner: string;
  name: string;
}

/** True when `dir` is a git checkout (worktrees use a `.git` file). */
export function hasGitDir(dir: string): boolean {
  try {
    fs.statSync(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Validate via git (used by POST /api/repos; detection uses `hasGitDir`). */
export async function isGitCheckout(runner: CommandRunner, dir: string): Promise<boolean> {
  try {
    const res = await runner.run("git", { args: ["-C", dir, "rev-parse", "--git-dir"], cwd: dir });
    return res.code === 0;
  } catch {
    return false;
  }
}

/** `origin` remote URL, or null when there is none. */
export async function remoteUrl(runner: CommandRunner, dir: string): Promise<string | null> {
  try {
    const res = await runner.run("git", { args: ["remote", "get-url", "origin"], cwd: dir });
    if (res.code !== 0) return null;
    const url = res.stdout.trim().split("\n")[0].trim();
    return url || null;
  } catch {
    return null;
  }
}

/**
 * `owner`/`name` from a remote URL. Understands scp-like
 * (`git@github.com:o/r.git`) and URL (`https://github.com/o/r`) forms on
 * any host; anything else → null (the caller falls back to
 * `local/<dirname>`).
 */
export function parseGitHubRemote(url: string): { owner: string; name: string } | null {
  const cleaned = url.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const scp = cleaned.match(/^[\w.-]+@[^:]+:(.+)$/);
  let pathPart: string | undefined;
  if (scp) {
    pathPart = scp[1];
  } else {
    const m = cleaned.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i);
    if (!m) return null;
    pathPart = m[1];
  }
  const segments = (pathPart ?? "").split("/").filter(Boolean);
  if (segments.length < 2) return null;
  const owner = segments[segments.length - 2];
  const name = segments[segments.length - 1];
  if (!owner || !name) return null;
  return { owner, name };
}

/** Owner/name for a checkout: GitHub remote or `local/<dirname>`. */
export async function deriveIdentity(
  runner: CommandRunner,
  dir: string,
): Promise<{ owner: string; name: string }> {
  const remote = await remoteUrl(runner, dir);
  if (remote) {
    const parsed = parseGitHubRemote(remote);
    if (parsed) return parsed;
  }
  return { owner: "local", name: path.basename(dir) };
}

const DEFAULT_ROOT_NAMES = ["src", "dev", "code", "work", "projects", "repos", "Developer", "git"];

/** Configured roots: `UNVIBE_REPO_ROOTS` or existing `~/<name>` defaults. */
export function resolveRepoRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.UNVIBE_REPO_ROOTS;
  if (configured !== undefined) {
    return configured
      .split(path.delimiter)
      .map((r) => r.trim())
      .filter((r) => r !== "");
  }
  const home = os.homedir();
  return DEFAULT_ROOT_NAMES.map((n) => path.join(home, n)).filter((d) => {
    try {
      return fs.statSync(d).isDirectory();
    } catch {
      return false;
    }
  });
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".cache",
  "Library",
  "dist",
  "build",
  "target",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  ".git",
]);

function childDirs(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(e.name)) continue;
    out.push(path.join(dir, e.name));
  }
  return out;
}

/**
 * Find checkouts under `roots`, max two levels deep, `.git`-gated before
 * any git spawn. Returns absolute paths (deduplicated, sorted).
 */
export function detectCheckouts(roots: string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(root);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (hasGitDir(root)) {
      found.add(root);
      continue;
    }
    for (const child of childDirs(root)) {
      if (hasGitDir(child)) {
        found.add(child);
        continue; // don't descend into a repo's subdirs
      }
      for (const grandchild of childDirs(child)) {
        if (hasGitDir(grandchild)) found.add(grandchild);
      }
    }
  }
  return [...found].sort();
}
