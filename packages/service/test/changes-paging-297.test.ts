/**
 * Start-page paging + author search (#297) over GraphQL (#310).
 *
 * - `limit` sizes every search (`first:`); `hasMore` comes from the
 *   search's `pageInfo.hasNextPage` (no more full-page guessing).
 * - `author` narrows only the review-requested searches with
 *   `author:<login>`; "Your PRs" (`author:@me`) never takes it.
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
import { decodeChangesCursor } from "@unvibe/shared";
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
    __typename: "PullRequest",
    number: 100 + i,
    title: `PR ${100 + i} by ${author}`,
    author: { login: author },
    updatedAt: "2026-10-01T00:00:00Z",
    headRefName: `branch-${100 + i}`,
    state: "OPEN",
  }));
}

type GhBodies = { author?: unknown[]; direct?: unknown[]; all?: unknown[] };

/** Stub `gh api graphql` by search qualifier; records every `gh` invocation. */
function stubGh(bodies: GhBodies): { runner: CommandRunner; ghCalls: string[][] } {
  const ghCalls: string[][] = [];
  const valueOf = (args: string[], flag: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`${flag}=`));
    return hit === undefined ? undefined : hit.slice(flag.length + 1);
  };
  const runner: CommandRunner = {
    run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
      if (cmd !== "gh") return real.run(cmd, opts);
      ghCalls.push(opts.args);
      const q = valueOf(opts.args, "q") ?? "";
      const first = Number(valueOf(opts.args, "first") ?? "30");
      const after = valueOf(opts.args, "after");
      const key = q.includes("user-review-requested:@me")
        ? "direct"
        : q.includes("review-requested:@me")
          ? "all"
          : "author";
      const rows = [...(bodies[key] ?? [])];
      // Cursor pages: first call returns the first `first` rows with a
      // next-page cursor; any `after:` call returns the rest, exhausted.
      const page = after === undefined ? rows.slice(0, first) : rows.slice(first);
      const hasNextPage = after === undefined ? rows.length > first : false;
      const endCursor = hasNextPage ? (key === "direct" ? "d1" : key === "author" ? "a1" : "t1") : null;
      return {
        stdout: JSON.stringify({
          data: { search: { pageInfo: { hasNextPage, endCursor }, nodes: page } },
        }),
        stderr: "",
        code: 0,
      };
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
): Promise<{ changes: { prNumber?: number; title?: string }[]; hasMore: boolean; cursor: string | null }> {
  const res = await app.inject({ method: "GET", url, headers: { authorization: "Bearer tok" } });
  expect(res.statusCode).toBe(200);
  return res.json() as { changes: { prNumber?: number; title?: string }[]; hasMore: boolean; cursor: string | null };
}

function firstOf(args: string[]): string | undefined {
  return args.find((a) => a.startsWith("first="))?.slice("first=".length);
}

function queryOf(args: string[]): string {
  return args.find((a) => a.startsWith("q="))?.slice("q=".length) ?? "";
}

describe("changes paging + author search (#297, GraphQL #310)", () => {
  it("one graphql search per list, with first: from limit", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(3, "you"), direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=2`);
      expect(body.changes).toHaveLength(2);
      expect(body.hasMore).toBe(true);
      expect(ghCalls).toHaveLength(1);
      const [args] = ghCalls;
      expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
      expect(firstOf(args)).toBe("2");
      const q = queryOf(args);
      expect(q).toContain("repo:acme/app");
      // Authoring keeps the old `gh pr list` effective state (open only).
      expect(q).toContain("author:@me");
      expect(q).toContain("state:open");
      // The next-page cursor decodes to the authoring search.
      expect(decodeChangesCursor(body.cursor)).toEqual({ authoring: "a1" });
    } finally {
      await app.close();
    }
  });

  it("defaults to 30 and clamps an absurd limit to 100", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(1, "you"), direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring`);
      expect(firstOf(ghCalls.at(-1)!)).toBe("30");
      await getChanges(app, `/api/repos/${repoId}/changes?filter=authoring&limit=99999`);
      expect(firstOf(ghCalls.at(-1)!)).toBe("100");
    } finally {
      await app.close();
    }
  });

  it("author narrows only the review-requested searches", async () => {
    const { runner, ghCalls } = stubGh({ author: cannedPrs(1, "you"), direct: cannedPrs(1, "alice"), all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getChanges(app, `/api/repos/${repoId}/changes?filter=review-requested&author=alice`);
      expect(body.changes).toHaveLength(1);
      const searchCalls = ghCalls.filter((a) => queryOf(a).includes("review-requested:@me"));
      expect(searchCalls).toHaveLength(2);
      for (const call of searchCalls) {
        expect(queryOf(call)).toContain("author:alice");
        // The old `gh pr list` calls defaulted to open with no explicit
        // --state: the searches carry the equivalent qualifier.
        expect(queryOf(call)).toContain("is:open");
      }

      // The combined filter keeps "Your PRs" on @me while scoping requests.
      ghCalls.length = 0;
      await getChanges(app, `/api/repos/${repoId}/changes?filter=all&author=alice`);
      const mine = ghCalls.filter((a) => queryOf(a).includes("author:@me"));
      expect(mine).toHaveLength(1);
      const scoped = ghCalls.filter((a) => queryOf(a).includes("author:alice"));
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
      expect(firstOf(ghCalls.at(-1)!)).toBe("30");
    } finally {
      await app.close();
    }
  });
});
