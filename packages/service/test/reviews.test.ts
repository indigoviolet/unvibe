/**
 * Reviews + hunks routes: validation, ingest → snapshot, refresh movement
 * reporting, hunk PATCH through ReviewStore, summarize stays 501.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-rev-"));
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

describe("review routes", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("validates create payloads", async () => {
    const { app } = await createApp("tok", { runner: real });
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
    const { app } = await createApp("tok", { runner: real });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos[0].id;

      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      expect(created.statusCode).toBe(201);
      const snap = created.json() as ReviewSnapshot;
      expect(snap.rev).toBe(1);
      expect(snap.review.branch).toBe("feature");
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
      expect((fetched.json() as ReviewSnapshot).rev).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("refresh reports head movement without creating versions (M5 seam)", async () => {
    const dir = await makeRepo();
    const { app } = await createApp("tok", { runner: real });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos[0].id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const id = (created.json() as ReviewSnapshot).review.id;

      const calm = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(calm.statusCode).toBe(200);
      expect(calm.json()).toMatchObject({ newVersion: false });

      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "more");

      const moved = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ newVersion: true });

      // M1 leaves the snapshot untouched: still version 1.
      const snap = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      expect((snap.json() as ReviewSnapshot).rev).toBe(1);
      expect((snap.json() as ReviewSnapshot).version.n).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe("hunk routes", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("PATCH updates hunk state through ReviewStore; summarize stays 501", async () => {
    const dir = await makeRepo();
    const { app, ctx } = await createApp("tok", { runner: real });
    try {
      const added = await app.inject({
        method: "POST",
        url: "/api/repos",
        headers: authed,
        payload: { path: dir },
      });
      const repoId = (added.json() as { repos: { id: string }[] }).repos[0].id;
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId, branch: "feature" },
      });
      const snap = created.json() as ReviewSnapshot;
      const id = snap.review.id;
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
        payload: { reviewed: true, folded: true, note: "looks good" },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json()).toEqual({ ok: true });

      const after = ctx.reviews.getSnapshot(id);
      expect(after?.rev).toBe(2);
      expect(after?.hunkStates).toEqual([
        { contentHash: hash, folded: true, reviewed: true, note: "looks good" },
      ]);

      // Explicit null clears the note.
      const cleared = await app.inject({
        method: "PATCH",
        url: `/api/reviews/${id}/hunks/${hash}`,
        headers: authed,
        payload: { note: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect(ctx.reviews.getSnapshot(id)?.hunkStates).toEqual([
        { contentHash: hash, folded: true, reviewed: true },
      ]);

      const summarize = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/hunks/${hash}/summarize`,
        headers: authed,
      });
      expect(summarize.statusCode).toBe(501);
    } finally {
      await app.close();
    }
  });
});
