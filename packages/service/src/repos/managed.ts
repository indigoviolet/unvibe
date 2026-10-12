/**
 * Managed clones (#27): repos Unvibe cloned itself into its own storage.
 *
 * - Layout: `<dataDir>/repos/<owner>/<name>` (beside the managed worktrees,
 *   never inside a user directory). Owner/name come from the shared URL
 *   parser, whose grammar makes them safe as path segments and as command
 *   arguments; `managedRepoDir` re-checks depth as defence in depth.
 * - Clone: `gh repo clone <owner>/<name> <dir> -- --filter=blob:none`
 *   (blobless, not shallow: ingest needs the commit graph back to the merge
 *   base). `GITHUB_TOKEN` stays unset via the `runGh` wrapper (PRD §15) so
 *   private repos use the existing `gh` login.
 * - Crash safety: clone into a hidden temp sibling, rename on success, rm
 *   the temp on failure — a failed or interrupted clone never leaves a
 *   half-clone at the final path. Adoption re-validates (checkout + matching
 *   origin + resolvable HEAD) so a stale half-clone is re-cloned, while a
 *   directory that is not the expected clone is never touched.
 * - Concurrency: in-process adds of the same URL share one in-flight clone.
 * - Refresh: `git fetch origin` before changes listings and ingest/refresh,
 *   best effort with a short freshness window + in-flight coalescing (the
 *   start page fires three `changes` calls per repo at once). Failures
 *   degrade to stale data with a note, never a failed listing.
 * - Remove: deletion is guarded to inside `<dataDir>/repos` and only ever
 *   runs for clones Unvibe made — user checkouts are only forgotten.
 *
 * Progress reporting choice: `POST /api/repos` with a URL is synchronous
 * (blobless clones hold the loopback request briefly). The service's
 * progress channel (`EventBus`) is scoped per review, and the job queue is
 * scoped to agent pipeline work — minting a repo-scoped job type for a
 * seconds-long clone would add a channel the web has no UI for yet. The
 * later web step can add one if clones prove slow in practice.
 *
 * All commands go through the injectable `CommandRunner` (tests stub
 * `gh`/`git`; never a real clone over the network).
 */
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { Repo } from "@unvibe/shared";
import { parseGitHubRemote } from "./detect.js";
import type { CommandRunner, RunResult } from "../exec/index.js";
import { runGh } from "../exec/index.js";

/** `<dataDir>/repos`: every managed clone lives under here, nothing else. */
export function managedReposRoot(dataDir: string): string {
  return path.join(dataDir, "repos");
}

/** `<dataDir>/repos/<owner>/<name>` for a validated owner/name pair. */
export function managedRepoDir(dataDir: string, owner: string, name: string): string {
  if (!owner || !name || owner.includes("/") || owner.includes(path.sep) || name.includes("/") || name.includes(path.sep)) {
    throw new Error(`refusing unsafe managed path for "${owner}/${name}"`);
  }
  return path.join(managedReposRoot(dataDir), owner, name);
}

/** True when `child` resolves inside `parent` (both resolved first). */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Throw unless `localPath` is a repo directory inside `<dataDir>/repos`
 * (at least `<owner>/<name>` deep, so the root itself can never qualify).
 * The remove path calls this before any `rm`.
 */
export function assertManagedPath(dataDir: string, localPath: string): string {
  const resolved = path.resolve(localPath);
  const rel = path.relative(path.resolve(managedReposRoot(dataDir)), resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).length < 2) {
    throw new Error(`refusing to delete outside managed clones: ${localPath}`);
  }
  return resolved;
}

// --- clone ---------------------------------------------------------------

/** Error with an HTTP status for the route (`friendlyError` shows `message`). */
export class CloneError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CloneError";
  }
}

/**
 * Map a failed `gh repo clone` to a distinct, actionable error. Statuses
 * avoid 401 (the web client reads that as a bad install token before
 * looking at the body); every message names the repo and the fix.
 */
