// Shared paths, schema version and arg parsing for the cached large demo
// (issue #309). No tokens, no agents, no network here: pure filesystem +
// argv helpers shared by `demo-large-build.mjs`, `demo-large-open.mjs`
// and the fast unit tests (which run against a fake cache in temp dirs).
//
// Cache layout (under the user cache dir, never in the repo, never
// committed): `unvibe.db`, `repos/`, `worktrees/`, `reviews/` copied from
// the build data dir, plus `meta.json` carrying the schema version, the
// review source and the spend. The schema version is checked on open:
// a mismatch refuses with "rebuild" and never migrates.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

/** Cache schema version (issue #309): bump when the cached layout changes. */
export const DEMO_LARGE_SCHEMA_VERSION = 1;

/** Default build cap in USD (issue #309): the live build stops at $1. */
export const DEMO_LARGE_BUILD_CAP_USD = 1;

/** Default interactive-open cap in USD per pass (issue #309). */
export const DEMO_LARGE_OPEN_CAP_USD = 0.25;

/** pi model every role uses (issue #309, same default as #292). */
export const DEMO_LARGE_MODEL = { provider: "pi", model: "muse-spark-1.3-contributor" };

/** User cache dir for the large demo, via `node:os` (macOS + Linux). */
export function demoLargeCacheDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".cache", "unvibe", "demo-large");
}

export function demoLargeMetaPath(cacheDir) {
  return path.join(cacheDir, "meta.json");
}

/** Data-dir entries the cache carries (token excluded: regenerated on open). */
export const DEMO_LARGE_CACHE_ENTRIES = ["unvibe.db", "repos", "worktrees", "reviews"];

/** Managed-clone layout Mirror of `src/repos/managed.ts`: `<dataDir>/repos/<owner>/<name>`. */
export function managedClonePath(dataDir, owner, name) {
  return path.join(dataDir, "repos", owner, name);
}

/**
 * Normalise a `--repo` value to a fetchable URL + owner/name.
 * Accepts `owner/name` or a full https URL. Throws on anything else.
 */
export function normalizeRepoUrl(repo) {
  const trimmed = (repo ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("demo-large: --repo <owner/name|url> is required (the owner has not picked the PR yet)");
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(trimmed);
  if (m) return { url: `https://github.com/${m[1]}/${m[2]}`, owner: m[1], name: m[2] };
  const short = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed);
  if (short) return { url: `https://github.com/${short[1]}/${short[2]}`, owner: short[1], name: short[2] };
  throw new Error(`demo-large: cannot parse --repo ${JSON.stringify(repo)} (want owner/name or a github.com URL)`);
}

/** Write the cache meta file (stamps the schema version). Returns the meta. */
export function writeDemoLargeMeta(cacheDir, meta) {
  const full = { ...meta, schemaVersion: DEMO_LARGE_SCHEMA_VERSION };
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(demoLargeMetaPath(cacheDir), `${JSON.stringify(full, null, 2)}\n`);
  return full;
}

/**
 * Read and verify the cache meta. Throws when the cache is missing or
 * the schema version does not match: rebuild, never migrate.
 */
export function readDemoLargeMeta(cacheDir) {
  const file = demoLargeMetaPath(cacheDir);
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      `demo-large: no cache in ${cacheDir} (run \`mise run demo:large:build -- --repo <owner/name> --pr <n>\` first)`,
    );
  }
  if (meta?.schemaVersion !== DEMO_LARGE_SCHEMA_VERSION) {
    throw new Error(
      `demo-large: cache schema v${meta?.schemaVersion ?? "(none)"} does not match build v${DEMO_LARGE_SCHEMA_VERSION}; rerun \`mise run demo:large:build -- --repo <owner/name> --pr <n>\` to rebuild (no migration)`,
    );
  }
  return meta;
}

/** Copy cache entries into a fresh scratch data dir. Returns copied names. */
export function copyCacheToScratch(cacheDir, dataDir) {
  const copied = [];
  for (const entry of DEMO_LARGE_CACHE_ENTRIES) {
    const from = path.join(cacheDir, entry);
    if (!fs.existsSync(from)) continue;
    const to = path.join(dataDir, entry);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
    copied.push(entry);
  }
  if (!copied.includes("unvibe.db")) {
    throw new Error(`demo-large: cache in ${cacheDir} has no unvibe.db (rebuild it)`);
  }
  return copied;
}

/**
 * Point managed-clone rows at the new data dir. `local_path` is absolute
 * (`<oldDataDir>/repos/<owner>/<name>`), so a copied DB would address the
 * deleted build dir; recompute from owner/name instead of the old prefix.
 * Returns the number of rows rewritten.
 */
export function rewriteManagedPaths(db, dataDir) {
  const rows = db.prepare("SELECT id, owner, name, local_path FROM repos WHERE managed = 1").all();
  let n = 0;
  const update = db.prepare("UPDATE repos SET local_path = ? WHERE id = ?");
  for (const row of rows) {
    const want = managedClonePath(dataDir, row.owner, row.name);
    if (row.local_path !== want) {
      update.run(want, row.id);
      n += 1;
    }
  }
  return n;
}

/**
 * Repair git-worktree links after a copy: the worktree `.git` file and
 * the clone-side admin both carry absolute paths. Prefer
 * `git worktree repair`; fall back to rewriting the `gitdir:` pointers
 * directly (keeps old git working and is unit-testable).
 * Returns { repaired, fallback }.
 */
