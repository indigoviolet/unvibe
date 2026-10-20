// DISABLED(#188): covered by J14 (re-do a review)
/**
 * Re-do guide (#115): `POST /api/reviews/:id/redo` deletes + re-creates
 * through the existing paths and answers with the new review's loading
 * snapshot. Uses the fake `AgentRunner`, real git, no GitHub.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import { clearSubmitLease, writeSubmitLease } from "../src/submit/lease.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

type App = Awaited<ReturnType<typeof createApp>>;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-redo-"));
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

/** Minimal valid reader reply: two cards, then the trailing JSON block. */
function readerAgent(): FakeAgentRunner {
  return new FakeAgentRunner([
    {
      match: "Reader",
      events: [
        { type: "text", delta: "It was broken.\n\n## The central change\n\nNow it works.\n\n```json\n{}\n```\n" },
        { type: "done", stopReason: "end_turn" },
      ],
    },
  ]);
}

/** #92: poll GET until the background ingest lands (or throws on failure). */
async function awaitReady(app: App["app"], id: string, timeoutMs = 15000): Promise<ReviewSnapshot> {
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (res.statusCode === 200) {
      const snap = res.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "failed") {
        throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
      }
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ingest of ${id}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function poll(
  label: string,
  timeoutMs: number,
  check: () => boolean | Promise<boolean>,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const TERMINAL = new Set(["done", "error", "cancelled"]);

async function createBranchReview(app: App["app"], repoId: string): Promise<string> {
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId, branch: "feature" },
  });
  expect(created.statusCode).toBe(202);
  return (created.json() as ReviewSnapshot).review.id;
}

