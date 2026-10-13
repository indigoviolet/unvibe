/**
 * Managed clones by URL (#27): clone happy path (exact argv, blobless,
 * GITHUB_TOKEN unset), reuse, error mapping, crash-safe retry, concurrent
 * adds, fetch-before-list (managed only, degrading), remove semantics, and
 * the deletion guard. `gh` is stubbed through the injectable command
 * runner; `git` is real against temp dirs; never a real clone or network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repo } from "@unvibe/shared";
import { RealCommandRunner, type CommandRunner, type RunResult } from "../src/exec/index.js";
import {
  assertManagedPath,
  cloneArgv,
  isPathInside,
  managedRepoDir,
  mapCloneError,
  refreshManagedCheckout,
  removeRepo,
  resetManagedCloneStateForTests,
} from "../src/repos/index.js";
import { createApp } from "../src/server.js";

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

interface GhCall {
  args: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
}

/**
 * Hybrid runner: `gh repo clone` is stubbed (materializing a checkout or
 * failing on demand), `git fetch origin` is stubbed separately, everything
 * else is real. Records every call for argv assertions.
 */
function makeRunner(opts: {
  ghClone?: "ok" | RunResult | ((tmp: string, slug: string) => Promise<RunResult | "ok">);
  ghOther?: RunResult;
  gitFetch?: RunResult | "real";
  delayCloneMs?: number;
} = {}): { runner: CommandRunner; ghCalls: GhCall[]; gitCalls: string[][] } {
  const ghCalls: GhCall[] = [];
  const gitCalls: string[][] = [];
  const runner: CommandRunner = {
    run: async (cmd, o) => {
      if (cmd === "gh") {
        ghCalls.push({ args: o.args, cwd: o.cwd, env: o.env });
        if (o.args[0] === "repo" && o.args[1] === "clone") {
          if (opts.delayCloneMs) await new Promise((r) => setTimeout(r, opts.delayCloneMs));
          const mode = opts.ghClone ?? "ok";
          if (typeof mode === "function") {
            const out = await mode(o.args[3], o.args[2]);
            if (out === "ok") {
              const [owner, name] = o.args[2].split("/");
              await fakeCloneCheckout(o.args[3], owner, name);
              return { stdout: "", stderr: "", code: 0 };
            }
            return out;
          }
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
        gitCalls.push(o.args);
        // #139: fetches carry the per-command gh credential config ahead of
        // the subcommand, so match "fetch" anywhere in the args.
        if (o.args.includes("fetch") && opts.gitFetch !== undefined && opts.gitFetch !== "real") {
          return opts.gitFetch;
        }
      }
      return real.run(cmd, o);
    },
  };
  return { runner, ghCalls, gitCalls };
}

let savedRoots: string | undefined;
let savedToken: string | undefined;

beforeEach(() => {
  savedRoots = process.env.UNVIBE_REPO_ROOTS;
  process.env.UNVIBE_REPO_ROOTS = "";
  savedToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "leaked-in-env";
  resetManagedCloneStateForTests();
});

afterEach(() => {
  if (savedRoots === undefined) delete process.env.UNVIBE_REPO_ROOTS;
  else process.env.UNVIBE_REPO_ROOTS = savedRoots;
  if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedToken;
  resetManagedCloneStateForTests();
});

function authed() {
  return { authorization: "Bearer tok" };
}

function reposOf(body: unknown): Repo[] {
  return (body as { repos: Repo[] }).repos;
}

describe("POST /api/repos with a URL", () => {
  it("clones blobless with the exact argv, GITHUB_TOKEN unset, and remembers the repo managed", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app" },
      });
      expect(res.statusCode).toBe(200);
      const repos = reposOf(res.json());
      const added = repos.find((r) => r.id !== "demo")!;
      expect(added).toMatchObject({
        owner: "acme",
        name: "app",
        localPath: path.join(dataDir, "repos", "acme", "app"),
        managed: true,
      });

      // Exact argv, including the blobless filter passthrough.
      expect(ghCalls).toHaveLength(1);
      const [call] = ghCalls;
      const tmp = call.args[3];
      expect(call.args).toEqual(["repo", "clone", "acme/app", tmp, "--", "--filter=blob:none"]);
      expect(call.cwd).toBe(path.join(dataDir, "repos", "acme"));
      expect(path.basename(tmp).startsWith(".tmp-clone-")).toBe(true);
      // GITHUB_TOKEN is absent from the env passed to gh (PRD §15), even
      // though it leaks in process.env during this test.
      expect(call.env?.["GITHUB_TOKEN"]).toBeUndefined();
      // Temp sibling renamed away; the target is a usable checkout.
      expect(fs.existsSync(tmp)).toBe(false);
      expect(fs.existsSync(path.join(added.localPath, ".git"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("adding the same URL twice reuses the existing clone (no second clone)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const first = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      expect(first.statusCode).toBe(200);
      expect(ghCalls).toHaveLength(1);
      const id = reposOf(first.json()).find((r) => r.id !== "demo")!.id;

      for (const form of ["acme/app", "https://github.com/acme/app.git", "git@github.com:acme/app.git"]) {
        const again = await app.inject({
          method: "POST",
          url: "/api/repos",
          headers: authed(),
          payload: { url: form },
        });
        expect(again.statusCode).toBe(200);
        const repos = reposOf(again.json());
        expect(repos.filter((r) => r.id !== "demo")).toHaveLength(1);
        expect(repos.find((r) => r.id !== "demo")!.id).toBe(id);
      }
      expect(ghCalls).toHaveLength(1);

      // A PR URL for the known repo reuses too, and returns the PR number.
      const pr = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app/pull/123" },
      });
      expect(pr.statusCode).toBe(200);
      expect((pr.json() as { prNumber?: number }).prNumber).toBe(123);
      expect(ghCalls).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("rejects bad input with a clear 400 (bad URL, both fields, unknown host)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      for (const payload of [
        { url: "not a repo ref at all" },
        { url: "https://example.com/acme/app" },
        { url: "https://github.com/acme" },
        { url: "-evil/app" },
        { url: "https://github.com/acme/app", path: "/tmp/x" },
        {},
      ]) {
        const res = await app.inject({ method: "POST", url: "/api/repos", headers: authed(), payload });
        expect(res.statusCode).toBe(400);
        expect((res.json() as { error: string }).error.length).toBeGreaterThan(10);
      }
      expect(ghCalls).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("maps clone failures distinctly and leaves nothing behind; a retry works", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    let fail: RunResult | null = { stdout: "", stderr: "ERROR: Repository not found.", code: 1 };
    const { runner, ghCalls } = makeRunner({
      ghClone: async () => (fail ?? "ok"),
    });
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const target = path.join(dataDir, "repos", "acme", "app");
      const bad = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app" },
      });
      expect(bad.statusCode).toBe(404);
      expect((bad.json() as { error: string }).error).toMatch(/not found/);
      // Nothing behind: no half-clone, no temp sibling, no remembered row.
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readdirSync(path.join(dataDir, "repos", "acme")).filter((f) => f.startsWith(".tmp-clone-"))).toEqual([]);
      const list = await app.inject({ method: "GET", url: "/api/repos", headers: authed() });
      expect(reposOf(list.json()).filter((r) => r.id !== "demo")).toHaveLength(0);

      // Retry after fixing the failure clones cleanly.
      fail = null;
      const good = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app" },
      });
      expect(good.statusCode).toBe(200);
      expect(fs.existsSync(path.join(target, ".git"))).toBe(true);
      expect(ghCalls.filter((c) => c.args[1] === "clone")).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("concurrent adds of the same URL share one clone", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, ghCalls } = makeRunner({ delayCloneMs: 120 });
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const [a, b] = await Promise.all([
        app.inject({ method: "POST", url: "/api/repos", headers: authed(), payload: { url: "acme/app" } }),
        app.inject({ method: "POST", url: "/api/repos", headers: authed(), payload: { url: "https://github.com/acme/app" } }),
      ]);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const idA = reposOf(a.json()).find((r) => r.id !== "demo")!.id;
      const idB = reposOf(b.json()).find((r) => r.id !== "demo")!.id;
      expect(idA).toBe(idB);
      expect(ghCalls.filter((c) => c.args[1] === "clone")).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("refuses a target directory that is not the expected clone", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const target = path.join(dataDir, "repos", "acme", "app");
    // A different repo already sitting at the managed path.
    await fakeCloneCheckout(target, "someone", "else");
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app" },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: string }).error).toMatch(/already exists and is not that repo/);
      // Untouched: still the other repo, and no clone ran.
      expect(ghCalls.filter((c) => c.args[1] === "clone")).toHaveLength(0);
      const res2 = await real.run("git", { args: ["remote", "get-url", "origin"], cwd: target });
      expect(res2.stdout).toContain("someone/else");
    } finally {
      await app.close();
    }
  });

  it("re-clones a half-clone (right origin, no resolvable HEAD)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const target = path.join(dataDir, "repos", "acme", "app");
    fs.mkdirSync(target, { recursive: true });
    await real.run("git", { args: ["init", "-b", "main"], cwd: target });
    await real.run("git", { args: ["remote", "add", "origin", "https://github.com/acme/app.git"], cwd: target });
    const { runner, ghCalls } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "https://github.com/acme/app" },
      });
      expect(res.statusCode).toBe(200);
      expect(ghCalls.filter((c) => c.args[1] === "clone")).toHaveLength(1);
      const head = await real.run("git", { args: ["rev-parse", "HEAD"], cwd: target });
      expect(head.code).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe("mapCloneError", () => {
  const res = (stderr: string, code = 1): RunResult => ({ stdout: "", stderr, code });
  it("not logged in → 409 with the fix", () => {
    const err = mapCloneError("a", "b", res("ERROR: You're not logged in. Run gh auth login."));
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/gh auth login/);
  });
  it("not found → 404", () => {
    for (const stderr of ["ERROR: Repository not found.", "404 Not Found", "could not resolve to a repository"]) {
      const err = mapCloneError("a", "b", res(stderr));
      expect(err.status).toBe(404);
      expect(err.message).toMatch(/not found/);
    }
  });
  it("no access → 403", () => {
    const err = mapCloneError("a", "b", res("403 Forbidden: you do not have permission"));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/no access/);
  });
  it("network failure → 502", () => {
    const err = mapCloneError("a", "b", res("fatal: Could not resolve host github.com"));
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/network failure/);
  });
  it("unknown output → 502 with the first line", () => {
    const err = mapCloneError("a", "b", res("weird exploded (exit?)", 7));
    expect(err.status).toBe(502);
    expect(err.message).toContain("a/b");
  });
});

