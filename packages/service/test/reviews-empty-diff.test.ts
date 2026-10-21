/**
 * #179: empty diff — a PR whose head equals its base, a local branch with
 * no changes, and a refresh that makes the diff empty must say so clearly
 * instead of opening a ready review with 0 hunks (and spending agent time).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot, ReviewsListResponse } from "@unvibe/shared";
import { FakeCommandRunner, RealCommandRunner, type CommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import { isGitFetch } from "./git-args.js";

const real = new RealCommandRunner();
const authed = { authorization: ["Bearer", "tok"].join(" ") };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-empty-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  return dir;
}

async function addRepo(app: Awaited<ReturnType<typeof createApp>>["app"], dir: string): Promise<string> {
  process.env.UNVIBE_REPO_ROOTS = "";
  const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
  return (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
}

async function awaitStatus(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  id: string,
  want: "ready" | "failed" | "empty",
  timeoutMs = 15000,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (res.statusCode === 200) {
      const snap = res.json() as ReviewSnapshot;
      const st = snap.ingest?.status ?? "ready";
      if (st === want && (want !== "ready" || (snap.version?.n ?? 0) >= 1)) return snap;
      if (want === "empty" && st === "ready") {
        throw new Error(`ingest became ready with ${(snap.files ?? []).length} files instead of empty: ${JSON.stringify(snap.ingest)}`);
      }
      if (st === "failed" && want !== "failed") throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${want} of ${id}`);
}

describe("empty diff (#179)", () => {
  it("PR whose head equals its base is empty, not ready, and starts no pipeline", async () => {
    const dir = await makeRepo();
    const baseSha = await git(dir, "rev-parse", "main");
    // Branch equal to base (e.g. merged PR whose branch now equals base).
    await git(dir, "checkout", "-b", "feature");
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "gh",
      stdout: JSON.stringify({
        title: "Merged PR",
        body: "Body.",
        author: { login: "octocat" },
        state: "MERGED",
        isDraft: false,
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: baseSha,
      }),
      stderr: "",
      code: 0,
    });
    const runner: CommandRunner = {
      run: (cmd, opts) => {
        if (cmd === "gh") return fake.run(cmd, opts);
        if (cmd === "git" && isGitFetch(opts.args)) return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const started: string[] = [];
    const fakePipeline = {
      startReview: (id: string): Promise<void> => {
        started.push(id);
        return Promise.resolve();
      },
    };
    const { app } = await createApp("tok", { runner, autoPipeline: true, pipeline: fakePipeline as never });
    try {
      const repoId = await addRepo(app, dir);
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42, title: "Merged PR", author: "octocat" },
      });
      expect(created.statusCode).toBe(202);
      const id = (created.json() as ReviewSnapshot).review.id;
      const snap = await awaitStatus(app, id, "empty");
      expect(snap.ingest?.error ?? "").toMatch(/No changes to review/);
      expect(snap.ingest?.error ?? "").toMatch(/merged|same as its base/);
      expect(snap.version.n).toBe(0);
      expect(started).toEqual([]);
      // Front-screen row carries the empty state + message.
      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      const found = (list.json() as ReviewsListResponse).reviews.find((r) => r.id === id);
      expect(found?.ingestStatus).toBe("empty");
      expect(found?.ingestError ?? "").toMatch(/No changes to review/);
      // Actions refuse cleanly while empty.
      const refresh = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(refresh.statusCode).toBe(409);
      expect((refresh.json() as { error: string }).error).toMatch(/No changes to review/);
    } finally {
      await app.close();
    }
  });

  it("local branch with no changes is empty, not ready", async () => {
    const dir = await makeRepo();
    await git(dir, "checkout", "-b", "feature");
    const started: string[] = [];
    const fakePipeline = {
      startReview: (id: string): Promise<void> => {
        started.push(id);
        return Promise.resolve();
      },
    };
    const { app } = await createApp("tok", { runner: real, autoPipeline: true, pipeline: fakePipeline as never });
    try {
      const repoId = await addRepo(app, dir);
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      expect(created.statusCode).toBe(202);
      const id = (created.json() as ReviewSnapshot).review.id;
      const snap = await awaitStatus(app, id, "empty");
      expect(snap.ingest?.error ?? "").toMatch(/No changes to review/);
      expect(snap.version.n).toBe(0);
      expect(started).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("refresh that makes the diff empty says so and refuses the update pass", async () => {
    const dir = await makeRepo();
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "change");
    const { app } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const repoId = await addRepo(app, dir);
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const id = (created.json() as ReviewSnapshot).review.id;
      const ready = await awaitStatus(app, id, "ready");
      expect(ready.files.reduce((n, f) => n + f.hunks.length, 0)).toBeGreaterThan(0);

      // Move feature back to main: new head differs, diff becomes empty.
      await git(dir, "checkout", "feature");
      await git(dir, "reset", "--hard", "main");
      const refreshed = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(refreshed.statusCode).toBe(200);
      const body = refreshed.json() as { newVersion: boolean; comparison?: { removedHunks: number } };
      expect(body.newVersion).toBe(true);
      const after = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      const snap = after.json() as ReviewSnapshot;
      expect(snap.files).toEqual([]);
      expect(snap.versionStatus?.empty).toBe(true);
      // Update pass must not spend agent time on an empty diff.
      const update = await app.inject({ method: "POST", url: `/api/reviews/${id}/update`, headers: authed });
      expect(update.statusCode).toBe(409);
      expect((update.json() as { error: string }).error).toMatch(/empty|No changes/);
    } finally {
      await app.close();
    }
  });
});