export function mapCloneError(owner: string, name: string, res: RunResult): CloneError {
  const text = `${res.stderr}\n${res.stdout}`.trim();
  const firstLine = text.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  const repo = `${owner}/${name}`;
  if (/not[\s-]?logged[\s-]?in|not authenticated|authentication required|please run ['`]?gh auth login|gh auth login/i.test(text)) {
    return new CloneError(`gh is not logged in — run \`gh auth login\`, then add ${repo} again`, 409);
  }
  if (/\b(404|not found|does not exist|no such (repository|repo)|could not resolve to a repository)\b/i.test(text)) {
    return new CloneError(
      `repository not found: ${repo} (check the spelling — or it is private and this account has no access)`,
      404,
    );
  }
  if (/\b(403|forbidden|access denied|permission denied|you do not have permission)\b/i.test(text)) {
    return new CloneError(`no access to ${repo} with the current gh login (check the account can read it)`, 403);
  }
  if (/network|timed? ?out|connection (refused|reset|timed? ?out)|could not resolve host|temporary failure|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|offline/i.test(text)) {
    return new CloneError(`network failure while cloning ${repo} — check your connection and try again`, 502);
  }
  const detail = firstLine.length > 0 ? `: ${firstLine.slice(0, 200)}` : "";
  return new CloneError(`clone failed for ${repo}${detail} (exit ${res.code})`, 502);
}

/** Exact argv for the clone (asserted by tests). */
export function cloneArgv(owner: string, name: string, dir: string): string[] {
  return ["repo", "clone", `${owner}/${name}`, dir, "--", "--filter=blob:none"];
}

async function gitOk(runner: CommandRunner, args: string[], cwd: string): Promise<boolean> {
  try {
    const res = await runner.run("git", { args, cwd });
    return res.code === 0;
  } catch {
    return false;
  }
}

/** Origin owner/name of the checkout at `dir`, or null. */
async function checkoutIdentity(
  runner: CommandRunner,
  dir: string,
): Promise<{ owner: string; name: string } | null> {
  try {
    const res = await runner.run("git", { args: ["remote", "get-url", "origin"], cwd: dir });
    if (res.code !== 0) return null;
    const url = res.stdout.trim().split("\n")[0]?.trim();
    if (!url) return null;
    return parseGitHubRemote(url);
  } catch {
    return null;
  }
}

function sameRepo(
  a: { owner: string; name: string } | null,
  owner: string,
  name: string,
): boolean {
  return !!a && a.owner.toLowerCase() === owner.toLowerCase() && a.name.toLowerCase() === name.toLowerCase();
}

/**
 * State of the clone target directory:
 * - `missing`: nothing there — clone fresh.
 * - `expected`: a valid checkout of owner/name (adopt/reuse, never re-clone).
 * - `half`: a git checkout with the right origin but no resolvable HEAD —
 *   a leftover interrupted clone. Ours (origin matches), so remove + re-clone.
 * - `occupied`: anything else (different origin, or not a git checkout at
 *   all) — refuse, never delete.
 */
export type TargetState = "missing" | "expected" | "half" | "occupied";

export async function cloneTargetState(
  runner: CommandRunner,
  dir: string,
  owner: string,
  name: string,
): Promise<TargetState> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch {
    return "missing";
  }
  if (!stat.isDirectory()) return "occupied";
  if (!(await gitOk(runner, ["rev-parse", "--git-dir"], dir))) return "occupied";
  const identity = await checkoutIdentity(runner, dir);
  if (!sameRepo(identity, owner, name)) return "occupied";
  if (!(await gitOk(runner, ["rev-parse", "HEAD"], dir))) return "half";
  return "expected";
}

function rmDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort: the rename/retry below reports the real outcome.
  }
}

/** One in-flight clone per target dir: concurrent adds share the work. */
const cloneInflight = new Map<string, Promise<{ dir: string; reused: boolean }>>();

/** Test-only: drop in-flight clone state between suites. */
export function resetManagedCloneStateForTests(): void {
  cloneInflight.clear();
  fetchState.clear();
}

export interface CloneDeps {
  runner: CommandRunner;
  dataDir: string;
}

/**
 * Ensure the managed clone exists. Returns the directory and whether it
 * was already usable (`reused: true` — no clone ran). Concurrent adds of
 * the same URL share one in-flight clone. Throws `CloneError` with a
 * distinct status/message on failure; a failure leaves nothing behind at
 * the target, so a retry starts clean.
 */
