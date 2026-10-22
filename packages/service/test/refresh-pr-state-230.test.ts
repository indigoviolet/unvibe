/**
 * #230: refresh updates PR state/decision with no new commits.
 *
 * Stubbed `gh` flips state + decision (OPEN + REVIEW_REQUIRED → MERGED +
 * APPROVED) with the same head SHA. Refresh must mutate the stored
 * description and the summary must carry the new state — the steady-head
 * `prChanged` path. REVIEW_REQUIRED never shows (drops to no decision).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

async function makeRepo(): Promise<{ dir: string; head: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-230-state-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
  await git(dir, "commit", "-am", "feature");
  const head = await git(dir, "rev-parse", "HEAD");
  return { dir, head };
}

function view(state: string, decision: string, head: string) {
  return {
    cmd: "gh",
    stdout: JSON.stringify({
      title: "PR",
      body: "Body.",
      author: { login: "a" },
      state,
      isDraft: false,
      reviewDecision: decision,
      reviewRequests: [],
      latestReviews: [],
      baseRefName: "main",
      headRefName: "feature",
      headRefOid: head,
    }),
    stderr: "",
    code: 0,
  };
}

describe("refresh PR state with no new commits (#230)", () => {
  it("steady-head refresh flips state and decision in snapshot + summary", async () => {
    const { dir, head } = await makeRepo();
    const fake = new FakeCommandRunner();
    fake.enqueue(view("OPEN", "REVIEW_REQUIRED", head));
    const runner = {
      run: (cmd: string, opts: Parameters<FakeCommandRunner["run"]>[1]) => {
        if (cmd === "gh") return fake.run(cmd, opts);
        if (cmd === "git" && opts.args.includes("fetch")) return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app } = await createApp("tok", { runner, autoPipeline: false });
    const authed = { authorization: "Bearer tok" };
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: repo.id, pr: 1 } });
      expect([201, 202]).toContain(created.statusCode);
      const id = (created.json() as { review: { id: string } }).review.id;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
        const snap = got.json() as { ingest?: { status?: string }; version?: { n?: number } };
        if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const before = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      const beforeSnap = before.json() as { description?: { state?: string; reviewDecision?: string } };
      expect(beforeSnap.description?.state).toBe("OPEN");
      // REVIEW_REQUIRED never shows — no stored decision.
      expect(beforeSnap.description?.reviewDecision).toBeUndefined();

      fake.enqueue(view("MERGED", "APPROVED", head));
      const refreshed = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: authed });
      expect(refreshed.statusCode).toBe(200);
      expect(refreshed.json()).toMatchObject({ newVersion: false });

      const after = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      const afterSnap = after.json() as { description?: { state?: string; reviewDecision?: string } };
      expect(afterSnap.description?.state).toBe("MERGED");
      expect(afterSnap.description?.reviewDecision).toBe("approved");

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      const found = (list.json() as { reviews: { id: string; prState?: string; reviewDecision?: string }[] }).reviews.find(
        (r) => r.id === id,
      );
      expect(found?.prState).toBe("merged");
      expect(found?.reviewDecision).toBe("approved");
    } finally {
      await app.close();
    }
  });

  it("re-requested changes_requested shows no decision", async () => {
    const { dir, head } = await makeRepo();
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "gh",
      stdout: JSON.stringify({
        title: "PR",
        body: "Body.",
        author: { login: "a" },
        state: "OPEN",
        isDraft: false,
        reviewDecision: "CHANGES_REQUESTED",
        reviewRequests: [{ login: "alice" }],
        latestReviews: [{ author: { login: "alice" }, state: "CHANGES_REQUESTED" }],
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: head,
      }),
      stderr: "",
      code: 0,
    });
    const runner = {
      run: (cmd: string, opts: Parameters<FakeCommandRunner["run"]>[1]) => {
        if (cmd === "gh") return fake.run(cmd, opts);
        if (cmd === "git" && opts.args.includes("fetch")) return Promise.resolve({ stdout: "", stderr: "", code: 0 });
        return real.run(cmd, opts);
      },
    };
    const { app } = await createApp("tok", { runner, autoPipeline: false });
    const authed = { authorization: "Bearer tok" };
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: repo.id, pr: 2 } });
      const id = (created.json() as { review: { id: string } }).review.id;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
        const snap = got.json() as { ingest?: { status?: string }; version?: { n?: number } };
        if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
      const snap = got.json() as { description?: { reviewDecision?: string } };
      expect(snap.description?.reviewDecision).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
