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
