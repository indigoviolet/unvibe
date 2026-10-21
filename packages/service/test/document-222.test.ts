/**
 * Document reviews (issue #222 phase 1): create from pasted Markdown with
 * 1–2 context repos (worktree / origin/main / local), block IDs, local
 * comments on document blocks, and the single-version guards. Git runs
 * for real against a temp checkout; no agent is configured.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RealCommandRunner } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();
const AUTH = { authorization: "Bearer tok" };

async function makeGitRepo(dir: string): Promise<void> {
  const git = async (...args: string[]): Promise<void> => {
    const res = await real.run("git", { args, cwd: dir });
    if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "README.md"), "# App\n\nHello.\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  await git("add", ".");
  await git("commit", "-m", "init");
  await git("remote", "add", "origin", "https://github.com/acme/app.git");
  await git("update-ref", "refs/remotes/origin/main", "HEAD");
  await git("worktree", "add", path.join(dir, "..", "wt-feature"), "-b", "feature");
}

async function setup(): Promise<{ app: Awaited<ReturnType<typeof createApp>>["app"]; repoId: string; dir: string }> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-doc222-"));
  const dir = path.join(parent, "repo");
  fs.mkdirSync(dir);
  await makeGitRepo(dir);
  const { app } = await createApp("tok", { autoPipeline: false });
  const added = await app.inject({ method: "POST", url: "/api/repos", headers: AUTH, payload: { path: dir } });
  const addedBody = added.json() as { repos?: { id: string }[]; error?: string };
  if (!addedBody.repos) throw new Error(`add repo failed: ${added.statusCode} ${JSON.stringify(addedBody)}`);
  const repo = addedBody.repos.find((r) => r.id !== "demo")!;
  return { app, repoId: repo.id, dir };
}

describe("document reviews (#222)", () => {
  it("lists worktrees and origin/main for the picker", async () => {
    const { app, repoId } = await setup();
    const res = await app.inject({ method: "GET", url: `/api/repos/${repoId}/worktrees`, headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { worktrees: { path: string; branch?: string }[]; originMainSha?: string };
    expect(body.worktrees.length).toBe(2);
    expect(body.worktrees.map((w) => w.branch)).toContain("feature");
    expect(body.originMainSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("creates a document review with block IDs and resolved context repos", async () => {
    const { app, repoId, dir } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: AUTH,
      payload: {
        kind: "document",
        markdown: "# Spec\n\nFirst paragraph.\n\nSecond paragraph.\n",
        contextRepos: [
          { repoId, source: "local" },
          { repoId, source: "worktree", worktreePath: path.join(dir, "..", "wt-feature") },
        ],
      },
    });
    if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
    const snap = res.json() as {
      review: { kind?: string; branch: string };
      document: { title: string; blocks: { id: string }[] };
      contextRepos: { source: string; label: string }[];
      pages: unknown[];
      jobs: unknown[];
    };
    expect(snap.review.kind).toBe("document");
    expect(snap.document.title).toBe("Spec");
    expect(snap.document.blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3"]);
    expect(snap.contextRepos.map((c) => c.source)).toEqual(["local", "worktree"]);
    // Nothing generated up front.
    expect(snap.pages).toEqual([]);
    expect(snap.jobs).toEqual([]);

    const list = await app.inject({ method: "GET", url: "/api/reviews", headers: AUTH });
    const summaries = (list.json() as { reviews: { kind?: string; title: string }[] }).reviews;
    expect(summaries[0].kind).toBe("document");
    expect(summaries[0].title).toBe("Spec");
  });

  it("refuses bad creates and refresh on a document", async () => {
    const { app, repoId } = await setup();
    const bad = async (payload: unknown): Promise<number> =>
      (await app.inject({ method: "POST", url: "/api/reviews", headers: AUTH, payload })).statusCode;
    expect(await bad({ kind: "document", markdown: "", contextRepos: [{ repoId, source: "local" }] })).toBe(400);
    expect(await bad({ kind: "document", markdown: "# T\n\nx", contextRepos: [] })).toBe(400);
    expect(
      await bad({
        kind: "document",
        markdown: "# T\n\nx",
        contextRepos: [
          { repoId, source: "local" },
          { repoId, source: "local" },
          { repoId, source: "local" },
        ],
      }),
    ).toBe(400);
    expect(
      await bad({ kind: "document", markdown: "# T\n\nx", contextRepos: [{ repoId, source: "worktree", worktreePath: "/nope" }] }),
    ).toBe(400);

    const created = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: AUTH,
      payload: { kind: "document", markdown: "# T\n\nHello world.\n", contextRepos: [{ repoId, source: "origin-main" }] },
    });
    const id = (created.json() as { review: { id: string } }).review.id;
    const refresh = await app.inject({ method: "POST", url: `/api/reviews/${id}/refresh`, headers: AUTH });
    expect(refresh.statusCode).toBe(409);
  });

  it("anchors a local comment on a document block (Outbox model)", async () => {
    const { app, repoId } = await setup();
    const created = await app.inject({
      method: "POST",
      url: "/api/reviews",
      headers: AUTH,
      payload: { kind: "document", markdown: "# T\n\nHello world.\n", contextRepos: [{ repoId, source: "local" }] },
    });
    const id = (created.json() as { review: { id: string } }).review.id;
    const note = await app.inject({
      method: "POST",
      url: `/api/reviews/${id}/actions`,
      headers: AUTH,
      payload: { kind: "note", quote: "Hello world.", anchor: { where: "block", blockId: "document#p2" } },
    });
    expect(note.statusCode).toBe(200);
    const snap = (await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: AUTH })).json() as {
      annotations: { type: string; post: boolean; anchor: { host: { kind: string; blockId: string } } }[];
    };
    expect(snap.annotations).toHaveLength(1);
    expect(snap.annotations[0].type).toBe("comment");
    expect(snap.annotations[0].post).toBe(true);
    expect(snap.annotations[0].anchor.host).toEqual({ kind: "block", blockId: "document#p2" });
  });
});