describe("refreshManagedCheckout", () => {
  const managed = (id: string, dir: string): Repo => ({
    id,
    owner: "acme",
    name: "app",
    localPath: dir,
    lastOpened: 0,
    managed: true,
  });

  it("fetches managed clones only, coalesces simultaneous calls, honours the freshness window", async () => {
    let fetches = 0;
    const runner: CommandRunner = {
      run: async (cmd, o) => {
        if (cmd === "git" && o.args.includes("fetch")) {
          fetches += 1;
          await new Promise((r) => setTimeout(r, 60));
          return { stdout: "", stderr: "", code: 0 };
        }
        throw new Error(`unexpected: ${cmd} ${o.args.join(" ")}`);
      },
    };
    const repo = managed("rp_1", "/tmp/unused");
    const [a, b, c] = await Promise.all([
      refreshManagedCheckout(runner, repo),
      refreshManagedCheckout(runner, repo),
      refreshManagedCheckout(runner, repo),
    ]);
    expect([a, b, c]).toEqual([null, null, null]);
    expect(fetches).toBe(1);
    // Fresh: no new fetch.
    expect(await refreshManagedCheckout(runner, repo)).toBeNull();
    expect(fetches).toBe(1);

    // User checkouts are never fetched implicitly.
    const user: Repo = { ...repo, managed: false };
    delete (user as { managed?: boolean }).managed;
    expect(await refreshManagedCheckout(runner, user)).toBeNull();
    expect(fetches).toBe(1);
  });

  it("fetch failure degrades to a note, never throws", async () => {
    const runner: CommandRunner = {
      run: async () => ({ stdout: "", stderr: "offline", code: 1 }),
    };
    const note = await refreshManagedCheckout(runner, managed("rp_2", "/tmp/unused"));
    expect(note).toMatch(/couldn't update Unvibe's clone/);
  });
});