describe("redo guide", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it(
    "deletes + re-creates: new id, guide rebuilt, nothing from the old one remains",
    { timeout: 90000 },
    async () => {
      const dir = await makeRepo();
      const { app, ctx } = await createApp("tok", {
        runner: real,
        agents: readerAgent() as unknown as never,
      });
      try {
        const added = await app.inject({
          method: "POST",
          url: "/api/repos",
          headers: authed,
          payload: { path: dir },
        });
        const repoId = (added.json() as { repos: { id: string }[] }).repos.find(
          (r) => r.id !== "demo",
        )!.id;

        const oldId = await createBranchReview(app, repoId);
        const oldSnap = await awaitReady(app, oldId);
        // The pipeline rebuilds the guide from the fake runner.
        await poll("old reader", 20000, () =>
          ctx.jobs.listByReview(oldId).some((j) => j.kind === "reader" && j.state === "done"),
        );
        const oldCards =
          ctx.reviews.getSnapshot(oldId)?.pages.find((p) => p.id === "root")?.cards ?? [];
        expect(oldCards.length).toBeGreaterThan(0);

        // User data: a reviewed mark, and a thread marked for the PR.
        const hash = oldSnap.files[0].hunks[0].contentHash;
        const noted = await app.inject({
          method: "PATCH",
          url: `/api/reviews/${oldId}/hunks/${hash}`,
          headers: authed,
          payload: { reviewed: true },
        });
        expect(noted.statusCode).toBe(200);
        const fileKey = oldSnap.files[0].fileKey;
        const threaded = await app.inject({
          method: "POST",
          url: `/api/reviews/${oldId}/comments`,
          headers: authed,
          payload: {
            anchor: { where: "diff-line", fileKey, line: 1 },
            quote: "x = 1",
            text: "my comment",
          },
        });
        expect(threaded.statusCode).toBe(201);
        const threadId = (threaded.json() as { id: string }).id;
        const marked = await app.inject({
          method: "PATCH",
          url: `/api/reviews/${oldId}/comments/${threadId}`,
          headers: authed,
          payload: { post: true },
        });
        expect(marked.statusCode).toBe(200);
        // Let the old pipeline settle so no detached run can save afterwards.
        await poll("old jobs quiet", 30000, () =>
          ctx.jobs.listByReview(oldId).every((j) => TERMINAL.has(j.state)),
        );
        const oldJobIds = new Set(ctx.jobs.listByReview(oldId).map((j) => j.id));
        expect(oldJobIds.size).toBeGreaterThan(0);

        // Re-do: same as delete + create, answering with the new loading snapshot.
        const redone = await app.inject({
          method: "POST",
          url: `/api/reviews/${oldId}/redo`,
          headers: authed,
        });
        expect(redone.statusCode).toBe(202);
        const redoSnap = redone.json() as ReviewSnapshot;
        const newId = redoSnap.review.id;
        expect(newId).not.toBe(oldId);
        expect(redoSnap.ingest?.status).toBe("loading");
        expect(redoSnap.review.branch).toBe("feature");

        // Nothing from the old review remains: snapshot, jobs endpoint, rows.
        const gone = await app.inject({ method: "GET", url: `/api/reviews/${oldId}`, headers: authed });
        expect(gone.statusCode).toBe(404);
        const oldJobs = await app.inject({
          method: "GET",
          url: `/api/jobs?review=${oldId}`,
          headers: authed,
        });
        expect((oldJobs.json() as { jobs: Job[] }).jobs).toEqual([]);
        const rows = ctx.db
          .prepare("SELECT COUNT(*) AS n FROM jobs WHERE review_id = ?")
          .get(oldId) as { n: number };
        expect(rows.n).toBe(0);

        // The new review ingests and rebuilds its guide from scratch.
        await awaitReady(app, newId);
        await poll("new reader", 20000, () =>
          ctx.jobs.listByReview(newId).some((j) => j.kind === "reader" && j.state === "done"),
        );
        const fresh = ctx.reviews.getSnapshot(newId)!;
        const newCards = fresh.pages.find((p) => p.id === "root")?.cards ?? [];
        expect(newCards.length).toBeGreaterThan(0);
        expect(fresh.annotations).toEqual([]);
        // The new pipeline writes its own hunk states; none carries the
        // old review's reviewed marks.
        expect(fresh.hunkStates.filter((s) => s.reviewed)).toEqual([]);
        expect(fresh.version.n).toBe(1);
        const newJobs = ctx.jobs.listByReview(newId);
        expect(newJobs.length).toBeGreaterThan(0);
        for (const j of newJobs) expect(oldJobIds.has(j.id)).toBe(false);
      } finally {
        await app.close();
      }
    },
  );

  it("refuses while a submit is in flight, keeping the review", async () => {
    const dir = await makeRepo();
    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos.find(
        (r) => r.id !== "demo",
      )!.id;
      const id = await createBranchReview(app, repoId);
      await awaitReady(app, id);

      writeSubmitLease(ctx.db, {
        reviewId: id,
        startedAt: Date.now(),
        commitId: "abc",
        body: "b",
        comments: [],
      });
      const refused = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/redo`,
        headers: authed,
      });
      expect(refused.statusCode).toBe(409);
      const kept = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect(kept.statusCode).toBe(200);

      clearSubmitLease(ctx.db, id);
      const redone = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/redo`,
        headers: authed,
      });
      expect(redone.statusCode).toBe(202);
      expect((redone.json() as ReviewSnapshot).review.id).not.toBe(id);
    } finally {
      await app.close();
    }
  });

  it("refuses the demo, loading and unknown reviews", async () => {
    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const demo = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      });
      expect(demo.statusCode).toBe(201);
      const demoId = (demo.json() as ReviewSnapshot).review.id;
      const demoRedo = await app.inject({
        method: "POST",
        url: `/api/reviews/${demoId}/redo`,
        headers: authed,
      });
      expect(demoRedo.statusCode).toBe(409);

      const unknown = await app.inject({
        method: "POST",
        url: "/api/reviews/rv_nope/redo",
        headers: authed,
      });
      expect(unknown.statusCode).toBe(404);

      // A review stuck loading refuses like refresh/update/resume do.
      const loadingId = "rv_redoloading";
      ctx.reviews.putSnapshot(loadingId, {
        review: {
          id: loadingId,
          repoId: "repo1",
          branch: "feature",
          versions: [],
          currentVersion: 0,
          createdAt: Date.now(),
        },
        version: { n: 0, headSha: "", mergeBaseSha: "", baseRef: "", fetchedAt: Date.now(), idMapping: {} },
        files: [],
        pages: [],
        annotations: [],
        hunkStates: [],
        fileStates: [],
        viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
        ingest: { status: "loading", step: "fetching" },
      });
      const loading = await app.inject({
        method: "POST",
        url: `/api/reviews/${loadingId}/redo`,
        headers: authed,
      });
      expect(loading.statusCode).toBe(409);
      expect((loading.json() as { error: string }).error).toMatch(/still opening/);
    } finally {
      await app.close();
    }
  });
});
