/**
 * Managed clones (#27): repos Unvibe cloned itself into its own storage.
 *
 * - Layout: `<dataDir>/repos/<owner>/<name>` (beside the managed worktrees,
 *   never inside a user directory), with lowercase-canonical segments so
 *   every spelling of a repo maps to one directory and one row. Owner/name
 *   come from the shared URL parser, whose grammar makes them safe as path
 *   segments and as command arguments; `managedRepoDir` re-checks depth as
 *   defence in depth.
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
import { newRepoId, type RepoStore } from "./store.js";
import type { CommandRunner, RunResult } from "../exec/index.js";
import { runGh, runGitFetch } from "../exec/index.js";

/** `<dataDir>/repos`: every managed clone lives under here, nothing else. */
export function managedReposRoot(dataDir: string): string {
  return path.join(dataDir, "repos");
}

/** `<dataDir>/repos/<owner>/<name>` for a validated owner/name pair. */
export function managedRepoDir(dataDir: string, owner: string, name: string): string {
  if (!owner || !name || owner.includes("/") || owner.includes(path.sep) || name.includes("/") || name.includes(path.sep)) {
    throw new Error(`refusing unsafe managed path for "${owner}/${name}"`);
  }
  // Canonical lowercase segments: `Acme/App` and `acme/app` are the same
  // GitHub repo (and the same directory on case-insensitive filesystems),
  // so every spelling maps to one directory and one row. The row keeps the
  // first add's display casing; only the directory is canonical.
  return path.join(managedReposRoot(dataDir), owner.toLowerCase(), name.toLowerCase());
}

/** True when `child` resolves inside `parent` (both resolved first). */
export function isPathInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Throw unless `localPath` is a repo directory inside `<dataDir>/repos`
 * (at least `<owner>/<name>` deep, so the root itself can never qualify).
 * Symlinks are resolved, not just normalised: a symlinked owner directory
 * (or repo dir) would pass a lexical check while `rm` acts on the link
 * target, so any symlink on the path below the managed root refuses.
 * The remove path calls this before any `rm`.
 */
export function assertManagedPath(dataDir: string, localPath: string): string {
  const resolved = path.resolve(localPath);
  const root = path.resolve(managedReposRoot(dataDir));
  const rel = path.relative(root, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).length < 2) {
    throw new Error(`refusing to delete outside managed clones: ${localPath}`);
  }
  // The managed root itself must be a real directory inside the data dir
  // (not a symlink elsewhere); then every existing component below it must
  // not be a symlink either. Missing components (fresh adds) have nothing
  // to resolve, so only existing ones are checked.
  let rootReal: string | null = null;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    rootReal = null;
  }
  if (rootReal !== null) {
    let dataReal: string | null = null;
    try {
      dataReal = fs.realpathSync(path.resolve(dataDir));
    } catch {
      dataReal = null;
    }
    if (dataReal === null || rootReal !== path.join(dataReal, "repos")) {
      throw new Error(`refusing to delete: ${root} is not a real directory inside the data dir`);
    }
    let acc = rootReal;
    for (const seg of rel.split(path.sep)) {
      acc = path.join(acc, seg);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(acc);
      } catch {
        break;
      }
      if (st.isSymbolicLink()) {
        throw new Error(`refusing to delete through a symlink: ${acc}`);
      }
    }
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

/** One in-flight add per target dir: check → clone → remember is atomic. */
const addInflight = new Map<string, Promise<{ repo: Repo; reused: boolean }>>();

