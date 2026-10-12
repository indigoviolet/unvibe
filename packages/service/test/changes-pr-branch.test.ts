/**
 * #91: `searchPrs` (`gh search prs` for number,title,author,updatedAt only)
 * yields PR rows with no `branch` — the start page must cope (no
 * "undefined", no dangling separator). The row-text half lives in the web
 * (`changeHead`, tested in `StartPage.test.tsx`); here the service half:
 * the rows really arrive without `branch`.
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
  // A GitHub `origin` so `searchPrs` runs (local-only repos skip gh).
  await git("remote", "add", "origin", "https://github.com/acme/app.git");
}

describe("repoChanges PR rows carry no branch (#91)", () => {
  it("authoring PR rows omit branch (gh has no head-branch field)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch91-"));
    await makeGitRepo(dir);
    const fake = new FakeCommandRunner();
    // `gh search prs` JSON has no branch field — mirror the real shape.
    fake.enqueue({
      cmd: "gh",
      stdout: JSON.stringify([
        { number: 5011, title: "Fix retry backoff", author: { login: "you" }, updatedAt: "2026-10-01T00:00:00Z" },
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
      expect(changes).toHaveLength(1);
      expect(changes[0].kind).toBe("pr");
      expect(changes[0].prNumber).toBe(5011);
      expect(changes[0].branch).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