export async function ensureManagedClone(
  deps: CloneDeps,
  owner: string,
  name: string,
): Promise<{ dir: string; reused: boolean }> {
  const dir = managedRepoDir(deps.dataDir, owner, name);
  const key = path.resolve(dir);
  const prior = cloneInflight.get(key);
  if (prior) {
    const done = await prior;
    return { dir: done.dir, reused: true };
  }
  // Created and registered synchronously (no await between creation and
  // `set`), so a concurrent add in the same tick always joins this task.
  // The task reports reuse itself: true only when the target was already
  // valid and no clone ran.
  const task = (async (): Promise<{ dir: string; reused: boolean }> => {
    const state = await cloneTargetState(deps.runner, dir, owner, name);
    if (state === "expected") return { dir, reused: true };
    if (state === "occupied") {
      throw new CloneError(
        `cannot clone ${owner}/${name}: ${dir} already exists and is not that repo (move it aside or remove it first)`,
        409,
      );
    }
    if (state === "half") rmDir(dir);
    // Clone to a hidden temp sibling (same filesystem → atomic rename),
    // so an interrupted clone never sits at the final path.
    const ownerDir = path.dirname(dir);
    fs.mkdirSync(ownerDir, { recursive: true });
    const tmp = path.join(ownerDir, `.tmp-clone-${process.pid}-${randomBytes(4).toString("hex")}`);
    rmDir(tmp);
    const argv = cloneArgv(owner, name, tmp);
    let res: RunResult;
    try {
      res = await runGh(deps.runner, argv, { args: argv, cwd: ownerDir });
    } catch (err) {
      rmDir(tmp);
      throw new CloneError(`clone failed for ${owner}/${name}: ${(err as Error).message.slice(0, 200)}`, 502);
    }
    if (res.code !== 0) {
      rmDir(tmp);
      throw mapCloneError(owner, name, res);
    }
    try {
      fs.renameSync(tmp, dir);
      return { dir, reused: false };
    } catch {
      rmDir(tmp);
      // Lost a rename race with something outside this process: reuse the
      // winner when it is the expected clone, else report the failure.
      const after = await cloneTargetState(deps.runner, dir, owner, name);
      if (after === "expected") return { dir, reused: true };
      throw new CloneError(`clone failed for ${owner}/${name}: could not move the checkout into place`, 502);
    }
  })();
  cloneInflight.set(key, task);
  try {
    return await task;
  } finally {
    cloneInflight.delete(key);
  }
}

// --- refresh ---------------------------------------------------------------

/** Freshness window: listings arriving together share one fetch. */
export const MANAGED_FETCH_FRESH_MS = 30_000;

interface FetchEntry {
  at: number;
  inflight: Promise<string | null> | null;
}

const fetchState = new Map<string, FetchEntry>();

/**
 * `git fetch origin` on a managed clone, best effort. Returns null when the
 * fetch ran (or was fresh/in-flight and shared), or a human note when it
 * failed — the caller degrades to stale data with that note instead of
 * failing. Never throws; never touches user checkouts (the route only calls
 * this for `managed` repos).
 */
export async function refreshManagedCheckout(
  runner: CommandRunner,
  repo: Pick<Repo, "id" | "localPath" | "managed">,
  now: number = Date.now(),
): Promise<string | null> {
  if (repo.managed !== true) return null;
  const entry = fetchState.get(repo.id);
  if (entry) {
    if (entry.inflight) {
      try {
        await entry.inflight;
        return null;
      } catch {
        return fetchNote();
      }
    }
    if (now - entry.at < MANAGED_FETCH_FRESH_MS) return null;
  }
  const current: FetchEntry = { at: now, inflight: null };
  fetchState.set(repo.id, current);
  current.inflight = (async (): Promise<string | null> => {
    try {
      const res = await runner.run("git", { args: ["fetch", "origin"], cwd: repo.localPath });
      if (res.code !== 0) return fetchNote();
      return null;
    } catch {
      return fetchNote();
    }
  })();
  try {
    const note = await current.inflight;
    current.at = Date.now();
    return note;
  } finally {
    current.inflight = null;
  }
}

function fetchNote(): string {
  return "couldn't refresh the local clone (offline?) — showing last fetched data";
}

// --- remove ----------------------------------------------------------------

/** RepoStore subset `removeRepo` needs (the real store satisfies this). */
export interface RemovableRepos {
  get: (id: string) => Repo | null;
  remove: (id: string) => boolean;
  countReviews: (repoId: string) => number;
}

/**
 * Forget a repo. Refuses (409) while reviews reference it — silently
 * orphaning their worktrees is not acceptable. Deletes the clone directory
 * only for managed repos, guarded to inside `<dataDir>/repos`.
 */
export function removeRepo(
  dataDir: string,
  repos: RemovableRepos,
  id: string,
): { removedClone: boolean } {
  const repo = repos.get(id);
  if (!repo) {
    throw new CloneError("unknown repo", 404);
  }
  if (repo.managed === true) {
    const n = repos.countReviews(id);
    if (n > 0) {
      throw new CloneError(
        `repo ${repo.owner}/${repo.name} still has ${n} review${n === 1 ? "" : "s"} — delete ${n === 1 ? "it" : "them"} first, then remove the repo`,
        409,
      );
    }
    const resolved = assertManagedPath(dataDir, repo.localPath);
    rmDir(resolved);
    repos.remove(id);
    return { removedClone: true };
  }
  // User checkout: forget the row, never touch the disk.
  repos.remove(id);
  return { removedClone: false };
}
