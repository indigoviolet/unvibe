/**
 * Front-screen review list (GET /api/reviews) + delete (DELETE /api/reviews/:id).
 *
 * - Lists every review across ALL repos, most recent first, with summary
 *   fields (title, repo, PR/branch, last opened, version count, stale,
 *   progress, guide status).
 * - DELETE removes local data + managed worktree, never touches GitHub or
 *   the checkout (asserted via the command runner calls).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSummary, ReviewsListResponse, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { RealCommandRunner } from "../src/exec/index.js";
import { StaticModelCatalog } from "../src/settings/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-list-"));
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

/** #92: wait for the background ingest (POST answers 202 loading). */
async function awaitReady(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  id: string,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (res.statusCode === 200) {
      const snap = res.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "failed") throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ${id}`);
}

describe("GET /api/reviews + DELETE /api/reviews/:id", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("lists empty, then summaries across repos most-recent-first", async () => {
    const dir = await makeRepo();
    const { app } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const empty = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      expect(empty.statusCode).toBe(200);
      expect((empty.json() as ReviewsListResponse).reviews).toEqual([]);

      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;

      const c1 = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      expect([201, 202]).toContain(c1.statusCode);
      const id1 = (c1.json() as ReviewSnapshot).review.id;
      await awaitReady(app, id1);

      // Touch ordering: opening the first review bumps its lastOpened.
      await app.inject({ method: "GET", url: `/api/reviews/${id1}`, headers: authed });

      await git(dir, "checkout", "-b", "feature2");
      fs.writeFileSync(path.join(dir, "b.py"), "z = 9\n");
      await git(dir, "add", ".");
      await git(dir, "commit", "-m", "second");
      const c2 = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature2" },
      });
      const id2 = (c2.json() as ReviewSnapshot).review.id;
      await awaitReady(app, id2);

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      expect(list.statusCode).toBe(200);
      const reviews = (list.json() as ReviewsListResponse).reviews;
      expect(reviews).toHaveLength(2);
      // Most recent first: feature2 (created last) before feature.
      expect(reviews.map((r: ReviewSummary) => r.id)).toEqual([id2, id1]);
      for (const r of reviews) {
        expect(typeof r.title).toBe("string");
        expect(r.title.length).toBeGreaterThan(0);
        expect(r.repoId).toBe(repoId);
        expect(typeof r.lastOpened).toBe("number");
        expect(r.versionCount).toBe(1);
        expect(r.currentVersion).toBe(1);
        expect(typeof r.stale).toBe("boolean");
        expect(typeof r.totalHunks).toBe("number");
        expect(typeof r.reviewedHunks).toBe("number");
        expect(typeof r.pendingComments).toBe("number");
        expect(["ready", "running", "error", "idle", "disabled"]).toContain(r.guideStatus);
      }
      // Titles fall back to branch names when no PR title is stored.
      expect(reviews.find((r) => r.id === id1)?.branch).toBe("feature");
    } finally {
      await app.close();
    }
  });

  it("marks reviewed hunks + pending comments + stale in the summary", async () => {
    const dir = await makeRepo();
    const { app, ctx } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const loading = created.json() as ReviewSnapshot;
      const id = loading.review.id;
      const snap = await awaitReady(app, id);
      const hash = snap.files[0].hunks[0].contentHash;

      await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { reviewed: true },
      });
      // An Outbox thread → pendingComments = 1.
      const thread = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/comments`,
        headers: authed,
        payload: {
          anchor: { where: "diff-line", fileKey: snap.files[0].fileKey, line: 1 },
          quote: "x = 1",
          text: "please fix",
        },
      });
      expect(thread.statusCode).toBe(201);
      const commentId = (thread.json() as { id: string }).id;
      await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/comments/${commentId}`,
        headers: authed,
        payload: { post: true },
      });

      // New commit → refresh makes it stale.
      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "more");
      const refreshed = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/refresh`,
        headers: authed,
      });
      expect(refreshed.statusCode).toBe(200);

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      const summary = (list.json() as ReviewsListResponse).reviews.find((r) => r.id === id)!;
      expect(summary.reviewedHunks).toBe(1);
      expect(summary.pendingComments).toBe(1);
      expect(summary.stale).toBe(true);
      expect(summary.versionCount).toBe(2);
      void ctx;
    } finally {
      await app.close();
    }
  });

  it("DELETE removes local data + worktree and never calls gh", async () => {
    const dir = await makeRepo();
    const calls: string[] = [];
    const runner = {
      run: async (cmd: string, opts: Parameters<RealCommandRunner["run"]>[1]) => {
        calls.push(`${cmd} ${opts.args.join(" ")}`);
        return real.run(cmd, opts);
      },
    };
    const { app, ctx } = await createApp("tok", {
      runner,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const id = (created.json() as ReviewSnapshot).review.id;
      await awaitReady(app, id);
      const wt = path.join(ctx.dataDir, "worktrees", id);
      expect(fs.existsSync(wt)).toBe(true);

      calls.length = 0;
      const del = await app.inject({ method: "DELETE", url: `/api/reviews/${id}`, headers: authed });
      expect(del.statusCode).toBe(200);
      expect(del.json()).toEqual({ ok: true });
      expect(fs.existsSync(wt)).toBe(false);
      // Worktree removal uses git only; checkout itself is untouched.
      expect(calls.some((c) => c.startsWith("gh "))).toBe(false);
      expect(calls.some((c) => c.includes("worktree"))).toBe(true);
      expect(fs.existsSync(path.join(dir, "a.py"))).toBe(true);

      // Gone from the list and the snapshot store.
      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      expect((list.json() as ReviewsListResponse).reviews.find((r) => r.id === id)).toBeUndefined();
      expect(ctx.reviews.getSnapshot(id)).toBeNull();
      const again = await app.inject({ method: "DELETE", url: `/api/reviews/${id}`, headers: authed });
      expect(again.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("POST /api/reset removes every review, keeps settings and repos, never calls gh", async () => {
    const dir = await makeRepo();
    const calls: string[] = [];
    const runner = {
      run: async (cmd: string, opts: Parameters<RealCommandRunner["run"]>[1]) => {
        calls.push(`${cmd} ${opts.args.join(" ")}`);
        return real.run(cmd, opts);
      },
    };
    const { app, ctx } = await createApp("tok", {
      runner,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const id = (created.json() as ReviewSnapshot).review.id;
      await awaitReady(app, id);
      const wt = path.join(ctx.dataDir, "worktrees", id);
      expect(fs.existsSync(wt)).toBe(true);
      const settingsBefore = (await app.inject({ method: "GET", url: "/api/settings", headers: authed })).json();

      // Refused while a review is being submitted.
      ctx.db
        .prepare("INSERT INTO submit_leases (review_id, started_at, commit_id) VALUES (?, ?, 'abc')")
        .run(id, Date.now());
      const busy = await app.inject({ method: "POST", url: "/api/reset", headers: authed });
      expect(busy.statusCode).toBe(409);
      expect(fs.existsSync(wt)).toBe(true);
      ctx.db.prepare("DELETE FROM submit_leases").run();

      calls.length = 0;
      const reset = await app.inject({ method: "POST", url: "/api/reset", headers: authed });
      expect(reset.statusCode).toBe(200);
      expect(reset.json()).toEqual({ ok: true, reviewsRemoved: 1 });
      expect(fs.existsSync(wt)).toBe(false);
      expect(calls.some((c) => c.startsWith("gh "))).toBe(false);
      expect(fs.existsSync(path.join(dir, "a.py"))).toBe(true);

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      expect((list.json() as ReviewsListResponse).reviews).toEqual([]);
      expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM review_snapshots").get()).toEqual({ n: 0 });
      const repos = await app.inject({ method: "GET", url: "/api/repos", headers: authed });
      expect((repos.json() as { repos: { id: string }[] }).repos.some((r) => r.id === repoId)).toBe(true);
      const settingsAfter = (await app.inject({ method: "GET", url: "/api/settings", headers: authed })).json();
      expect(settingsAfter).toEqual(settingsBefore);

      const anon = await app.inject({ method: "POST", url: "/api/reset" });
      expect(anon.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("DELETE is gated by the token", async () => {
    const { app } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const anon = await app.inject({ method: "DELETE", url: "/api/reviews/rv_nope" });
      expect(anon.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("legacy and new default root titles both fall back to the branch (#102)", async () => {
    const dir = await makeRepo();
    const { app, ctx } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!.id;

      async function makeReviewWithRoot(branch: string, rootTitle: string): Promise<string> {
        const created = await app.inject({
          method: "POST",
          url: "/api/reviews",
          headers: authed,
          payload: { repoId, branch },
        });
        // #92: creation answers before the ingest; wait until ready.
        expect([201, 202]).toContain(created.statusCode);
        const id = (created.json() as ReviewSnapshot).review.id;
        await awaitReady(app, id);
        // Simulate stored state: no PR title on the row, chosen root title in the snapshot.
        ctx.db.prepare("UPDATE reviews SET data = ? WHERE id = ?").run(JSON.stringify({ title: "" }), id);
        const snap = ctx.reviews.getSnapshot(id);
        expect(snap).not.toBeNull();
        // Fresh reviews have no root page until the reader runs; add one like the runner does.
        const existing = snap!.pages.find((p) => p.id === "root");
        if (existing) {
          existing.title = rootTitle;
        } else {
          snap!.pages.unshift({ id: "root", kind: "root", title: rootTitle, cards: [] });
        }
        ctx.reviews.putSnapshot(id, snap!);
        return id;
      }

      const current = await makeReviewWithRoot("feature", "Guide");
      await git(dir, "checkout", "-b", "feature3");
      const real = await makeReviewWithRoot("feature3", "Unfold obsolete folded response headers");

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      expect(list.statusCode).toBe(200);
      const reviews = (list.json() as ReviewsListResponse).reviews;
      // The default means "no real title": fall back to the branch.
      expect(reviews.find((r) => r.id === current)?.title).toBe("feature");
      // A real root title is shown unchanged.
      expect(reviews.find((r) => r.id === real)?.title).toBe("Unfold obsolete folded response headers");
    } finally {
      await app.close();
    }
  });
});
