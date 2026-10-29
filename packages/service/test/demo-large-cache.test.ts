/**
 * Cached large-demo cache-layout units (issue #309).
 *
 * Pure logic plus a fake cache in temp dirs: meta round-trip, schema
 * staleness refusal (rebuild, no migration), arg parsing, repo
 * normalisation, managed-path rewriting against a scratch sqlite DB, and
 * the gitdir-pointer fallback. No agents, no network, no real home.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  DEMO_LARGE_BUILD_CAP_USD,
  DEMO_LARGE_DEFAULT_PR,
  DEMO_LARGE_DEFAULT_REPO,
  DEMO_LARGE_MODEL,
  DEMO_LARGE_OPEN_CAP_USD,
  DEMO_LARGE_SCHEMA_VERSION,
  copyCacheToScratch,
  demoLargeCacheDir,
  demoLargeMetaPath,
  managedClonePath,
  normalizeRepoUrl,
  parseDemoLargeBuildArgs,
  parseDemoLargeOpenArgs,
  readDemoLargeMeta,
  repairWorktrees,
  rewriteManagedPaths,
  rewriteWorktreePointers,
  worktreeGitdirPointers,
  worktreeHealthy,
  writeDemoLargeMeta,
} from "../../../scripts/demo-large-lib.mjs";

function fakeCache() {
  const cache = mkdtempSync(join(tmpdir(), "demo-large-cache-"));
  writeFileSync(join(cache, "unvibe.db"), "fake-db");
  mkdirSync(join(cache, "worktrees", "rv_abc"), { recursive: true });
  writeFileSync(join(cache, "worktrees", "rv_abc", ".git"), "gitdir: /old/clone/.git/worktrees/rv_abc\n");
  return cache;
}

describe("demoLargeCacheDir (issue #309)", () => {
  it("lives under the given home via node:os, never hard-coded", () => {
    expect(demoLargeCacheDir("/tmp/fakehome")).toBe("/tmp/fakehome/.cache/unvibe/demo-large");
    expect(demoLargeCacheDir()).toContain(".cache/unvibe/demo-large");
  });
});

describe("cache meta (issue #309)", () => {
  it("round-trips with the schema version stamped", () => {
    const cache = mkdtempSync(join(tmpdir(), "demo-large-meta-"));
    try {
      const meta = writeDemoLargeMeta(cache, { owner: "acme", name: "app", pr: 123, reviewId: "rv_abc" });
      expect(meta.schemaVersion).toBe(DEMO_LARGE_SCHEMA_VERSION);
      expect(JSON.parse(readFileSync(demoLargeMetaPath(cache), "utf8")).reviewId).toBe("rv_abc");
      expect(readDemoLargeMeta(cache).pr).toBe(123);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("refuses a missing cache with the build command", () => {
    const missing = join(tmpdir(), "demo-large-nope");
    expect(() => readDemoLargeMeta(missing)).toThrow(/no cache.*demo:large:build/);
  });

  it("refuses a stale schema with rebuild, never migrates", () => {
    const cache = mkdtempSync(join(tmpdir(), "demo-large-stale-"));
    try {
      writeFileSync(demoLargeMetaPath(cache), JSON.stringify({ schemaVersion: DEMO_LARGE_SCHEMA_VERSION + 1, pr: 1 }));
      expect(() => readDemoLargeMeta(cache)).toThrow(/does not match.*rebuild.*no migration/);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});

describe("copyCacheToScratch (issue #309)", () => {
  it("copies entries into a fresh dir and requires the DB", () => {
    const cache = fakeCache();
    const scratch = mkdtempSync(join(tmpdir(), "demo-large-scratch-"));
    try {
      const copied = copyCacheToScratch(cache, scratch);
      expect(copied).toContain("unvibe.db");
      expect(copied).toContain("worktrees");
      expect(readFileSync(join(scratch, "unvibe.db"), "utf8")).toBe("fake-db");
      rmSync(join(cache, "unvibe.db"));
      expect(() => copyCacheToScratch(cache, scratch)).toThrow(/no unvibe.db.*rebuild/);
    } finally {
      rmSync(cache, { recursive: true, force: true });
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("rewriteManagedPaths (issue #309)", () => {
  it("repoints absolute managed local_paths at the new data dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "demo-large-db-"));
    const file = join(dir, "unvibe.db");
    const db = new DatabaseSync(file);
    try {
      db.exec("CREATE TABLE repos (id TEXT PRIMARY KEY, owner TEXT, name TEXT, local_path TEXT, managed INTEGER)");
      db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?)").run("r1", "acme", "app", "/old/build-xyz/repos/acme/app", 1);
      db.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?)").run("r2", "acme", "local", "/home/u/src/local", 0);
      expect(rewriteManagedPaths(db, "/new/scratch")).toBe(1);
      const rows = db.prepare("SELECT id, local_path FROM repos ORDER BY id").all() as { id: string; local_path: string }[];
      expect(rows[0].local_path).toBe(managedClonePath("/new/scratch", "acme", "app"));
      expect(rows[1].local_path).toBe("/home/u/src/local");
      // Idempotent on a second open.
      expect(rewriteManagedPaths(db, "/new/scratch")).toBe(0);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("worktreeGitdirPointers (issue #309)", () => {
  it("names both absolute gitdir pointers the repair rewrites", () => {
    const p = worktreeGitdirPointers("/new/wt/rv_abc", "/new/clone", "rv_abc");
    expect(p.worktreeGitFile.file).toBe("/new/wt/rv_abc/.git");
    expect(p.worktreeGitFile.want).toContain("/new/clone/.git/worktrees/rv_abc");
    expect(p.adminGitFile.file).toBe("/new/clone/.git/worktrees/rv_abc/gitdir");
    expect(p.adminGitFile.want).toBe("/new/wt/rv_abc/.git");
    expect(existsSync(p.worktreeGitFile.file)).toBe(false);
  });
});

describe("arg parsing + repo source (issue #309)", () => {
  it("build defaults the cap to $1 and the source to cpython#160318", () => {
    expect(DEMO_LARGE_BUILD_CAP_USD).toBe(1);
    expect(DEMO_LARGE_OPEN_CAP_USD).toBe(0.25);
    expect(DEMO_LARGE_MODEL).toEqual({ provider: "pi", model: "muse-spark-1.3-contributor" });
    expect(DEMO_LARGE_DEFAULT_REPO).toBe("python/cpython");
    expect(DEMO_LARGE_DEFAULT_PR).toBe(160318);
    const parsed = parseDemoLargeBuildArgs(["--repo", "acme/app", "--pr", "42"]);
    expect(parsed).toMatchObject({ pr: 42, capUsd: 1 });
    expect(parseDemoLargeBuildArgs([])).toMatchObject({ repo: "python/cpython", pr: 160318, capUsd: 1 });
    expect(() => parseDemoLargeBuildArgs(["--repo", "acme/app", "--pr", "0"])).toThrow(/--pr/);
  });

  it("normalises owner/name and URLs to the same source", () => {
    expect(normalizeRepoUrl("acme/app")).toEqual({ url: "https://github.com/acme/app", owner: "acme", name: "app" });
    expect(normalizeRepoUrl("https://github.com/acme/app.git")).toEqual({
      url: "https://github.com/acme/app",
      owner: "acme",
      name: "app",
    });
    expect(() => normalizeRepoUrl("not-a-repo")).toThrow(/--repo/);
  });

  it("open defaults to free browse mode", () => {
    expect(parseDemoLargeOpenArgs([])).toMatchObject({ mode: "browse", port: null, capUsd: 0.25 });
    expect(parseDemoLargeOpenArgs(["--mode", "interactive"]).mode).toBe("interactive");
    expect(() => parseDemoLargeOpenArgs(["--mode", "agent"])).toThrow(/browse\|interactive/);
  });
});

describe("repairWorktrees round-trip (issue #309)", () => {
  const git = (args: string[], cwd: string) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return (r.stdout ?? "").trim();
  };

  it("copies a clone + worktree elsewhere and repairs the links", () => {
    const base = mkdtempSync(join(tmpdir(), "demo-large-repair-"));
    try {
      // Fake "build" data dir: managed clone with one linked worktree.
      const buildData = join(base, "build");
      const clone = join(buildData, "repos", "acme", "app");
      mkdirSync(clone, { recursive: true });
      git(["init", "-b", "main"], clone);
      git(["config", "user.email", "t@example.com"], clone);
      git(["config", "user.name", "T"], clone);
      writeFileSync(join(clone, "f.txt"), "hello\n");
      git(["add", "."], clone);
      git(["commit", "-m", "init"], clone);
      const sha = git(["rev-parse", "HEAD"], clone);
      const wtName = "rv_abc";
      git(["worktree", "add", join(buildData, "worktrees", wtName), sha], clone);
      expect(worktreeHealthy(join(buildData, "worktrees", wtName))).toBe(sha);

      // Fake cache: copy clone + worktree + a DB naming the clone.
      const cache = join(base, "cache");
      mkdirSync(cache, { recursive: true });
      cpSync(join(buildData, "repos"), join(cache, "repos"), { recursive: true });
      cpSync(join(buildData, "worktrees"), join(cache, "worktrees"), { recursive: true });
      const dbFile = join(cache, "unvibe.db");
      const setup = new DatabaseSync(dbFile);
      try {
        setup.exec("CREATE TABLE repos (id TEXT PRIMARY KEY, owner TEXT, name TEXT, local_path TEXT, managed INTEGER)");
        setup.prepare("INSERT INTO repos VALUES (?, ?, ?, ?, ?)").run("r1", "acme", "app", clone, 1);
      } finally {
        setup.close();
      }
      writeDemoLargeMeta(cache, { owner: "acme", name: "app", pr: 1, reviewId: wtName, headSha: sha });
      // The build wipes its scratch dir after caching; the copied links dangle.
      rmSync(buildData, { recursive: true, force: true });

      // Open: copy into a fresh scratch dir, repoint, repair.
      const scratch = join(base, "scratch");
      mkdirSync(scratch, { recursive: true });
      expect(readDemoLargeMeta(cache).reviewId).toBe(wtName);
      copyCacheToScratch(cache, scratch);
      const db = new DatabaseSync(join(scratch, "unvibe.db"));
      try {
        expect(rewriteManagedPaths(db, scratch)).toBe(1);
      } finally {
        db.close();
      }
      // Before repair the copied worktree is broken (points at the old clone).
      expect(worktreeHealthy(join(scratch, "worktrees", wtName))).toBeNull();
      expect(repairWorktrees(scratch)).toBe(1);
      expect(worktreeHealthy(join(scratch, "worktrees", wtName))).toBe(sha);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rewriteWorktreePointers fallback heals a worktree when repair is skipped", () => {
    const base = mkdtempSync(join(tmpdir(), "demo-large-rewrite-"));
    try {
      const clone = join(base, "clone");
      mkdirSync(clone, { recursive: true });
      git(["init", "-b", "main"], clone);
      git(["config", "user.email", "t@example.com"], clone);
      git(["config", "user.name", "T"], clone);
      writeFileSync(join(clone, "f.txt"), "hi\n");
      git(["add", "."], clone);
      git(["commit", "-m", "init"], clone);
      const sha = git(["rev-parse", "HEAD"], clone);
      const wt = join(base, "wt");
      git(["worktree", "add", wt, sha], clone);
      rewriteWorktreePointers(wt, clone, "wt");
      expect(worktreeHealthy(wt)).toBe(sha);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