describe("GET /api/repos/:id/changes fetch behaviour", () => {
  it("fetches a managed clone before listing; fetch failure degrades with fetchError", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, gitCalls, ghCalls } = makeRunner({
      ghOther: { stdout: "[]", stderr: "", code: 0 },
      gitFetch: { stdout: "", stderr: "offline", code: 1 },
    });
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      expect(added.statusCode).toBe(200);
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      void ghCalls;

      gitCalls.length = 0;
      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=branches`,
        headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { changes: unknown[]; fetchError?: string };
      expect(body.fetchError).toMatch(/couldn't update Unvibe's clone/);
      expect(body.changes.length).toBeGreaterThan(0);
      expect(gitCalls.some((a) => a.includes("fetch"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("never fetches a user's own checkout", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-repo-"));
    const git = async (...args: string[]): Promise<void> => {
      const r = await real.run("git", { args, cwd: dir });
      if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };
    await git("init", "-b", "main");
    await git("config", "user.email", "t@example.com");
    await git("config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "f.txt"), "x\n");
    await git("add", ".");
    await git("commit", "-m", "init");

    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, gitCalls } = makeRunner({ ghOther: { stdout: "[]", stderr: "", code: 0 } });
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
      expect(repo.managed).toBeUndefined();

      gitCalls.length = 0;
      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=branches`,
        headers: authed(),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { fetchError?: string }).fetchError).toBeUndefined();
      expect(gitCalls.some((a) => a[0] === "fetch")).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("fetches before review ingest for managed clones", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner, gitCalls } = makeRunner({ ghOther: { stdout: "[]", stderr: "", code: 0 } });
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
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed(),
        payload: { repoId: repo.id, branch: "main" },
      });
      expect([201, 202]).toContain(created.statusCode);
      // #92: fetch runs after the 202 response (before the ingest) — poll.
      // #139: the credential config rides ahead of the fetch subcommand.
      const start = Date.now();
      while (
        Date.now() - start < 10000 &&
        !gitCalls.some((a) => a.includes("fetch") && a.includes("origin"))
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(gitCalls.some((a) => a.includes("fetch") && a.includes("origin"))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("DELETE /api/repos/:id", () => {
  it("deletes a managed clone from disk and forgets the row", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      expect(fs.existsSync(repo.localPath)).toBe(true);

      const del = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true, removedClone: true });
      expect(fs.existsSync(repo.localPath)).toBe(false);
      const list = await app.inject({ method: "GET", url: "/api/repos", headers: authed() });
      expect(reposOf(list.json()).some((r) => r.id === repo.id)).toBe(false);

      const again = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(again.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("leaves a user's checkout on disk untouched (forgets the row only)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-repo-"));
    await real.run("git", { args: ["init", "-b", "main"], cwd: dir });
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { path: dir },
      });
      const repo = reposOf(added.json()).find((r) => r.id !== "demo")!;
      const del = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true, removedClone: false });
      expect(fs.existsSync(path.join(dir, ".git"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("refuses while reviews exist (never orphans them)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed(),
        payload: { url: "acme/app" },
      });
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
      expect(fs.existsSync(repo.localPath)).toBe(true);

      // After deleting the review, removing the repo works.
      const reviewId = (created.json() as { review: { id: string } }).review.id;
      const delReview = await app.inject({ method: "DELETE", url: `/api/reviews/${reviewId}`, headers: authed() });
      expect(delReview.statusCode).toBe(200);
      const del2 = await app.inject({ method: "DELETE", url: `/api/repos/${repo.id}`, headers: authed() });
      expect(del2.statusCode).toBe(200);
      expect(fs.existsSync(repo.localPath)).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("404s unknown repos (and the synthetic demo)", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-managed-"));
    const { runner } = makeRunner();
    const { app } = await createApp("tok", { runner, dataDir, autoPipeline: false });
    try {
      expect((await app.inject({ method: "DELETE", url: "/api/repos/nope", headers: authed() })).statusCode).toBe(
        404,
      );
      expect((await app.inject({ method: "DELETE", url: "/api/repos/demo", headers: authed() })).statusCode).toBe(
        404,
      );
    } finally {
      await app.close();
    }
  });
});