export function worktreeGitdirPointers(worktreePath, clonePath, worktreeName) {
  return {
    worktreeGitFile: { file: path.join(worktreePath, ".git"), want: `gitdir: ${path.join(clonePath, ".git", "worktrees", worktreeName)}` },
    adminGitFile: { file: path.join(clonePath, ".git", "worktrees", worktreeName, "gitdir"), want: path.join(worktreePath, ".git") },
  };
}

/** Rewrite one worktree's `gitdir:` pointers directly (fallback repair). */
export function rewriteWorktreePointers(worktreePath, clonePath, worktreeName) {
  const pointers = worktreeGitdirPointers(worktreePath, clonePath, worktreeName);
  fs.writeFileSync(pointers.worktreeGitFile.file, `${pointers.worktreeGitFile.want}\n`);
  fs.mkdirSync(path.dirname(pointers.adminGitFile.file), { recursive: true });
  fs.writeFileSync(pointers.adminGitFile.file, `${pointers.adminGitFile.want}\n`);
}

/** True when the worktree answers `git rev-parse HEAD`. */
export function worktreeHealthy(worktreePath) {
  const check = spawnSync("git", ["rev-parse", "HEAD"], { cwd: worktreePath, encoding: "utf8" });
  return check.status === 0 ? check.stdout.trim() : null;
}

/**
 * Repair git-worktree links after a cache copy: the worktree `.git`
 * file and the clone-side admin both carry absolute paths into the old
 * location. Prefers `git worktree repair`; falls back to rewriting the
 * `gitdir:` pointers directly. Returns the repaired count; throws when a
 * copied worktree cannot be repaired (rebuild the cache).
 */
export function repairWorktrees(dataDir) {
  const wtRoot = path.join(dataDir, "worktrees");
  if (!fs.existsSync(wtRoot)) return 0;
  const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
  let clones = [];
  try {
    clones = db.prepare("SELECT owner, name, local_path FROM repos WHERE managed = 1").all();
  } finally {
    db.close();
  }
  let repaired = 0;
  for (const wtName of fs.readdirSync(wtRoot)) {
    const wt = path.join(wtRoot, wtName);
    if (!fs.existsSync(path.join(wt, ".git"))) continue;
    let ok = false;
    for (const clone of clones) {
      if (!fs.existsSync(path.join(clone.local_path, ".git"))) continue;
      const r = spawnSync("git", ["worktree", "repair", wt], { cwd: clone.local_path, encoding: "utf8" });
      if (r.status === 0 && worktreeHealthy(wt)) {
        ok = true;
        repaired += 1;
        break;
      }
      try {
        rewriteWorktreePointers(wt, clone.local_path, wtName);
        if (worktreeHealthy(wt)) {
          ok = true;
          repaired += 1;
          break;
        }
      } catch {
        // try the next clone
      }
    }
    if (!ok) throw new Error(`demo-large: cannot repair worktree ${wt} (rebuild the cache)`);
  }
  return repaired;
}

export function parseDemoLargeBuildArgs(argv) {
  const out = { repo: null, pr: null, capUsd: DEMO_LARGE_BUILD_CAP_USD, port: 4597, allowUnpriced: false, force: false, budgetMin: 45 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--repo") out.repo = argv[++i] ?? null;
    else if (arg === "--pr") out.pr = Number(argv[++i]);
    else if (arg === "--cap") out.capUsd = Number(argv[++i]);
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--budget-min") out.budgetMin = Number(argv[++i]);
    else if (arg === "--allow-unpriced") out.allowUnpriced = true;
    else if (arg === "--force") out.force = true;
  }
  if (!out.repo) throw new Error("demo-large build: --repo <owner/name|url> is required (the owner picks the PR on #309)");
  if (!Number.isSafeInteger(out.pr) || out.pr <= 0) {
    throw new Error(`demo-large build: --pr <n> is required (got ${argv.includes("--pr") ? "an invalid value" : "nothing"})`);
  }
  if (!Number.isFinite(out.capUsd) || out.capUsd <= 0) throw new Error(`demo-large build: --cap needs a positive USD value (got ${out.capUsd})`);
  if (!Number.isSafeInteger(out.port) || out.port <= 0) throw new Error(`demo-large build: --port needs a port number (got ${out.port})`);
  if (!Number.isFinite(out.budgetMin) || out.budgetMin <= 0) throw new Error(`demo-large build: --budget-min needs positive minutes (got ${out.budgetMin})`);
  return out;
}

export function parseDemoLargeOpenArgs(argv) {
  const out = { mode: "browse", port: null, capUsd: DEMO_LARGE_OPEN_CAP_USD };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--mode") out.mode = argv[++i] ?? "browse";
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--cap") out.capUsd = Number(argv[++i]);
  }
  if (out.mode !== "browse" && out.mode !== "interactive") {
    throw new Error(`demo-large open: --mode wants browse|interactive (got ${JSON.stringify(out.mode)})`);
  }
  if (out.port !== null && (!Number.isSafeInteger(out.port) || out.port <= 0)) {
    throw new Error(`demo-large open: --port needs a port number (got ${out.port})`);
  }
  if (!Number.isFinite(out.capUsd) || out.capUsd <= 0) throw new Error(`demo-large open: --cap needs a positive USD value (got ${out.capUsd})`);
  return out;
}
