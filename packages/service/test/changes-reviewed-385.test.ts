/**
 * Already-reviewed + typed-author PR lists (#385).
 *
 * - `reviewed-by:@me is:open -author:@me` joins the review-requested
 *   union (GitHub drops the review request once you review, so those
 *   PRs would otherwise vanish). Reviewed-only rows read as direct
 *   ("Requested of you"); a reviewed PR still in a requested result
 *   keeps that result's group; your own PRs stay out via `-author:@me`.
 * - With a typed author, `author:<login> is:open` adds that author's
 *   other open PRs as scope "other" ("Not requested of you").
 * - Drafts and approval status never filter anything, in any group.
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

function fakePr(n: number, title: string, author = "teammate", extra: Record<string, unknown> = {}): unknown {
  return {
    __typename: "PullRequest",
    number: n,
    title,
    author: { login: author },
    updatedAt: "2026-10-01T00:00:00Z",
    headRefName: `branch-${n}`,
    state: "OPEN",
    ...extra,
  };
}

/** One flat fixture row as a GraphQL search node. */
function toNode(p: unknown): unknown {
  const r = (p ?? {}) as Record<string, unknown>;
  const flat = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    __typename: "PullRequest",
    ...r,
    reviewRequests: { nodes: flat(r.reviewRequests).map((x) => ({ requestedReviewer: x })) },
    latestReviews: { nodes: flat(r.latestReviews) },
  };
}