/** Test-only: drop in-flight clone/add state between suites. */
export function resetManagedCloneStateForTests(): void {
  cloneInflight.clear();
  addInflight.clear();
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
      // No terminal in the service: disable prompting (a missing login
      // must fail fast into the mapped 409, never hang). `runGh` keeps
      // GITHUB_TOKEN unset underneath (PRD §15).
      // The clone itself stays unbounded: blobless keeps it short, and a
      // killed clone is safe (temp + rename), while a timeout would fail
      // slow-but-healthy clones of large repos.
      res = await runGh(deps.runner, argv, {
        args: argv,
        cwd: ownerDir,
        env: { GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" },
      });
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

// --- add (check → clone → remember, atomic per path) --------------------

export interface AddDeps extends CloneDeps {
  repos: Pick<RepoStore, "getByPath" | "getManagedAnyCase" | "upsert">;
}

/**
 * Remember a managed clone, creating it when needed. The whole
 * check → clone → upsert runs under one per-path lock, so two concurrent
 * adds of the same URL share a single clone AND a single row (the route
 * must not check-then-insert around this: that re-opens the race this
 * lock closes). Throws `CloneError` like the clone itself.
 */
export async function addManagedRepo(
  deps: AddDeps,
  owner: string,
  name: string,
): Promise<{ repo: Repo; reused: boolean }> {
  const dir = managedRepoDir(deps.dataDir, owner, name);
  const key = path.resolve(dir);
  const prior = addInflight.get(key);
  if (prior) return prior;
  // Registered synchronously so a concurrent add always joins this task.
  const task = (async (): Promise<{ repo: Repo; reused: boolean }> => {
    const existing = deps.repos.getByPath(dir);
    if (existing) {
      // Adopt a row that already points at the managed path (added by path
      // before, or a won race): mark managed when the directory is the
      // expected clone, then reuse without cloning.
      if (existing.managed !== true) {
        if ((await cloneTargetState(deps.runner, dir, owner, name)) === "expected") {
          const upgraded: Repo = { ...existing, owner, name, managed: true };
          deps.repos.upsert(upgraded);
          return { repo: upgraded, reused: true };
        }
      }
      return { repo: existing, reused: true };
    }
    // A managed row under another spelling (pre-canonicalisation rows, or
    // a concurrent add that normalised differently): reuse it when its
    // checkout is the expected clone, so one directory never gains a
    // second row.
    const priorSpelling = deps.repos.getManagedAnyCase(owner, name);
    if (
      priorSpelling &&
      (await cloneTargetState(deps.runner, priorSpelling.localPath, owner, name)) === "expected"
    ) {
      return { repo: priorSpelling, reused: true };
    }
    await ensureManagedClone(deps, owner, name);
    // Re-check after the clone: the winner of a lost rename race (or an
    // outside actor) may have remembered the row meanwhile.
    const raced = deps.repos.getByPath(dir);
    if (raced) return { repo: raced, reused: true };
    const repo: Repo = { id: newRepoId(), owner, name, localPath: dir, lastOpened: 0, managed: true };
    deps.repos.upsert(repo);
    return { repo, reused: false };
  })();
  addInflight.set(key, task);
  try {
    return await task;
  } finally {
    addInflight.delete(key);
  }
}

// --- refresh ---------------------------------------------------------------

/** Freshness window: listings arriving together share one fetch. */
export const MANAGED_FETCH_FRESH_MS = 30_000;

/**
 * Failure back-off (shorter than the success window): a failed fetch keeps
 * reporting its note without re-spawning git, then retries. Without this,
 * an offline start page would either hammer `git fetch` or go silent.
 */
export const MANAGED_FETCH_FAIL_BACKOFF_MS = 10_000;

/**
 * Bound for a background freshness fetch: expiry degrades to the note.
 * 15 s keeps a slow fetch well inside the start page's 30 s lists window
 * (`LISTS_TIMEOUT_MS`): a fetch that cannot finish in 15 s was unlikely to
 * finish by 30 s either, and the failure back-off retries on the next
 * listing, so slow-but-healthy networks still converge without ever
 * showing the client's "timed out" state for a working service.
 */
export const MANAGED_FETCH_TIMEOUT_MS = 15_000;

interface FetchEntry {
  at: number;
  inflight: Promise<string | null> | null;
  /** Last outcome: null after a successful fetch, the note after a failed one. */
  note: string | null;
}

const fetchState = new Map<string, FetchEntry>();

/**
 * `git fetch origin` on a managed clone, best effort. Returns null when the
 * fetch ran cleanly (or was fresh and shared), or a human note when it
 * failed — the caller degrades to stale data with that note instead of
 * failing. Callers joining an in-flight fetch share its outcome, note
 * included. Never throws; never touches user checkouts (the route only
 * calls this for `managed` repos).
 */
export async function refreshManagedCheckout(
  runner: CommandRunner,
  repo: Pick<Repo, "id" | "localPath" | "managed">,
  now: number = Date.now(),
): Promise<string | null> {
  if (repo.managed !== true) return null;
  const entry = fetchState.get(repo.id);
  if (entry) {
    if (entry.inflight) return entry.inflight;
    const age = now - entry.at;
    if (entry.note === null && age < MANAGED_FETCH_FRESH_MS) return null;
    if (entry.note !== null && age < MANAGED_FETCH_FAIL_BACKOFF_MS) return entry.note;
  }
  const current: FetchEntry = { at: now, inflight: null, note: null };
  fetchState.set(repo.id, current);
  current.inflight = (async (): Promise<string | null> => {
    try {
      // #139: same gh-login credential handling as ingest fetches.
      const res = await runGitFetch(runner, [], {
        cwd: repo.localPath,
        timeoutMs: MANAGED_FETCH_TIMEOUT_MS,
      });
      if (res.code !== 0) return fetchNote();
      return null;
    } catch {
      return fetchNote();
    }
  })();
  try {
    const note = await current.inflight;
    current.at = Date.now();
    current.note = note;
    return note;
  } finally {
    current.inflight = null;
  }
}

function fetchNote(): string {
  return "couldn't update Unvibe's clone (are you offline?) — showing what was fetched last time";
}

// --- remove ----------------------------------------------------------------

/** RepoStore subset `removeRepo` needs (the real store satisfies this). */
export interface RemovableRepos {
  get: (id: string) => Repo | null;
  remove: (id: string) => boolean;
  countReviews: (repoId: string) => number;
}

/**
 * Forget a repo. Refuses (409) while reviews reference it — for managed
 * clones AND user checkouts alike, since orphaned reviews would 404 on
 * refresh/submit. Deletes the clone directory only for managed repos,
 * guarded to inside `<dataDir>/repos`, and only forgets the row once the
 * directory is gone.
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
  const label = `${repo.owner}/${repo.name}`;
  let reviewCount: number;
  try {
    reviewCount = repos.countReviews(id);
  } catch (err) {
    // Fail closed: a query error must never read as "no reviews" on a
    // destructive path.
    throw new CloneError(
      `couldn't check whether ${label} has reviews (${(err as Error).message}), so it was kept`,
      500,
    );
  }
  if (reviewCount > 0) {
    throw new CloneError(
      `repo ${label} still has ${reviewCount} review${reviewCount === 1 ? "" : "s"} — remove ${reviewCount === 1 ? "it" : "them"} on the start page first, then remove the repo`,
      409,
    );
  }
  if (repo.managed !== true) {
    // User checkout: forget the row, never touch the disk.
    repos.remove(id);
    return { removedClone: false };
  }
  const resolved = assertManagedPath(dataDir, repo.localPath);
  const existed = fs.existsSync(resolved);
  if (existed) removeDirStrict(resolved, `Unvibe's clone of ${label}`);
  repos.remove(id);
  return { removedClone: existed };
}

/**
 * Delete a directory, surfacing failures. The remove path keeps the DB row
 * when this throws, so a half-deleted clone is retried, never forgotten.
 */
function removeDirStrict(dir: string, what: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    throw new CloneError(
      `could not delete ${what} at ${dir} (${(err as Error).message}): the repo was kept — fix the problem above and try again`,
      500,
    );
  }
}
