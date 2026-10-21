/**
 * #91: PR rows carry the head branch from `gh pr list --json headRefName`
 * (the old `gh search prs` source had no head-branch field). Rows where
 * `gh` omits the branch still render without one — the start page shows
 * `#N`, never `#N · undefined` (row-text half in `StartPage.test.tsx`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

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
  // A GitHub `origin` so the `gh` lists run (local-only repos skip gh).
  await git("remote", "add", "origin", "https://github.com/acme/app.git");
}

describe("repoChanges PR rows carry the head branch (#91)", () => {
  it("authoring PR rows carry branch from headRefName; omitted when gh omits it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch91-"));
    await makeGitRepo(dir);
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "gh",
      stdout: JSON.stringify([
        {
          number: 5011,
          title: "Fix retry backoff",
          author: { login: "you" },
          updatedAt: "2026-10-01T00:00:00Z",
          headRefName: "fix-retry-backoff",
        },
        { number: 5012, title: "Branch unknown to gh" },
      ]),
      stderr: "",
      code: 0,
    });
    const runner = {
      run: (cmd: string, opts: Parameters<FakeCommandRunner["run"]>[1]) =>
        cmd === "gh" ? fake.run(cmd, opts) : real.run(cmd, opts),
    };
    const { app } = await createApp("tok", { runner, autoPipeline: false });
    const authed = { authorization: "Bearer tok" };
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
      const res = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=authoring`,
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      const changes = (res.json() as { changes: { kind: string; prNumber?: number; branch?: string }[] }).changes;
      expect(changes).toHaveLength(2);
      const byNumber = new Map(changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(5011)?.branch).toBe("fix-retry-backoff");
      expect(byNumber.get(5012)?.branch).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("repoChanges review markers (#149)", () => {
  async function git(cwd: string, ...args: string[]): Promise<string> {
    const res = await real.run("git", { args, cwd });
    if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
    return res.stdout.trim();
  }

  it("PR and branch rows carry the existing review id; a PR review does not mark its branch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch149-"));
    await makeGitRepo(dir);
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "f.txt"), "x\ny\n");
    await git(dir, "commit", "-am", "feature change");
    await git(dir, "checkout", "-b", "topic");
    fs.writeFileSync(path.join(dir, "f.txt"), "x\ny\nz\n");
    await git(dir, "commit", "-am", "topic change");
    const head = await git(dir, "rev-parse", "feature");

    const fake = new FakeCommandRunner();
    // PR #77 ingest view (head = feature).
    fake.enqueue({
      cmd: "gh",
      args: ["pr", "view", "77", "--json", "title,body,author,state,isDraft,reviewDecision,baseRefName,headRefName,headRefOid"],
      stdout: JSON.stringify({
        title: "Feature PR",
        body: "",
        author: { login: "you" },
        state: "OPEN",
        isDraft: false,
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: head,
      }),
      stderr: "",
      code: 0,
    });
    // Authoring list: PR #77 only.
    fake.enqueue({
      cmd: "gh",
      args: [
        "pr",
        "list",
        "--repo",
        "acme/app",
        "--author",
        "@me",
        "--json",
        "number,title,author,updatedAt,headRefName,additions,deletions,changedFiles,url,state,isDraft,reviewDecision,reviewRequests",
        "--limit",
        "30",
      ],
      stdout: JSON.stringify([{ number: 77, title: "Feature PR", headRefName: "feature" }]),
      stderr: "",
      code: 0,
    });
    // Issue #168: the ingest loads existing comments (none here), so the
    // scripted sequence above is never disturbed by the extra `gh` call.
    fake.enqueue({
      cmd: "gh",
      args: ["api", "repos/acme/app/pulls/77/comments"],
      stdout: "[]",
      stderr: "",
      code: 0,
    });
    const { isGitFetch } = await import("./git-args.js");
    const runner = {
      run: (cmd: string, opts: Parameters<FakeCommandRunner["run"]>[1]) => {
        if (cmd === "gh") return fake.run(cmd, opts);
        if (cmd === "git" && isGitFetch(opts.args)) return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app } = await createApp("tok", { runner, autoPipeline: false });
    const authed = { authorization: "Bearer tok" };
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
      const pr = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: repo.id, pr: 77 },
      });
      expect(pr.statusCode).toBe(202);
      const prId = (pr.json() as { review: { id: string } }).review.id;
      // Wait for the PR ingest to land.
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const got = await app.inject({ method: "GET", url: `/api/reviews/${prId}`, headers: authed });
        const snap = got.json() as { ingest?: { status?: string }; version?: { n?: number } };
        if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const br = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: repo.id, branch: "topic" },
      });
      const brId = (br.json() as { review: { id: string } }).review.id;
      expect(brId).not.toBe(prId);

      const authoring = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=authoring`,
        headers: authed,
      });
      expect(authoring.statusCode).toBe(200);
      const prRows = (authoring.json() as { changes: { prNumber?: number; reviewId?: string }[] }).changes;
      expect(prRows.find((c) => c.prNumber === 77)?.reviewId).toBe(prId);

      const branches = await app.inject({
        method: "GET",
        url: `/api/repos/${repo.id}/changes?filter=branches`,
        headers: authed,
      });
      expect(branches.statusCode).toBe(200);
      const branchRows = (branches.json() as { changes: { branch?: string; reviewId?: string }[] }).changes;
      // The branch-only review marks its branch…
      expect(branchRows.find((c) => c.branch === "topic")?.reviewId).toBe(brId);
      // …but the PR review does not mark its head branch (different source).
      expect(branchRows.find((c) => c.branch === "feature")?.reviewId).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
