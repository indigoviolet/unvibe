/**
 * File-slice route (issue #133): `GET /api/reviews/:id/file` serves raw
 * ranges of a file at a commit through the shared `readCodeSlice` source.
 * Tests run `git` for real in temp repos (no agents, no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileSliceResponse, ReviewSnapshot } from "@unvibe/shared";
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

function lines(n: number, prefix = "line"): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join("\n") + "\n";
}

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-slice-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.py"), lines(10));
  fs.writeFileSync(path.join(dir, "del.py"), "gone\n");
  fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  const a = lines(10).replace("line5", "CHANGED5");
  fs.writeFileSync(path.join(dir, "a.py"), a);
  fs.rmSync(path.join(dir, "del.py"));
  fs.writeFileSync(path.join(dir, "new.py"), "n1\nn2\nn3\n");
  await git(dir, "add", "-A");
  await git(dir, "commit", "-m", "change");
  return dir;
}

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
      if ((snap.ingest?.status ?? "ready") === "failed") throw new Error(`ingest failed: ${snap.ingest?.error ?? ""}`);
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timed out waiting for ingest of ${id}`);
}

async function openReview(): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  id: string;
  snap: ReviewSnapshot;
}> {
  const dir = await makeRepo();
  const { app } = await createApp("tok", {
    runner: real,
    agents: new FakeAgentRunner(),
    models: new StaticModelCatalog(),
    autoPipeline: false,
  });
  const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
  const repos = (added.json() as { repos: { id: string }[] }).repos;
  const repoId = repos[repos.length - 1].id;
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId, branch: "feature" },
  });
  expect([201, 202]).toContain(created.statusCode);
  const id = (created.json() as ReviewSnapshot).review.id;
  const snap = await awaitReady(app, id);
  return { app, id, snap };
}

function sliceUrl(id: string, q: string): string {
  return `/api/reviews/${id}/file?${q}`;
}

describe("file slices", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("serves a range with its total at the head commit", async () => {
    const { app, id, snap } = await openReview();
    try {
      const res = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=${snap.version.headSha}&start=4&end=6`),
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        path: "a.py",
        commit: snap.version.headSha,
        start: 4,
        end: 6,
        totalLines: 10,
        lines: ["line4", "CHANGED5", "line6"],
      } satisfies FileSliceResponse);
    } finally {
      await app.close();
    }
  });

  it("reads the old side at the merge-base commit", async () => {
    const { app, id, snap } = await openReview();
    try {
      const res = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=${snap.version.mergeBaseSha}&start=5&end=5`),
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as FileSliceResponse).lines).toEqual(["line5"]);
    } finally {
      await app.close();
    }
  });

  it("reads deleted files at base (404 at head) and new files at head (404 at base)", async () => {
    const { app, id, snap } = await openReview();
    try {
      const oldSide = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=del.py&commit=${snap.version.mergeBaseSha}&start=1&end=1`),
        headers: authed,
      });
      expect(oldSide.statusCode).toBe(200);
      expect((oldSide.json() as FileSliceResponse).lines).toEqual(["gone"]);
      const goneAtHead = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=del.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(goneAtHead.statusCode).toBe(404);
      const newAtHead = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=new.py&commit=${snap.version.headSha}&start=1&end=3`),
        headers: authed,
      });
      expect(newAtHead.statusCode).toBe(200);
      expect((newAtHead.json() as FileSliceResponse).totalLines).toBe(3);
      const newAtBase = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=new.py&commit=${snap.version.mergeBaseSha}&start=1&end=1`),
        headers: authed,
      });
      expect(newAtBase.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("refuses binary files, escapes and bad ranges without throwing", async () => {
    const { app, id, snap } = await openReview();
    try {
      const binary = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=bin.dat&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(binary.statusCode).toBe(400);
      const escape = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=../a.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(escape.statusCode).toBe(400);
      const missing = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=nope.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(missing.statusCode).toBe(404);
      const pastEnd = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=${snap.version.headSha}&start=9&end=99`),
        headers: authed,
      });
      expect(pastEnd.statusCode).toBe(400);
      expect((pastEnd.json() as { error: string }).error).toMatch(/10 lines/);
      const badRange = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=${snap.version.headSha}&start=6&end=4`),
        headers: authed,
      });
      expect(badRange.statusCode).toBe(400);
      const badCommit = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=zzz&start=1&end=1`),
        headers: authed,
      });
      expect(badCommit.statusCode).toBe(400);
      const tooWide = await app.inject({
        method: "GET",
        url: sliceUrl(id, `path=a.py&commit=${snap.version.headSha}&start=1&end=201`),
        headers: authed,
      });
      expect(tooWide.statusCode).toBe(400);
      const unknown = await app.inject({
        method: "GET",
        url: sliceUrl("nope", `path=a.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