describe("managed path guards", () => {
  it("managedRepoDir + isPathInside + assertManagedPath", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    expect(managedRepoDir(root, "acme", "app")).toBe(path.join(root, "repos", "acme", "app"));
    expect(() => managedRepoDir(root, "../x", "app")).toThrow(/unsafe/);
    expect(isPathInside(path.join(root, "repos"), path.join(root, "repos", "a", "b"))).toBe(true);
    expect(isPathInside(path.join(root, "repos"), root)).toBe(false);
    expect(isPathInside(path.join(root, "repos"), path.join(root, "other"))).toBe(false);

    expect(assertManagedPath(root, path.join(root, "repos", "acme", "app"))).toBe(
      path.join(root, "repos", "acme", "app"),
    );
    // The repos root itself, a parent, and anything outside all refuse.
    for (const p of [path.join(root, "repos"), root, "/tmp", path.join(root, "repos", "only-owner")]) {
      expect(() => assertManagedPath(root, p)).toThrow(/refusing to delete/);
    }
  });

  it("removeRepo refuses a managed row pointing outside the data dir", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-guard-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-outside-"));
    fs.writeFileSync(path.join(outside, "keep.txt"), "precious");
    const repos = {
      get: (): Repo | null => ({
        id: "rp_x",
        owner: "acme",
        name: "app",
        localPath: outside,
        lastOpened: 0,
        managed: true,
      }),
      remove: () => true,
      countReviews: () => 0,
    };
    expect(() => removeRepo(root, repos, "rp_x")).toThrow(/refusing to delete/);
    expect(fs.existsSync(path.join(outside, "keep.txt"))).toBe(true);
  });

  it("cloneArgv pins the blobless filter", () => {
    expect(cloneArgv("acme", "app", "/tmp/d")).toEqual([
      "repo",
      "clone",
      "acme/app",
      "/tmp/d",
      "--",
      "--filter=blob:none",
    ]);
  });
});
