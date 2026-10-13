/**
 * Review fixes for managed clones (#27, follow-up): each suite below fails
 * against the pre-fix implementation and passes after. `gh` is stubbed
 * through the injectable command runner; `git` is real against temp dirs;
 * never a real clone or network.
 *
 * - remove refuses while reviews exist for managed AND user checkouts
 * - countReviews fails closed (query error refuses, never reads as empty)
 * - a failed clone-directory deletion keeps the row and reports the error
 * - owner/name canonicalise to one lowercase directory and one row
 * - fetch notes reach joiners and survive a short failure back-off
 * - fetch has a bounded timeout and prompt-free env; clone is prompt-free
 * - the delete guard sees through symlinks
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repo } from "@unvibe/shared";
import { openDatabase } from "../src/store/db.js";
import { RealCommandRunner, type CommandRunner, type RunResult } from "../src/exec/index.js";
import {
  assertManagedPath,
  CloneError,
  managedRepoDir,
  MANAGED_FETCH_FAIL_BACKOFF_MS,
  MANAGED_FETCH_TIMEOUT_MS,
  refreshManagedCheckout,
  removeRepo,
  resetManagedCloneStateForTests,
  type RemovableRepos,
} from "../src/repos/index.js";
import { RepoStore } from "../src/repos/store.js";
import { createApp } from "../src/server.js";
import { isGitFetch } from "./git-args.js";

const real = new RealCommandRunner();

/** Materialize a usable checkout at `dir`, as a real `gh repo clone` would. */
async function fakeCloneCheckout(dir: string, owner: string, name: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const git = async (...args: string[]): Promise<void> => {
    const res = await real.run("git", { args, cwd: dir });
    if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "README.md"), "# hi\n");
  await git("add", ".");
  await git("commit", "-m", "init");
  await git("remote", "add", "origin", `https://github.com/${owner}/${name}.git`);
}

interface FullCall {
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

/** Hybrid runner recording full opts (env + timeout) for every call. */
function makeRunner(opts: {
  ghClone?: "ok" | RunResult;
  ghOther?: RunResult;
  gitFetch?: RunResult | "real";
} = {}): { runner: CommandRunner; ghCalls: FullCall[]; gitCalls: FullCall[] } {
  const ghCalls: FullCall[] = [];
  const gitCalls: FullCall[] = [];
  const runner: CommandRunner = {
    run: async (cmd, o) => {
      if (cmd === "gh") {
        ghCalls.push({ args: o.args, cwd: o.cwd, env: o.env, timeoutMs: o.timeoutMs });
        if (o.args[0] === "repo" && o.args[1] === "clone") {
          const mode = opts.ghClone ?? "ok";
          if (mode === "ok") {
            const [owner, name] = o.args[2].split("/");
            await fakeCloneCheckout(o.args[3], owner, name);
            return { stdout: "", stderr: "", code: 0 };
          }
          return mode;
        }
        if (opts.ghOther) return opts.ghOther;
        throw new Error(`unexpected gh call: ${o.args.join(" ")}`);
      }
      if (cmd === "git") {
        gitCalls.push({ args: o.args, cwd: o.cwd, env: o.env, timeoutMs: o.timeoutMs });
        if (isGitFetch(o.args) && opts.gitFetch !== undefined && opts.gitFetch !== "real") {
          return opts.gitFetch;
        }
      }
      return real.run(cmd, o);
    },
  };
  return { runner, ghCalls, gitCalls };
}

let savedRoots: string | undefined;

beforeEach(() => {
  savedRoots = process.env.UNVIBE_REPO_ROOTS;
  process.env.UNVIBE_REPO_ROOTS = "";
  resetManagedCloneStateForTests();
});

afterEach(() => {
  if (savedRoots === undefined) delete process.env.UNVIBE_REPO_ROOTS;
  else process.env.UNVIBE_REPO_ROOTS = savedRoots;
  resetManagedCloneStateForTests();
});

function authed() {
  return { authorization: "Bearer tok" };
}

function reposOf(body: unknown): Repo[] {
  return (body as { repos: Repo[] }).repos;
}

async function makePathRepo(dir: string): Promise<void> {
  const git = async (...args: string[]): Promise<void> => {
    const res = await real.run("git", { args, cwd: dir });
    if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "f.txt"), "x\n");
  await git("add", ".");
  await git("commit", "-m", "init");
}