type GhBodies = {
  direct?: unknown[];
  all?: unknown[];
  reviewed?: unknown[];
  authorOther?: unknown[];
  fail?: Array<"direct" | "all" | "reviewed" | "authorOther">;
};

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
      const after = valueOf(opts.args, "after");
      const key = q.includes("reviewed-by:@me")
        ? "reviewed"
        : q.includes("user-review-requested:@me")
          ? "direct"
          : q.includes("review-requested:@me")
            ? "all"
            : "authorOther";
      if (bodies.fail?.includes(key)) return { stdout: "", stderr: "mock gh is down", code: 1 };
      const rows = [...((key === "direct" ? bodies.direct : key === "all" ? bodies.all : key === "reviewed" ? bodies.reviewed : bodies.authorOther) ?? [])];
      // Cursor pages: first call returns the first `first` rows with a
      // next-page cursor; any `after:` call returns the rest, exhausted.
      const first = Number(valueOf(opts.args, "first") ?? "30");
      const page = after === undefined ? rows.slice(0, first) : rows.slice(first);
      const hasNextPage = after === undefined ? rows.length > first : false;
      const endCursor = hasNextPage ? `${key}-next` : null;
      return {
        stdout: JSON.stringify({
          data: { search: { pageInfo: { hasNextPage, endCursor }, nodes: page.map(toNode) } },
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-ch385-"));
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

interface TestRow {
  prNumber?: number;
  author?: string;
  reviewScope?: string;
}

interface TestBody {
  changes: TestRow[];
  hasMore: boolean;
  cursor: string | null;
}

async function getBody(app: TestApp, repoId: string, query: string): Promise<TestBody> {
  const res = await app.inject({
    method: "GET",
    url: `/api/repos/${repoId}/changes${query}`,
    headers: { authorization: "Bearer tok" },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as TestBody;
}

function queryOf(args: string[]): string {
  return args.find((a) => a.startsWith("q="))?.slice("q=".length) ?? "";
}

describe("already-reviewed and typed-author lists (#385)", () => {
  it("a reviewed-only PR lands in Requested of you; drafts and approvals never filter", async () => {
    const { runner, ghCalls } = stubGh({
      direct: [],
      all: [],
      reviewed: [
        fakePr(501, "Reviewed draft", "teammate", { isDraft: true }),
        fakePr(502, "Reviewed approved", "teammate", { reviewDecision: "APPROVED" }),
      ],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10");
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(501)?.reviewScope).toBe("direct");
      expect(byNumber.get(502)?.reviewScope).toBe("direct");
      // Three searches per load: direct + team-inclusive + reviewed-by.
      expect(ghCalls).toHaveLength(3);
      expect(ghCalls.map(queryOf).some((q) => q.includes("reviewed-by:@me"))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("a reviewed PR still in a requested result keeps that group, once", async () => {
    const { runner } = stubGh({
      direct: [fakePr(601, "Still asked of you")],
      all: [fakePr(601, "Still asked of you"), fakePr(602, "Still asked of the team", "teammate", { reviewRequests: [{ __typename: "Team", slug: "core" }] })],
      reviewed: [fakePr(601, "Still asked of you"), fakePr(602, "Still asked of the team")],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10");
      expect(body.changes.filter((c) => c.prNumber === 601)).toHaveLength(1);
      expect(body.changes.filter((c) => c.prNumber === 602)).toHaveLength(1);
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(601)?.reviewScope).toBe("direct");
      expect(byNumber.get(602)?.reviewScope).toBe("team");
    } finally {
      await app.close();
    }
  });

  it("the reviewed search excludes your own PRs server-side", async () => {
    const { runner, ghCalls } = stubGh({ direct: [], all: [], reviewed: [] });
    const { app, repoId } = await setupRepo(runner);
    try {
      await getBody(app, repoId, "?filter=review-requested&limit=10");
      const reviewedCall = ghCalls.find((a) => queryOf(a).includes("reviewed-by:@me"));
      expect(reviewedCall).toBeDefined();
      expect(queryOf(reviewedCall!)).toContain("-author:@me");
    } finally {
      await app.close();
    }
  });

  it("a failing reviewed search keeps the requested rows", async () => {
    const { runner } = stubGh({
      direct: [fakePr(701, "Asked of you")],
      all: [],
      fail: ["reviewed"],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10");
      expect(body.changes.map((c) => c.prNumber)).toEqual([701]);
    } finally {
      await app.close();
    }
  });

  it("a typed author adds their other open PRs as scope other, minus the ones shown", async () => {
    const { runner, ghCalls } = stubGh({
      direct: [fakePr(801, "Alice asks you", "alice")],
      all: [fakePr(801, "Alice asks you", "alice")],
      reviewed: [],
      authorOther: [
        fakePr(801, "Alice asks you", "alice"),
        fakePr(802, "Alice works alone", "alice"),
        fakePr(803, "Alice drafts alone", "alice", { isDraft: true, reviewDecision: "APPROVED" }),
      ],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10&author=alice");
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      // Already shown through the requested search: keeps that group, once.
      expect(body.changes.filter((c) => c.prNumber === 801)).toHaveLength(1);
      expect(byNumber.get(801)?.reviewScope).toBe("direct");
      // The rest: "other", drafts and approvals included.
      expect(byNumber.get(802)?.reviewScope).toBe("other");
      expect(byNumber.get(803)?.reviewScope).toBe("other");
      // The typed login rides all four searches; the author's-other-PRs
      // search carries no -author:@me of its own.
      const queries = ghCalls.map(queryOf);
      expect(queries.filter((q) => q.includes("author:alice"))).toHaveLength(4);
      const otherCall = ghCalls.find((a) => queryOf(a).startsWith("repo:") && queryOf(a).includes("author:alice") && !queryOf(a).includes("review"));
      expect(otherCall).toBeDefined();
      expect(queryOf(otherCall!)).not.toContain("-author:@me");
    } finally {
      await app.close();
    }
  });

  it("typing your own login lists your open PRs as other instead of hiding them", async () => {
    const { runner } = stubGh({
      direct: [],
      all: [],
      reviewed: [],
      authorOther: [fakePr(901, "My own PR", "viewer-self")],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10&author=viewer-self");
      const byNumber = new Map(body.changes.map((c) => [c.prNumber, c]));
      expect(byNumber.get(901)?.reviewScope).toBe("other");
    } finally {
      await app.close();
    }
  });

  it("without a typed author there is no author search and no other rows", async () => {
    const { runner, ghCalls } = stubGh({
      direct: [fakePr(1001, "Asked of you")],
      all: [],
      reviewed: [],
      authorOther: [fakePr(1002, "Should never load")],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const body = await getBody(app, repoId, "?filter=review-requested&limit=10");
      expect(ghCalls).toHaveLength(3);
      expect(body.changes.map((c) => c.prNumber)).toEqual([1001]);
      expect(body.changes.some((c) => c.reviewScope === "other")).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("the reviewed search pages through the cursor like the other searches", async () => {
    const { runner } = stubGh({
      direct: [],
      all: [],
      reviewed: [fakePr(1101, "Reviewed one"), fakePr(1102, "Reviewed two")],
    });
    const { app, repoId } = await setupRepo(runner);
    try {
      const first = await getBody(app, repoId, "?filter=review-requested&limit=1");
      expect(first.hasMore).toBe(true);
      expect(first.changes.map((c) => c.prNumber)).toEqual([1101]);
      expect(decodeChangesCursor(first.cursor)).toMatchObject({ reviewed: "reviewed-next" });
      const second = await getBody(
        app,
        repoId,
        `?filter=review-requested&limit=1&cursor=${encodeURIComponent(first.cursor!)}`,
      );
      expect(second.hasMore).toBe(false);
      expect(second.changes.map((c) => c.prNumber)).toEqual([1102]);
    } finally {
      await app.close();
    }
  });
});
