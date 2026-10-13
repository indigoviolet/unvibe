/**
 * Start-page PR lists (#95, #100, #94, #91): one `gh pr list` call per
 * list returns number, title, author, updated time, head branch,
 * additions, deletions, changed files, URL and review requests.
 *
 * - authoring: full fields, newest first, one `gh` call;
 * - review-requested: direct (`user-review-requested:@me`) and team
 *   (`review-requested:@me` minus direct) requests distinguishable; a PR
 *   asking both shows once, as direct; team names carried;
 * - rows degrade when `gh` omits fields (the row simply omits that part).
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

type GhBodies = {
  author?: unknown;
  direct?: unknown;
  all?: unknown;
  fail?: Array<"author" | "direct" | "all">;
};

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
      if (bodies.fail?.includes(key)) return { stdout: "", stderr: "mock gh is down", code: 1 };
      const body = bodies[key];
      return { stdout: JSON.stringify(body ?? []), stderr: "", code: 0 };
    },
  };
  return { runner, ghCalls };
}

async function setupRepo(runner: CommandRunner): Promise<{ app: TestApp; repoId: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-chlists-"));
  await makeGitRepo(dir);
  const { app } = await createApp("tok", { runner, autoPipeline: false });
  const authed = { authorization: "Bearer tok" };
  process.env.UNVIBE_REPO_ROOTS = "";
  const added = await app.inject({
    method: "POST",
    url: "/api/repos",
    headers: authed,
    payload: { path: dir },
  });
  const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;
  return { app: app as unknown as TestApp, repoId: repo.id };
}

interface ChangeRow {
  kind: string;
  title: string;
  prNumber?: number;
  branch?: string;
  author?: string;
  updatedAt?: number;
  url?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  reviewScope?: string;
  requestedTeams?: string[];
}

interface TestApp {
  inject: (opts: unknown) => Promise<{ statusCode: number; json: () => unknown }>;
  close: () => Promise<void>;
}

async function getChanges(app: TestApp, repoId: string, filter: string): Promise<ChangeRow[]> {
  const res = await app.inject({
    method: "GET",
    url: `/api/repos/${repoId}/changes?filter=${filter}`,
    headers: { authorization: "Bearer tok" },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { changes: ChangeRow[] }).changes;
}

const FULL_OLD = {
  number: 5011,
  title: "Fix retry backoff",
  author: { login: "you" },
  updatedAt: "2026-10-01T00:00:00Z",
  headRefName: "fix-retry-backoff",
  additions: 120,
  deletions: 34,
  changedFiles: 6,
  url: "https://github.com/acme/app/pull/5011",
  reviewRequests: [],
};

const FULL_NEW = {
  number: 5020,
  title: "Unfold folded values",
  author: { login: "you" },
  updatedAt: "2026-10-03T00:00:00Z",
  headRefName: "fix-obs-fold",
  additions: 42,
  deletions: 18,
  changedFiles: 4,
  url: "https://github.com/acme/app/pull/5020",
  reviewRequests: [],
};

describe("start-page PR lists (one gh pr list call per list)", () => {
  it("authoring returns every row field, newest first, in one gh call", async () => {
    const { runner, ghCalls } = stubGh({ author: [FULL_OLD, FULL_NEW] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const changes = await getChanges(app, repoId, "authoring");
      expect(changes.map((c) => c.prNumber)).toEqual([5020, 5011]);
      const row = changes[0];
      expect(row.kind).toBe("pr");
      expect(row.title).toBe("Unfold folded values");
      expect(row.author).toBe("you");
      expect(row.branch).toBe("fix-obs-fold");
      expect(row.url).toBe("https://github.com/acme/app/pull/5020");
      expect(row.additions).toBe(42);
      expect(row.deletions).toBe(18);
      expect(row.changedFiles).toBe(4);
      expect(row.updatedAt).toBe(Date.parse("2026-10-03T00:00:00Z"));
      // One call per list, through `gh pr list` with every field.
      expect(ghCalls).toHaveLength(1);
      const [args] = ghCalls;
      expect(args.slice(0, 2)).toEqual(["pr", "list"]);
      expect(args).toContain("--author");
      expect(args).toContain("@me");
      const json = args[args.indexOf("--json") + 1];
      for (const field of ["number", "title", "author", "updatedAt", "headRefName", "additions", "deletions", "changedFiles", "url", "reviewRequests"]) {
        expect(json.split(",")).toContain(field);
      }
    } finally {
      await app.close();
    }
  });

  it("review-requested splits direct and team; both shows once, as direct", async () => {
    const directOnly = {
      number: 11,
      title: "Asked of you",
      author: { login: "teammate" },
      updatedAt: "2026-10-02T00:00:00Z",
      headRefName: "asked-you",
      additions: 9,
      deletions: 1,
      changedFiles: 2,
      url: "https://github.com/acme/app/pull/11",
      reviewRequests: [{ __typename: "User", login: "you" }],
    };
    const both = {
      number: 12,
      title: "Asked of you and your team",
      author: { login: "teammate" },
      updatedAt: "2026-10-04T00:00:00Z",
      headRefName: "asked-both",
      additions: 30,
      deletions: 4,
      changedFiles: 3,
      url: "https://github.com/acme/app/pull/12",
      reviewRequests: [{ __typename: "User", login: "you" }, { __typename: "Team", slug: "core" }],
    };
    const teamOnly = {
      number: 13,
      title: "Asked of your team",
      author: { login: "teammate" },
      updatedAt: "2026-10-03T00:00:00Z",
      headRefName: "asked-team",
      additions: 200,
      deletions: 50,
      changedFiles: 10,
      url: "https://github.com/acme/app/pull/13",
      reviewRequests: [{ __typename: "Team", slug: "core" }],
    };
    const { runner, ghCalls } = stubGh({ direct: [directOnly, both], all: [both, teamOnly, directOnly] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const changes = await getChanges(app, repoId, "review-requested");
      // Newest first across the combined list.
      expect(changes.map((c) => c.prNumber)).toEqual([12, 13, 11]);
      const byNumber = new Map(changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(11)?.reviewScope).toBe("direct");
      // Asked of both: once, as direct.
      expect(byNumber.get(12)?.reviewScope).toBe("direct");
      expect(changes.filter((c) => c.prNumber === 12)).toHaveLength(1);
      expect(byNumber.get(13)?.reviewScope).toBe("team");
      expect(byNumber.get(13)?.requestedTeams).toEqual(["core"]);
      // Team names ride the rows that have them.
      expect(byNumber.get(12)?.requestedTeams).toEqual(["core"]);
      // Two gh calls for the requested lists (direct + team-inclusive).
      expect(ghCalls).toHaveLength(2);
      expect(ghCalls.some((a) => a.includes("user-review-requested:@me"))).toBe(true);
      expect(ghCalls.some((a) => a.includes("review-requested:@me"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("rows omit what gh did not return instead of failing", async () => {
    const { runner } = stubGh({ author: [{ number: 99, title: "Bare row" }] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const changes = await getChanges(app, repoId, "authoring");
      expect(changes).toHaveLength(1);
      const [row] = changes;
      expect(row.prNumber).toBe(99);
      expect(row.title).toBe("Bare row");
      expect(row.branch).toBeUndefined();
      expect(row.author).toBeUndefined();
      expect(row.updatedAt).toBeUndefined();
      expect(row.url).toBeUndefined();
      expect(row.additions).toBeUndefined();
      expect(row.deletions).toBeUndefined();
      expect(row.changedFiles).toBeUndefined();
      expect(row.requestedTeams).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("an unknown distinction degrades to unscoped rows, not mislabelled ones", async () => {
    const teamish = {
      number: 21,
      title: "Maybe team",
      author: { login: "teammate" },
      updatedAt: "2026-10-02T00:00:00Z",
      headRefName: "maybe-team",
      reviewRequests: [{ __typename: "Team", slug: "core" }],
    };
    const { runner } = stubGh({ all: [teamish], fail: ["direct"] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const changes = await getChanges(app, repoId, "review-requested");
      expect(changes).toHaveLength(1);
      expect(changes[0].reviewScope).toBeUndefined();
      expect(changes[0].requestedTeams).toEqual(["core"]);
    } finally {
      await app.close();
    }
  });

  it("the all filter uses three gh calls (authoring + direct + team-inclusive)", async () => {
    const { runner, ghCalls } = stubGh({ author: [FULL_NEW], direct: [], all: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      const changes = await getChanges(app, repoId, "all");
      expect(changes.some((c) => c.prNumber === 5020)).toBe(true);
      expect(ghCalls).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
});