describe("remove refuses while reviews exist (both kinds)", () => {
  it("a user checkout with reviews is not forgotten", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-repo-"));
    await makePathRepo(dir);
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner({ ghOther: { stdout: "[]", stderr: "", code: 0 } });
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { path: dir },
      });
      expect(added.statusCode).toBe(200);
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed(),
        payload: { repoId: repo.id, branch: "main" },
      });
      expect([201, 202]).toContain(created.statusCode);

      const del = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(del.statusCode).toBe(409);
      expect((del.json() as { error: string }).error).toMatch(/still has 1 review/);
      // Row kept, checkout untouched, review still refreshable.
      const list = await app.inject({ method: "GET", url: "/api/repos", headers: authed() });
      expect(reposOf(list.json()).some((r) => r.id === repo.id)).toBe(true);
      expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("countReviews fails closed", () => {
  it("a query error propagates instead of reading as no reviews", () => {
    const db = openDatabase(":memory:");
    try {
      db.exec("CREATE TABLE repos (id TEXT PRIMARY KEY, owner TEXT, name TEXT, local_path TEXT, last_opened INTEGER)");
      const store = new RepoStore(db);
      expect(() => store.countReviews("rp_missing")).toThrow();
    } finally {
      db.close();
    }
  });

  it("removeRepo refuses when the review count cannot be verified", () => {
    let removed = false;
    const repos: RemovableRepos = {
      get: (): Repo | null => ({
        id: "rp_x",
        owner: "acme",
        name: "app",
        localPath: "/tmp/unused",
        lastOpened: 0,
        managed: true,
      }),
      remove: () => {
        removed = true;
        return true;
      },
      countReviews: () => {
        throw new Error("database is locked");
      },
    };
    expect(() => removeRepo(fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-")), repos, "rp_x")).toThrow(
      /so it was kept/,
    );
    expect(removed).toBe(false);
  });
});

describe("failed directory deletion keeps the row", () => {
  it("DELETE reports the error and forgets nothing", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    const target = path.join(dataDir, "repos", "acme", "app");
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      expect(added.statusCode).toBe(200);
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      // Make the clone undeletable: no write permission, so recursive rm fails.
      fs.chmodSync(target, 0o555);
      const del = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(del.statusCode).toBe(500);
      expect((del.json() as { error: string }).error).toMatch(/could not delete/);
      const list = await app.inject({ method: "GET", url: "/api/repos", headers: authed() });
      expect(reposOf(list.json()).some((r) => r.id === repo.id)).toBe(true);
      expect(fs.existsSync(target)).toBe(true);
    } finally {
      try {
        fs.chmodSync(target, 0o755);
      } catch {
        // Already gone or never created.
      }
      await app.close();
    }
  });
});

describe("owner/name canonicalisation", () => {
  it("managedRepoDir lowercases segments", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    expect(managedRepoDir(root, "Acme", "App")).toBe(path.join(root, "repos", "acme", "app"));
  });

  it("every spelling maps to one directory and one row", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/Acme/App" },
      });
      expect(first.statusCode).toBe(200);
      const row = reposOf(first.json()).find((r) => r.id !== "demo")!;
      expect(row.localPath).toBe(path.join(dataDir, "repos", "acme", "app"));
      // Display casing comes from the first add.
      expect(row.owner).toBe("Acme");
      expect(row.name).toBe("App");

      const second = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      expect(second.statusCode).toBe(200);
      const rows = reposOf(second.json()).filter((r) => r.id !== "demo");
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(row.id);
      expect(ghCalls.filter((c) => c.args[1] === "clone")).toHaveLength(1);
      // One directory on disk, not one per spelling.
      expect(fs.readdirSync(path.join(dataDir, "repos", "acme"))).toEqual(["app"]);
    } finally {
      await app.close();
    }
  });
});

