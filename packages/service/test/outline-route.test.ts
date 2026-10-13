/**
 * Outline route (issue #133, stage 2): `GET /api/reviews/:id/outline`
 * answers enclosing units for a range, degrades without throwing, and
 * reports `no-content` for reviews with no file history (the demo).
 * Tests run `git` for real in temp repos (no agents, no network).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { FileOutlineResponse, ReviewSnapshot } from "@unvibe/shared";
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

const PY_BASE = [
  "class Store:",
  '    """Keep things."""',
  "",
  "    def get(self, key):",
  "        return self._data[key]",
  "",
  "    def put(self, key, value):",
  "        self._data[key] = value",
].join("\n");

async function makeRepo(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-outline-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "store.py"), PY_BASE + "\n");
  fs.writeFileSync(path.join(dir, "notes.txt"), "Title\n\ndef thing():\n    do()\n");
  fs.writeFileSync(path.join(dir, "bin.dat"), Buffer.from([0x61, 0x00, 0x62]));
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(dir, "store.py"), PY_BASE.replace("return self._data[key]", "return self._data.get(key)") + "\n");
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

function outlineUrl(id: string, q: string): string {
  return `/api/reviews/${id}/outline?${q}`;
}

describe("outline route", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("answers the enclosing chain for a hunk range", async () => {
    const { app, id, snap } = await openReview();
    try {
      const res = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=store.py&commit=${snap.version.headSha}&start=5&end=5`),
        headers: authed,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as FileOutlineResponse;
      expect(body.how).toBe("parser");
      expect(body.language).toBe("python");
      expect(body.chain.map((u) => u.name)).toEqual(["get", "Store"]);
    } finally {
      await app.close();
    }
  });

  it("falls back to the heuristic for unknown languages and degrades binary files", async () => {
    const { app, id, snap } = await openReview();
    try {
      const txt = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=notes.txt&commit=${snap.version.headSha}&start=4&end=4`),
        headers: authed,
      });
      expect(txt.statusCode).toBe(200);
      const txtBody = txt.json() as FileOutlineResponse;
      expect(txtBody.how).toBe("heuristic");
      expect(txtBody.chain).toHaveLength(1);
      const bin = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=bin.dat&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(bin.statusCode).toBe(200);
      expect(bin.json()).toMatchObject({ how: "none", chain: [] });
    } finally {
      await app.close();
    }
  });

  it("refuses bad input without throwing", async () => {
    const { app, id, snap } = await openReview();
    try {
      const badCommit = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=store.py&commit=zzz&start=1&end=1`),
        headers: authed,
      });
      expect(badCommit.statusCode).toBe(400);
      const badRange = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=store.py&commit=${snap.version.headSha}&start=9&end=99`),
        headers: authed,
      });
      expect(badRange.statusCode).toBe(400);
      const escape = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=../store.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(escape.statusCode).toBe(400);
      const missing = await app.inject({
        method: "GET",
        url: outlineUrl(id, `path=nope.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(missing.statusCode).toBe(404);
      expect((missing.json() as { code?: string }).code).toBeUndefined();
      const unknown = await app.inject({
        method: "GET",
        url: outlineUrl("nope", `path=store.py&commit=${snap.version.headSha}&start=1&end=1`),
        headers: authed,
      });
      expect(unknown.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("reports no-content for reviews with no file history", async () => {
    const { app } = await createApp("tok", {
      runner: real,
      agents: new FakeAgentRunner(),
      models: new StaticModelCatalog(),
      autoPipeline: false,
    });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo", demo: true },
      });
      expect(created.statusCode).toBe(201);
      const demoId = (created.json() as ReviewSnapshot).review.id;
      const snap = (created.json() as ReviewSnapshot).review && await app.inject({ method: "GET", url: `/api/reviews/${demoId}`, headers: authed });
      expect(snap.statusCode).toBe(200);
      const demoSnap = snap.json() as ReviewSnapshot;
      const res = await app.inject({
        method: "GET",
        url: outlineUrl(demoId, `path=src/urllib3/connection.py&commit=${demoSnap.version.headSha}&start=80&end=82`),
        headers: authed,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "no-content" });
      const slice = await app.inject({
        method: "GET",
        url: `/api/reviews/${demoId}/file?path=src/urllib3/connection.py&commit=${demoSnap.version.headSha}&start=80&end=82`,
        headers: authed,
      });
      expect(slice.statusCode).toBe(404);
      expect(slice.json()).toMatchObject({ code: "no-content" });
    } finally {
      await app.close();
    }
  });
});
