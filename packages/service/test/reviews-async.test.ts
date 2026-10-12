/**
 * #92: async open — POST answers before ingest, loading→ready via patches,
 * failed + retry + remove, restart resume, duplicate dedupe, pipeline after
 * ingest, old rows load as ready.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshot, ReviewsListResponse } from "@unvibe/shared";
import { isDefaultGuideTitle } from "@unvibe/shared";
import { FakeCommandRunner, RealCommandRunner, type CommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import { openDatabase, migrate } from "../src/store/index.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-async-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
  await git(dir, "commit", "-am", "change");
  return dir;
}

/** Runner whose `gh pr view` blocks until released (for "answers before ingest"). */
function heldGhRunner(): {
  runner: CommandRunner;
  release: (stdout: string) => void;
  fail: (stderr: string) => void;
  fetches: string[];
} {
  let releaseFn: ((v: { stdout: string; code: number }) => void) | null = null;
  let failFn: ((e: string) => void) | null = null;
  const fetches: string[] = [];
  const runner: CommandRunner = {
    run: (cmd, opts) => {
      if (cmd === "gh") {
        return new Promise((resolve, reject) => {
          releaseFn = (v) => resolve({ stdout: v.stdout, stderr: "", code: v.code });
          failFn = (e) => reject(new Error(e));
          void opts;
        }) as Promise<{ stdout: string; stderr: string; code: number }>;
      }
      if (cmd === "git" && opts.args[0] === "fetch") {
        fetches.push(opts.args.join(" "));
        return Promise.resolve({ stdout: "", stderr: "", code: 0 });
      }
      return real.run(cmd, opts);
    },
  };
  return {
    runner,
    release: (stdout: string) => releaseFn?.({ stdout, code: 0 }),
    fail: (stderr: string) => failFn?.(stderr),
    fetches,
  };
}

function ghPrView(head: string): string {
  return JSON.stringify({
    title: "Held PR",
    body: "Body.",
    author: { login: "octocat" },
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: head,
  });
}