describe("fetch notes reach every caller", () => {
  const managed = (id: string): Repo => ({
    id,
    owner: "acme",
    name: "app",
    localPath: "/tmp/unused",
    lastOpened: 0,
    managed: true,
  });

  it("callers joining an in-flight fetch share its note", async () => {
    let fetches = 0;
    const runner: CommandRunner = {
      run: async (cmd, o) => {
        if (cmd === "git" && isGitFetch(o.args)) {
          fetches += 1;
          await new Promise((r) => setTimeout(r, 60));
          return { stdout: "", stderr: "offline", code: 1 };
        }
        throw new Error(`unexpected: ${cmd} ${o.args.join(" ")}`);
      },
    };
    const repo = managed("rp_join");
    const [a, b, c] = await Promise.all([
      refreshManagedCheckout(runner, repo),
      refreshManagedCheckout(runner, repo),
      refreshManagedCheckout(runner, repo),
    ]);
    expect(fetches).toBe(1);
    expect(a).toMatch(/couldn't update Unvibe's clone/);
    expect(b).toMatch(/couldn't update Unvibe's clone/);
    expect(c).toMatch(/couldn't update Unvibe's clone/);
  });

  it("a failed fetch keeps reporting its note during the back-off, then retries", async () => {
    let fetches = 0;
    const runner: CommandRunner = {
      run: async (cmd, o) => {
        if (cmd === "git" && isGitFetch(o.args)) {
          fetches += 1;
          return { stdout: "", stderr: "offline", code: 1 };
        }
        throw new Error(`unexpected: ${cmd} ${o.args.join(" ")}`);
      },
    };
    const repo = managed("rp_backoff");
    expect(await refreshManagedCheckout(runner, repo)).toMatch(/couldn't update Unvibe's clone/);
    expect(fetches).toBe(1);
    // Inside the back-off: same note, no new fetch.
    expect(await refreshManagedCheckout(runner, repo)).toMatch(/couldn't update Unvibe's clone/);
    expect(fetches).toBe(1);
    // Past the back-off: retries instead of going silent.
    const later = Date.now() + MANAGED_FETCH_FAIL_BACKOFF_MS + 1000;
    expect(await refreshManagedCheckout(runner, repo, later)).toMatch(/couldn't update Unvibe's clone/);
    expect(fetches).toBe(2);
  });
});

describe("bounded, prompt-free subprocess env", () => {
  it("fetch carries a timeout and never prompts", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, gitCalls } = makeRunner({
      gitFetch: { stdout: "", stderr: "", code: 0 },
    });
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      resetManagedCloneStateForTests();
      gitCalls.length = 0;
      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=branches`,
        headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      const fetch = gitCalls.find((c) => isGitFetch(c.args));
      expect(fetch).toBeDefined();
      expect(fetch!.timeoutMs).toBe(MANAGED_FETCH_TIMEOUT_MS);
      expect(fetch!.env?.["GIT_TERMINAL_PROMPT"]).toBe("0");
    } finally {
      await app.close();
    }
  });

  it("clone cannot prompt and keeps GITHUB_TOKEN unset", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      expect(res.statusCode).toBe(200);
      const clone = ghCalls.find((c) => c.args[1] === "clone")!;
      expect(clone.env?.["GIT_TERMINAL_PROMPT"]).toBe("0");
      expect(clone.env?.["GH_PROMPT_DISABLED"]).toBe("1");
      expect(clone.env?.["GITHUB_TOKEN"]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("symlink-aware delete guard", () => {
  it("assertManagedPath refuses a symlinked owner directory", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-outside-"));
    fs.mkdirSync(path.join(dataDir, "repos"), { recursive: true });
    fs.symlinkSync(outside, path.join(dataDir, "repos", "evil"));
    expect(() => assertManagedPath(dataDir, path.join(dataDir, "repos", "evil", "app"))).toThrow(/symlink/);
    // A real directory still passes.
    fs.mkdirSync(path.join(dataDir, "repos", "acme", "app"), { recursive: true });
    expect(assertManagedPath(dataDir, path.join(dataDir, "repos", "acme", "app"))).toBe(
      path.join(dataDir, "repos", "acme", "app"),
    );
  });

  it("removeRepo will not delete through a symlink", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-outside-"));
    fs.mkdirSync(path.join(outside, "app"), { recursive: true });
    fs.writeFileSync(path.join(outside, "app", "keep.txt"), "precious");
    fs.mkdirSync(path.join(dataDir, "repos"), { recursive: true });
    fs.symlinkSync(outside, path.join(dataDir, "repos", "evil"));
    let removed = false;
    const repos: RemovableRepos = {
      get: (): Repo | null => ({
        id: "rp_evil",
        owner: "evil",
        name: "app",
        localPath: path.join(dataDir, "repos", "evil", "app"),
        lastOpened: 0,
        managed: true,
      }),
      remove: () => {
        removed = true;
        return true;
      },
      countReviews: () => 0,
    };
    expect(() => removeRepo(dataDir, repos, "rp_evil")).toThrow(/symlink/);
    expect(removed).toBe(false);
    expect(fs.existsSync(path.join(outside, "app", "keep.txt"))).toBe(true);
  });

  it("a throwing countReviews surfaces as a refusal, not a silent success", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    const repos: RemovableRepos = {
      get: (): Repo | null => ({
        id: "rp_x",
        owner: "acme",
        name: "app",
        localPath: path.join(dataDir, "repos", "acme", "app"),
        lastOpened: 0,
        managed: true,
      }),
      remove: () => true,
      countReviews: () => {
        throw new Error("database is locked");
      },
    };
    const err = (() => {
      try {
        removeRepo(dataDir, repos, "rp_x");
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(CloneError);
    expect((err as CloneError).status).toBe(500);
  });
});
