/**
 * Reviews + hunks routes: validation, ingest → snapshot, refresh movement
 * reporting, hunk PATCH through ReviewStore, summarize enqueues onto the
 * injected agent runner (M3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
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

async function makeRepo(parent: string = os.tmpdir()): Promise<string> {
  const dir = fs.mkdtempSync(path.join(parent, "unvibe-rev-"));
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

/** #92: poll GET until the background ingest lands (or throws on failure). */
async function awaitReady(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  id: string,
  timeoutMs = 15000,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
    if (res.statusCode === 200) {
      const snap = res.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "failed") {
        throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
      }
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ingest of ${id}`);
}

describe("review routes", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("validates create payloads", async () => {
    const { app } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const noRepo = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: {} });
      expect(noRepo.statusCode).toBe(400);
      const noSource = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "rp_x" },
      });
      expect(noSource.statusCode).toBe(400);
      const unknownRepo = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "rp_x", branch: "main" },
      });
      expect(unknownRepo.statusCode).toBe(404);
      const unknownReview = await app.inject({ method: "GET", url: "/api/reviews/nope", headers: authed });
      expect(unknownReview.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("creates a review + version 1 snapshot and serves it back", async () => {
    const dir = await makeRepo();
    const { app } = await createApp("tok", {
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
      const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;

      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      // #92: async open answers 202 with a loading placeholder.
      expect([201, 202]).toContain(created.statusCode);
      const loading = created.json() as ReviewSnapshot;
      expect(loading.review.branch).toBe("feature");
      const snap = await awaitReady(app, loading.review.id);
      expect(snap.version.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(snap.files).toHaveLength(1);
      expect(snap.files[0].hunks.length).toBeGreaterThan(0);
      expect(snap.files[0].hunks[0].contentHash).toMatch(/^[0-9a-f]{16}$/);
      expect(snap.description?.source).toBe("commits");
      expect(snap.hunkStates).toEqual([]);

      const fetched = await app.inject({
        method: "GET",
        url: `/api/reviews/${snap.review.id}`,
        headers: authed,
      });
      expect(fetched.statusCode).toBe(200);
      expect((fetched.json() as ReviewSnapshot).version.n).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("creates a review from a detected (not yet remembered) checkout and remembers it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-roots-"));
    const dir = await makeRepo(root);
    process.env.UNVIBE_REPO_ROOTS = root;
    const { app } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const listed = await app.inject({ method: "GET", url: "/api/repos", headers: authed });
      const repos = (listed.json() as { repos: { id: string; localPath: string; detected?: boolean }[] }).repos;
      const detected = repos.find((r) => r.localPath === dir)!;
      expect(detected.detected).toBe(true);

      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: detected.id, branch: "feature" },
      });
      expect([201, 202]).toContain(created.statusCode);
      const loading2 = created.json() as ReviewSnapshot;
      const snap = await awaitReady(app, loading2.review.id);
      expect(snap.review.repoId).toBe(detected.id);

      // Now remembered under the same id (refresh/submit look it up by id).
      const after = await app.inject({ method: "GET", url: "/api/repos", headers: authed });
      const again = (after.json() as { repos: { id: string; localPath: string; detected?: boolean }[] }).repos.filter(
        (r) => r.localPath === dir,
      );
      expect(again).toHaveLength(1);
      expect(again[0].id).toBe(detected.id);
      expect(again[0].detected).toBeUndefined();

      const refreshed = await app.inject({
        method: "POST",
        url: `/api/reviews/${snap.review.id}/refresh`,
        headers: authed,
      });
      expect(refreshed.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("refresh creates version n+1 on head movement (M5)", async () => {
    const dir = await makeRepo();
    const { app } = await createApp("tok", {
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
      const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const loading3 = created.json() as ReviewSnapshot;
      const id = loading3.review.id;
      await awaitReady(app, id);

      const calm = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(calm.statusCode).toBe(200);
      expect(calm.json()).toMatchObject({ newVersion: false });

      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "more");

      const moved = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ newVersion: true });

      // M5 creates version 2 (#92: rev counts the async ingest mutates too).
      const snap = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect((snap.json() as ReviewSnapshot).version.n).toBe(2);
      expect((snap.json() as ReviewSnapshot).versionStatus?.stale).toBe(true);

      // The old version stays viewable.
      const old = await app.inject({ method: "GET", url: `/api/reviews/${id}?version=1`, headers: authed });
      expect(old.statusCode).toBe(200);
      expect((old.json() as ReviewSnapshot).version.n).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("hunk routes", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("PATCH updates hunk state through ReviewStore; summarize enqueues (M3)", async () => {
    const dir = await makeRepo();
    // Fake agents (issue #119): summarize must enqueue onto the fake, never
    // a real adapter. `agents.prompts` proves the job ran on the fake.
    const agents = new FakeAgentRunner();
    const { app, ctx } = await createApp("tok", {
      runner: real,
      agents,
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
      const repoId = (added.json() as { repos: { id: string; localPath?: string }[] }).repos.find((r) => r.id !== "demo")!.id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const loading4 = created.json() as ReviewSnapshot;
      const id = loading4.review.id;
      const snap = await awaitReady(app, id);
      const hash = snap.files[0].hunks[0].contentHash;

      const badBody = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { reviewed: "yes" },
      });
      expect(badBody.statusCode).toBe(400);

      const unknown = await app.inject({
        method: "PATCH",
        url: `/api/reviews/nope/hunks/${hash}`,
        headers: authed,
        payload: { reviewed: true },
      });
      expect(unknown.statusCode).toBe(404);

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { reviewed: true, folded: true },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toEqual({ ok: true });

      const after = ctx.reviews.getSnapshot(id);
      expect(after?.hunkStates).toEqual([{ contentHash: hash, folded: true, reviewed: true }]);

      // Hunk notes are gone (issue #162): the field is rejected.
      const noted = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { note: "looks good" },
      });
      expect(noted.statusCode).toBe(400);
      expect(ctx.reviews.getSnapshot(id)?.hunkStates).toEqual([
        { contentHash: hash, folded: true, reviewed: true },
      ]);

      // Summary: string sets, null deletes, other types are rejected.
      const badSummary = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { summary: 42 },
      });
      expect(badSummary.statusCode).toBe(400);

      const setSummary = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { summary: "unfolds folded headers" },
      });
      expect(setSummary.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.hunkStates).toEqual([
        { contentHash: hash, folded: true, reviewed: true, summary: "unfolds folded headers" },
      ]);

      const delSummary = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { summary: null },
      });
      expect(delSummary.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.hunkStates).toEqual([
        { contentHash: hash, folded: true, reviewed: true },
      ]);

      const summarize = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/hunks/${hash}/summarize`,
        headers: authed,
      });
      expect(summarize.statusCode).toBe(202);
      expect(typeof (summarize.json() as { jobId: string }).jobId).toBe("string");
      // The enqueued job starts on the fake agent runner (no real prompt).
      const start = Date.now();
      while (agents.prompts.length === 0 && Date.now() - start < 10000) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(agents.prompts.length).toBeGreaterThan(0);

      // File fold state (issue #162): validated, persisted on the snapshot.
      const fileKey = snap.files[0].fileKey;
      const badFile = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/files/${fileKey}`,
        headers: authed,
        payload: { folded: "yes" },
      });
      expect(badFile.statusCode).toBe(400);
      const emptyFile = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/files/${fileKey}`,
        headers: authed,
        payload: {},
      });
      expect(emptyFile.statusCode).toBe(400);
      const unknownFile = await app.inject({
        method: "PATCH",
        url: `/api/reviews/nope/files/${fileKey}`,
        headers: authed,
        payload: { folded: true },
      });
      expect(unknownFile.statusCode).toBe(404);
      const folded = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/files/${fileKey}`,
        headers: authed,
        payload: { folded: true },
      });
      expect(folded.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.fileStates).toEqual([{ fileKey, folded: true }]);
      const unfolded = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/files/${fileKey}`,
        headers: authed,
        payload: { folded: false },
      });
      expect(unfolded.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.fileStates).toEqual([{ fileKey, folded: false }]);
    } finally {
      await app.close();
    }
  });
});
