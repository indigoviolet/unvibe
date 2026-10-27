/**
 * Start-page paging + author search (#297).
 *
 * - `limit` sizes every `gh pr list` call (`--limit`); a full page reports
 *   `hasMore` so the start page offers Load more (a larger `--limit`
 *   re-fetch — `gh pr list` has no offset).
 * - `author` narrows only the review-requested searches with
 *   `--author <login>`; "Your PRs" (`--author @me`) never takes it.
 *
 * `gh` is stubbed through the injectable command runner (never real
 * GitHub); git runs for real against a temp checkout.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RealCommandRunner } from "../src/exec/index.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

async function makeGitRepo(dir: string): Promise<void> {
  const git = async (...args: string[]): Promise<void> => {
    const res = await real.run("git", { args, cwd: dir });
    if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "f.txt"), "x\n");
  await git("add", ".");
  await git("commit", "-m", "init");
  // A GitHub `origin` so the `gh` lists run (local-only repos skip gh).
  await git("remote", "add", "origin", "https://github.com/acme/app.git");
}

function cannedPrs(n: number, author: string): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    number: 100 + i,
    title: `PR ${100 + i} by ${author}`,
    author: { login: author },
    updatedAt: "2026-10-01T00:00:00Z",
    headRefName: `branch-${100 + i}`,
  }));
}

type GhBodies = { author?: unknown; direct?: unknown; all?: unknown };

/** Stub `gh` by query qualifier; records every `gh` invocation. */
function stubGh(bodies: GhBodies): { runner: CommandRunner; ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  const runner: CommandRunner = {
    run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
      if (cmd !== "gh") return real.run(cmd, opts);
      ghCalls.push(opts.args);
      const key = opts.args.includes("user-review-requested:@me")
        ? "direct"
        : opts.args.includes("review-requested:@me")
          ? "all"
          : "author";
      const body = bodies[key];
      return { stdout: JSON.stringify(body ?? []), stderr: "", code: 0 };
    },
  };
  return { runner, ghCalls };
}

interface TestApp {
  inject: (opts: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
  close: () => Promise<void>;
}

async function setupRepo(runner: CommandRunner): Promise<{ app: TestApp; repoId: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch297-"));
  await makeGitRepo(dir);
  const { app } = await createApp("tok", { runner, autoPipeline: false });
  process.env.UNVIBE_REPO_ROOTS = "";
  const added = await app.inject({
    method: "POST",
    url: "/api/repos",
    headers: { authorization: "Bearer tok" },
    payload: { path: dir },
  });
  const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
  return { app: app as unknown as TestApp, repoId: repo.id };
}

async function getChanges(
  app: TestApp,
  url: string,
): Promise<{ changes: { prNumber?: number; title?: string }[]; hasMore: boolean }> {
  const res = await app.inject({ method: "GET", url, headers: { authorization: "Bearer tok" } });
  expect(res.statusCode).toBe(200);
  return res.json() as { changes: { prNumber?: number; title?: string }[]; hasMore: boolean };
}

function limitOf(args: string[]): string | undefined {
  const i = args.indexOf("--limit");
  return i === -1 ? undefined : args[i + 1];
}

function authorOf(args: string[]): string | undefined {
  const i = args.indexOf("--author");
  return i === -1 ? undefined : args[i + 1];
}

describe("changes paging + author search (#297)", () => {
  it("limit sizes every pr list; a full page reports hasMore", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(3, "you"), direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=2`);
      expect(body.changes).toHaveLength(3);
      expect(body.hasMore).toBe(true);
      // The one authoring call carried the requested size.
      const authoringCalls = ghCalls.filter((a) => a.includes("--author"));
      expect(authoringCalls).toHaveLength(1);
      expect(limitOf(authoringCalls[0])).toBe("2");

      const wide = await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=10`);
      expect(wide.hasMore).toBe(false);
      expect(limitOf(ghCalls.filter((a) => a.includes("--author")).at(-1)!)).toBe("10");
    } finally {
      await app.close();
    }
  });

  it("defaults to 30 and clamps an absurd limit", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(1, "you"), direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring`);
      expect(limitOf(ghCalls.filter((a) => a.includes("--author")).at(-1)!)).toBe("30");
      await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=99999`);
      expect(limitOf(ghCalls.filter((a) => a.includes("--author")).at(-1)!)).toBe("200");
    } finally {
      await app.close();
    }
  });

  it("author narrows only the review-requested searches", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(1, "you"), direct: cannedPrs(1, "alice"), all: cannedPrs(2, "alice") });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getChanges(app, `/api/repos/${repoId}/changes?filter=review-requested&author=alice`);
      expect(body.changes).toHaveLength(2);
      const searchCalls = ghCalls.filter((a) => a.some((x) => x.includes("review-requested:@me")));
      expect(searchCalls).toHaveLength(2);
      for (const call of searchCalls) expect(authorOf(call)).toBe("alice");

      // The combined filter keeps "Your PRs" on @me while scoping requests.
      ghCalls.length = 0;
      await getChanges(app, `/api/repos/${repoId}/changes?filter=all&author=alice`);
      const mine = ghCalls.filter((a) => authorOf(a) === "@me");
      expect(mine).toHaveLength(1);
      const scoped = ghCalls.filter((a) => authorOf(a) === "alice");
      expect(scoped).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("an unreadable limit falls back to the default", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(1, "you"), direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=many`);
      expect(body.hasMore).toBe(false);
      expect(limitOf(ghCalls.filter((a) => a.includes("--author")).at(-1)!)).toBe("30");
    } finally {
      await app.close();
    }
  });
});