async function awaitStatus(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  id: string,
  want: "ready" | "failed",
  timeoutMs = 15000,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (res.statusCode === 200) {
      const snap = res.json() as ReviewSnapshot;
      const st = snap.ingest?.status ?? "ready";
      if (st === want && (want === "failed" || (snap.version?.n ?? 0) >= 1)) return snap;
      if (st === "failed" && want === "ready") throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${want} of ${id}`);
}

describe("POST /api/reviews async (#92)", () => {
  it("answers 202 before the ingest completes (held gh)", async () => {
    const dir = await makeRepo();
    const head = await git(dir, "rev-parse", "feature");
    const held = heldGhRunner();
    const { app } = await createApp("tok", { runner: held.runner, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42, title: "Held PR", author: "octocat" },
      });
      // Answers at once with the id, while gh is still blocked.
      expect(created.statusCode).toBe(202);
      const loading = created.json() as ReviewSnapshot;
      expect(loading.review.id).toMatch(/^rv_/);
      expect(loading.ingest?.status).toBe("loading");
      expect(loading.ingest?.step).toBe("fetching");
      // Loading shows in Previous reviews (GET list) while blocked.
      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      const found = (list.json() as { reviews: { id: string; ingestStatus?: string }[] }).reviews.find(
        (r) => r.id === loading.review.id,
      );
      expect(found?.ingestStatus).toBe("loading");

      // Release gh → background lands → ready with patch (rev bumps).
      held.release(ghPrView(head));
      const ready = await awaitStatus(app, loading.review.id, "ready");
      expect(ready.version.headSha).toBe(head);
      expect(ready.files.length).toBeGreaterThan(0);
      expect(ready.rev).toBeGreaterThan(loading.rev);
    } finally {
      await app.close();
    }
  });

  it("loading reviews show the hint title or branch, never the default guide title", async () => {
    const dir = await makeRepo();
    const head = await git(dir, "rev-parse", "feature");
    const held = heldGhRunner();
    const { app } = await createApp("tok", { runner: held.runner, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;

      async function listTitle(id: string): Promise<string> {
        const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
        expect(list.statusCode).toBe(200);
        const title = (list.json() as ReviewsListResponse).reviews.find((r) => r.id === id)?.title;
        expect(title).toBeDefined();
        return title as string;
      }

      // Hinted PR: the hint shows while loading (gh still blocked).
      const hinted = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42, title: "Held PR", author: "octocat" },
      });
      expect(hinted.statusCode).toBe(202);
      const hintedId = (hinted.json() as ReviewSnapshot).review.id;
      expect(await listTitle(hintedId)).toBe("Held PR");
      held.release(ghPrView(head));
      await awaitStatus(app, hintedId, "ready");

      // Unhinted PR: the "PR #N" fallback shows while loading, never the default.
      const bare = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 43 },
      });
      expect(bare.statusCode).toBe(202);
      const bareId = (bare.json() as ReviewSnapshot).review.id;
      const bareTitle = await listTitle(bareId);
      expect(bareTitle).toBe("PR #43");
      expect(isDefaultGuideTitle(bareTitle)).toBe(false);
      held.release(ghPrView(head));
      await awaitStatus(app, bareId, "ready");

      // Unhinted branch: the branch name shows (loading or ready — same value either way).
      const branched = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      expect([201, 202]).toContain(branched.statusCode);
      const branchId = (branched.json() as ReviewSnapshot).review.id;
      expect(await listTitle(branchId)).toBe("feature");
      await awaitStatus(app, branchId, "ready");
    } finally {
      await app.close();
    }
  });

  it("failed ingest shows the error; retry succeeds; remove works", async () => {
    const dir = await makeRepo();
    const fake = new FakeCommandRunner();
    // Ingest gh fails (unknown PR).
    fake.enqueue({ cmd: "gh", stdout: "", stderr: "no such PR", code: 1 });
    const runner: CommandRunner = {
      run: (cmd, opts) => {
        if (cmd === "gh") return fake.run(cmd, opts);
        if (cmd === "git" && opts.args[0] === "fetch") return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app } = await createApp("tok", { runner, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 999 },
      });
      expect(created.statusCode).toBe(202);
      const id = (created.json() as ReviewSnapshot).review.id;
      const failed = await awaitStatus(app, id, "failed");
      expect(failed.ingest?.error ?? "").toMatch(/no such PR|gh pr view/);
      // Must not look like a normal empty review (no version, marked failed).
      expect(failed.version.n).toBe(0);

      // Actions refused cleanly while failed.
      const refresh = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(refresh.statusCode).toBe(409);

      // Retry with a good gh → ready.
      const head = await git(dir, "rev-parse", "feature");
      fake.enqueue({
        cmd: "gh",
        stdout: JSON.stringify({
          title: "Now found",
          body: "",
          author: { login: "a" },
          state: "OPEN",
          isDraft: false,
          baseRefName: "main",
          headRefName: "feature",
          headRefOid: head,
        }),
        stderr: "",
        code: 0,
      });
      const retried = await app.inject({ method: "POST", url: `/api/reviews/${id}/retry`, headers: authed });
      expect([200, 202]).toContain(retried.statusCode);
      const ready = await awaitStatus(app, id, "ready");
      expect(ready.version.headSha).toBe(head);

      // Remove works.
      const del = await app.inject({ method: "DELETE", url: `/api/reviews/${id}`, headers: authed });
      expect(del.statusCode).toBe(200);
      const gone = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect(gone.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("same PR opened twice while loading returns one review", async () => {
    const dir = await makeRepo();
    const head = await git(dir, "rev-parse", "feature");
    const held = heldGhRunner();
    const { app } = await createApp("tok", { runner: held.runner, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const first = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42 },
      });
      expect(first.statusCode).toBe(202);
      const id1 = (first.json() as ReviewSnapshot).review.id;
      // Second open while the first is still loading (gh held) → same review.
      const second = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42 },
      });
      expect([200, 202]).toContain(second.statusCode);
      const id2 = (second.json() as ReviewSnapshot).review.id;
      expect(id2).toBe(id1);

      held.release(ghPrView(head));
      await awaitStatus(app, id1, "ready");
    } finally {
      await app.close();
    }
  });

  it("pipeline starts only after the ingest succeeds", async () => {
    const dir = await makeRepo();
    const head = await git(dir, "rev-parse", "feature");
    const held = heldGhRunner();
    const started: string[] = [];
    const fakePipeline = {
      startReview: (id: string): Promise<void> => {
        started.push(id);
        return Promise.resolve();
      },
    };
    const { app } = await createApp("tok", {
      runner: held.runner,
      autoPipeline: true,
      pipeline: fakePipeline as unknown as Parameters<typeof createApp>[1] extends { pipeline?: infer P } ? P : never,
    });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 42 },
      });
      const id = (created.json() as ReviewSnapshot).review.id;
      // Still loading (gh held) → pipeline not started.
      await new Promise((r) => setTimeout(r, 200));
      expect(started).toEqual([]);
      held.release(ghPrView(head));
      await awaitStatus(app, id, "ready");
      expect(started).toEqual([id]);
    } finally {
      await app.close();
    }
  });

  it("restart mid-ingest resumes (or fails) instead of loading forever", async () => {
    const dir = await makeRepo();
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-restart-"));
    const dbFile = path.join(dataDir, "unvibe.db");
    const db1 = openDatabase(dbFile);
    migrate(db1);
    // App 1: create a branch review and wait ready, then fake a crash
    // by flipping its snapshot back to loading (durable marker).
    const { app: app1, ctx: ctx1 } = await createApp("tok", { runner: real, db: db1, dataDir, autoPipeline: false });
    let id = "";
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app1.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app1.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      id = (created.json() as ReviewSnapshot).review.id;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const got = await app1.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
        const snap = got.json() as ReviewSnapshot;
        if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // Simulate SIGKILL mid-ingest: snapshot stuck loading.
      await ctx1.reviews.mutate(id, (draft) => {
        draft.ingest = { status: "loading", step: "fetching" };
      });
    } finally {
      await app1.close();
    }
    // App 2 on the same db file + data dir (restart): resume runs on startup.
    const db2 = openDatabase(dbFile);
    migrate(db2);
    const { app: app2 } = await createApp("tok", { runner: real, db: db2, dataDir, autoPipeline: false });
    try {
      const ready = await awaitStatus(app2, id, "ready");
      expect(ready.version.n).toBeGreaterThanOrEqual(1);
    } finally {
      await app2.close();
    }
  });

  it("a failed open stays failed across a restart, and Retry works there", async () => {
    const dir = await makeRepo();
    const head = await git(dir, "rev-parse", "feature");
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-failed-restart-"));
    const dbFile = path.join(dataDir, "unvibe.db");
    const db1 = openDatabase(dbFile);
    migrate(db1);
    const failing = new FakeCommandRunner();
    failing.enqueue({ cmd: "gh", stdout: "", stderr: "no such PR", code: 1 });
    const failingRunner: CommandRunner = {
      run: (cmd, opts) => {
        if (cmd === "gh") return failing.run(cmd, opts);
        if (cmd === "git" && opts.args[0] === "fetch") return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app: app1 } = await createApp("tok", { runner: failingRunner, db: db1, dataDir, autoPipeline: false });
    let id = "";
    let repoId = "";
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app1.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app1.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, pr: 999 },
      });
      expect(created.statusCode).toBe(202);
      id = (created.json() as ReviewSnapshot).review.id;
      const failed = await awaitStatus(app1, id, "failed");
      expect(failed.ingest?.error ?? "").toContain("no such PR");
    } finally {
      await app1.close();
    }
    // Restart on the same db file + data dir with working gh: nothing is in
    // memory, the row is still failed, and Retry runs the ingest again.
    const db2 = openDatabase(dbFile);
    migrate(db2);
    const good = new FakeCommandRunner();
    good.enqueue({
      cmd: "gh",
      stdout: ghPrView(head),
      stderr: "",
      code: 0,
    });
    const goodRunner: CommandRunner = {
      run: (cmd, opts) => {
        if (cmd === "gh") return good.run(cmd, opts);
        if (cmd === "git" && opts.args[0] === "fetch") return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app: app2 } = await createApp("tok", { runner: goodRunner, db: db2, dataDir, autoPipeline: false });
    try {
      const still = await app2.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect(still.statusCode).toBe(200);
      const snap = still.json() as ReviewSnapshot;
      expect(snap.ingest?.status).toBe("failed");
      expect(snap.ingest?.error ?? "").toContain("no such PR");
      const retried = await app2.inject({ method: "POST", url: `/api/reviews/${id}/retry`, headers: authed });
      expect([200, 202]).toContain(retried.statusCode);
      const ready = await awaitStatus(app2, id, "ready");
      expect(ready.version.headSha).toBe(head);
      expect(ready.review.repoId).toBe(repoId);
    } finally {
      await app2.close();
    }
  });

  it("an old stored review (no ingest field) loads as ready", async () => {
    const dir = await makeRepo();
    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const id = (created.json() as ReviewSnapshot).review.id;
      const ready = await awaitStatus(app, id, "ready");
      // Strip the ingest field to simulate a pre-#92 row.
      const raw = ctx.db.prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?").get(id) as {
        snapshot: string;
      };
      const parsed = JSON.parse(raw.snapshot) as Record<string, unknown>;
      delete parsed.ingest;
      ctx.db.prepare("UPDATE review_snapshots SET snapshot = ? WHERE review_id = ?").run(JSON.stringify(parsed), id);
      const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect(got.statusCode).toBe(200);
      const snap = got.json() as ReviewSnapshot;
      expect(snap.version.n).toBe(1);
      expect(snap.ingest?.status ?? "ready").toBe("ready");
      expect(ready.review.id).toBe(id);
    } finally {
      await app.close();
    }
  });
});
