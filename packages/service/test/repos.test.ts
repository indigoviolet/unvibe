/**
 * Repos: remote parsing, checkout detection, and the HTTP routes
 * (GET/POST /api/repos, GET /api/repos/:id/changes) with faked `gh` and
 * real `git` for branch listing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repo } from "@unvibe/shared";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/index.js";
import {
  detectCheckouts,
  parseGitHubRemote,
  resolveRepoRoots,
} from "../src/repos/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

describe("parseGitHubRemote", () => {
  it.each([
    ["git@github.com:acme/app.git", "acme", "app"],
    ["git@github.com:acme/app", "acme", "app"],
    ["https://github.com/acme/app.git", "acme", "app"],
    ["https://github.com/acme/app", "acme", "app"],
    ["ssh://git@github.com/acme/app.git", "acme", "app"],
    ["https://ghe.example.com/team/repo.git", "team", "repo"],
  ])("%s → %s/%s", (url, owner, name) => {
    expect(parseGitHubRemote(url)).toEqual({ owner, name });
  });

  it.each([["/local/path"], ["file:///x/y"], ["origin"], [""]])("%s → null", (url) => {
    expect(parseGitHubRemote(url)).toBeNull();
  });
});

describe("resolveRepoRoots + detectCheckouts", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.UNVIBE_REPO_ROOTS;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.UNVIBE_REPO_ROOTS;
    else process.env.UNVIBE_REPO_ROOTS = saved;
  });

  it("honours UNVIBE_REPO_ROOTS and finds checkouts two levels deep", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-roots-"));
    const direct = path.join(root, "direct");
    const nested = path.join(root, "group", "nested");
    fs.mkdirSync(path.join(direct, ".git"), { recursive: true });
    fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, "plain"));
    process.env.UNVIBE_REPO_ROOTS = root;
    expect(resolveRepoRoots()).toEqual([root]);
    expect(detectCheckouts([root])).toEqual([direct, nested].sort());
  });

  it("empty roots find nothing", () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    expect(detectCheckouts(resolveRepoRoots())).toEqual([]);
  });
});

async function makeGitRepo(dir: string): Promise<void> {
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
  await git("checkout", "-b", "feature-x");
  fs.writeFileSync(path.join(dir, "f.txt"), "x\ny\n");
  await git("commit", "-am", "change");
}

describe("repo routes", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.UNVIBE_REPO_ROOTS;
    process.env.UNVIBE_REPO_ROOTS = "";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.UNVIBE_REPO_ROOTS;
    else process.env.UNVIBE_REPO_ROOTS = saved;
  });

  it("POST validates the path and remembers the repo; GET lists it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-repo-"));
    await makeGitRepo(dir);
    const { app } = await createApp("tok", {runner: real, autoPipeline: false});
    const authed = { authorization: "Bearer tok" };
    try {
      const bad = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: path.join(dir, "missing") },
      });
      expect(bad.statusCode).toBe(400);

      const res = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { repos: Repo[] };
      expect(body.repos).toHaveLength(2);
      expect(body.repos[0]).toMatchObject({ id: "demo" });
      expect(body.repos[1]).toMatchObject({ localPath: dir, owner: "local" });

      const list = await app.inject({ method: "GET", url: "/api/repos", headers: authed });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { repos: Repo[] }).repos).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("changes lists branches and previous reviews; gh failures degrade gracefully", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-repo-"));
    await makeGitRepo(dir);
    // `gh` always fails here (offline behaviour); git still works.
    const fake = new FakeCommandRunner();
    fake.enqueue({ cmd: "gh", stdout: "", stderr: "offline", code: 1 });
    fake.enqueue({ cmd: "gh", stdout: "", stderr: "offline", code: 1 });
    const runner = {
      run: (cmd: string, opts: Parameters<FakeCommandRunner["run"]>[1]) =>
        cmd === "gh" ? fake.run(cmd, opts) : real.run(cmd, opts),
    };
    const { app } = await createApp("tok", {runner, autoPipeline: false});
    const authed = { authorization: "Bearer tok" };
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repo = (added.json() as { repos: Repo[] }).repos.find((r) => r.id !== "demo")!;

      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      const branches = (res.json() as { changes: { kind: string; branch?: string }[] }).changes.filter(
        (c) => c.kind === "branch",
      );
      expect(branches.map((b) => b.branch).sort()).toEqual(["feature-x", "main"]);

      // Open a review, then it shows up as kind "review" with stale=false.
      // #92: async open (202 loading) still lists immediately via LEFT JOIN.
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: repo.id, branch: "feature-x" },
      });
      expect([201, 202]).toContain(created.statusCode);

      const again = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=all`,
        headers: authed,
      });
      const reviews = (again.json() as { changes: { kind: string; stale?: boolean }[] }).changes.filter(
        (c) => c.kind === "review",
      );
      expect(reviews).toHaveLength(1);
      expect(reviews[0].stale).toBe(false);

      const badFilter = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=bogus`,
        headers: authed,
      });
      expect(badFilter.statusCode).toBe(400);

      const missing = await app.inject({
        method: "GET",
        url: "/api/repos/nope/changes",
        headers: authed,
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
