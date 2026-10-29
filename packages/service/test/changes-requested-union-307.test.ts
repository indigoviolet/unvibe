/**
 * Start-page requested union (#307) over GraphQL (#310).
 *
 * `requestedPrs` builds rows from the UNION of the direct
 * (`user-review-requested:@me`) and team-inclusive
 * (`review-requested:@me`) searches, deduplicated by PR number: a PR on
 * both shows once (as direct), and a direct request past the capped
 * team-inclusive page still shows (as direct) instead of being dropped.
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

function fakePr(n: number, title: string, author = "teammate"): unknown {
  return {
    __typename: "PullRequest",
    number: n,
    title,
    author: { login: author },
    updatedAt: "2026-10-01T00:00:00Z",
    headRefName: `branch-${n}`,
    state: "OPEN",
  };
}

interface GhBodies {
  direct?: unknown[];
  all?: unknown[];
  /** End cursor the stub reports for each search ("-" = exhausted). */
  directCursor?: string | null;
  allCursor?: string | null;
}

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
      const key = q.includes("user-review-requested:@me") ? "direct" : "all";
      const rows = key === "direct" ? [...(bodies.direct ?? [])] : [...(bodies.all ?? [])];
      const endCursor = key === "direct" ? (bodies.directCursor ?? null) : (bodies.allCursor ?? null);
      return {
        stdout: JSON.stringify({
          data: {
            search: {
              pageInfo: { hasNextPage: endCursor !== null, endCursor },
              nodes: rows,
            },
          },
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch307-"));
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

interface RequestedRow {
  prNumber?: number;
  reviewScope?: string;
}

async function getRequested(
  app: TestApp,
  repoId: string,
  query: string,
): Promise<{ changes: RequestedRow[]; hasMore: boolean; cursor: string | null }> {
  const res = await app.inject({
    method: "GET",
    url: `/api/repos/${repoId}/changes${query}`,
    headers: { authorization: "Bearer tok" },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { changes: RequestedRow[]; hasMore: boolean; cursor: string | null };
}

describe("requestedPrs union (#307, GraphQL #310)", () => {
  it("a direct request past the capped team page still shows, as direct", async () => {
    // The team-inclusive search reports another page (cursor "t1") while
    // the direct search's row is absent from its page.
    const { runner } = stubGh({
      all: [fakePr(201, "Team one"), fakePr(202, "Team two")],
      allCursor: "t1",
      direct: [fakePr(301, "Direct past the page")],
      directCursor: null,
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getRequested(app, repoId, "?filter=review-requested&limit=2");
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(301)?.reviewScope).toBe("direct");
      expect(byNumber.get(201)?.reviewScope).toBe("team");
      expect(byNumber.get(202)?.reviewScope).toBe("team");
      // The team search has another page.
      expect(body.hasMore).toBe(true);
      expect(decodeChangesCursor(body.cursor)).toEqual({ direct: null, team: "t1" });
    } finally {
      await app.close();
    }
  });

  it("a PR on both searches shows once, as direct (dedupe by number)", async () => {
    const { runner } = stubGh({
      all: [fakePr(401, "Asked of both"), fakePr(402, "Team only")],
      direct: [fakePr(401, "Asked of both"), fakePr(403, "Direct only")],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getRequested(app, repoId, "?filter=review-requested&limit=10");
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      expect(body.changes.filter((c) => c.prNumber === 401)).toHaveLength(1);
      expect(byNumber.get(401)?.reviewScope).toBe("direct");
      expect(byNumber.get(402)?.reviewScope).toBe("team");
      expect(byNumber.get(403)?.reviewScope).toBe("direct");
      expect(body.hasMore).toBe(false);
    } finally {
      await app.close();
    }
  });
});
