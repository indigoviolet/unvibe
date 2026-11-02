/**
 * #298: batched review-status refresh.
 *
 * All PR-backed reviews of one repo are answered by ONE GraphQL
 * query (aliases per PR), branch reviews by the local git tip.
 * Flipping gh to merged/approved with a new head updates the stored
 * state/decision and the "new commits" tag (`pendingHeadSha`), with
 * no re-ingest (version and stored head unchanged). A steady head
 * clears the tag again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RealCommandRunner } from "../src/exec/index.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/index.js";
import { createApp } from "../src/server.js";

const real = new RealCommandRunner();

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  return res.stdout.trim();
}

describe("batched review statuses (#298)", () => {
  it("one gh query per repo updates state, decision and new-commits tag", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-298-"));
    await git(dir, "init", "-b", "main");
    await git(dir, "config", "user.email", "t@example.com");
    await git(dir, "config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\n");
    await git(dir, "add", ".");
    await git(dir, "commit", "-m", "base");
    await git(dir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\n");
    await git(dir, "commit", "-am", "feature");
    const head1 = await git(dir, "rev-parse", "HEAD");
    await git(dir, "remote", "add", "origin", "https://github.com/acme/app.git");

    let flipped = false;
    let head = head1;
    let statusCalls = 0;
    const statusQueries: string[] = [];
    const view = (pr: number): RunResult => ({
      stdout: JSON.stringify({
        title: `PR ${pr}`,
        body: "Body.",
        author: { login: "a" },
        state: flipped ? "MERGED" : "OPEN",
        isDraft: false,
        reviewDecision: flipped ? "APPROVED" : "REVIEW_REQUIRED",
        reviewRequests: [],
        latestReviews: [],
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: head,
      }),
      stderr: "",
      code: 0,
    });
    const runner: CommandRunner = {
      run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
        if (cmd === "gh") {
          const args = opts.args;
          if (args[0] === "pr" && args[1] === "view") return view(Number(args[2]));
          if (args[0] === "api" && args[1] === "graphql") {
            const query = args.find((a) => a.startsWith("query="))?.slice(6) ?? "";
            if (query.includes("pullRequest(number:")) {
              statusCalls++;
              statusQueries.push(query);
              const repository: Record<string, unknown> = {};
              for (const m of query.matchAll(/pr(\d+):/g)) {
                repository[`pr${m[1]}`] = {
                  number: Number(m[1]),
                  state: flipped ? "MERGED" : "OPEN",
                  isDraft: false,
                  reviewDecision: flipped ? "APPROVED" : "REVIEW_REQUIRED",
                  headRefOid: head,
                  reviewRequests: { nodes: [] },
                  latestReviews: { nodes: [] },
                };
              }
              return { stdout: JSON.stringify({ data: { repository } }), stderr: "", code: 0 };
            }
            return {
              stdout: JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }),
              stderr: "",
              code: 0,
            };
          }
          if (args[0] === "api" && args[1] === "user") return { stdout: '{"login":"a"}', stderr: "", code: 0 };
          return { stdout: "", stderr: `unexpected gh ${args.join(" ")}`, code: 1 };
        }
        if (cmd === "git" && opts.args.includes("fetch")) return { stdout: "", stderr: "", code: 0 };
        return real.run(cmd, opts);
      },
    };

    const { app } = await createApp("tok", { runner, autoPipeline: false });
    const authed = { authorization: ["Bearer", "tok"].join(" ") };
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
      if (added.statusCode !== 200) throw new Error(`add repo failed: ${added.statusCode} ${added.body}`);
      const repo = (added.json() as { repos: { id: string }[] }).repos.find((r) => r.id !== "demo")!;

      const create = async (payload: Record<string, unknown>): Promise<string> => {
        const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: repo.id, ...payload } });
        expect([200, 201, 202]).toContain(created.statusCode);
        const id = (created.json() as { review: { id: string } }).review.id;
        const start = Date.now();
        while (Date.now() - start < 15000) {
          const got = await app.inject({ method: "GET", url: `/api/reviews/${id}`, headers: authed });
          const snap = got.json() as { ingest?: { status?: string }; version?: { n?: number } };
          if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return id;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error("review never became ready");
      };
      const pr1 = await create({ pr: 1 });
      const pr2 = await create({ pr: 2 });
      const branchReview = await create({ branch: "feature" });

      // PR merges + is approved + gains a commit; the branch gains one too.
      fs.writeFileSync(path.join(dir, "a.py"), "x = 1\ny = 2\nz = 3\n");
      await git(dir, "commit", "-am", "second");
      head = await git(dir, "rev-parse", "HEAD");
      flipped = true;

      const res = await app.inject({ method: "POST", url: `/api/repos/${repo.id}/review-statuses`, headers: authed });
      expect(res.statusCode).toBe(200);
      const statuses = (res.json() as { statuses: { reviewId: string; prState?: string; reviewDecision?: string; stale: boolean }[] }).statuses;
      expect(statusCalls).toBe(1);
      expect(statusQueries[0]).toContain("pr1: pullRequest(number: 1)");
      expect(statusQueries[0]).toContain("pr2: pullRequest(number: 2)");
      const byId = new Map(statuses.map((s) => [s.reviewId, s]));
      for (const id of [pr1, pr2]) {
        expect(byId.get(id)?.prState).toBe("merged");
        expect(byId.get(id)?.reviewDecision).toBe("approved");
        expect(byId.get(id)?.stale).toBe(true);
      }
      // Branch review: local tip moved, no PR fields, same one gh call.
      expect(byId.get(branchReview)?.stale).toBe(true);
      expect(byId.get(branchReview)?.prState).toBeUndefined();

      const list = await app.inject({ method: "GET", url: "/api/reviews", headers: authed });
      const summaries = (list.json() as { reviews: { id: string; prState?: string; reviewDecision?: string; stale: boolean; currentVersion: number }[] }).reviews;
      for (const id of [pr1, pr2]) {
        const found = summaries.find((r) => r.id === id);
        expect(found?.prState).toBe("merged");
        expect(found?.reviewDecision).toBe("approved");
        expect(found?.stale).toBe(true);
        expect(found?.currentVersion).toBe(1);
      }

      // No re-ingest: stored version still at the first head, tag is pending.
      const snapRes = await app.inject({ method: "GET", url: `/api/reviews/${pr1}`, headers: authed });
      const snap = snapRes.json() as { version: { headSha: string; n: number }; pendingHeadSha?: string };
      expect(snap.version.headSha).toBe(head1);
      expect(snap.version.n).toBe(1);
      expect(snap.pendingHeadSha).toBe(head);

      // Steady again: the tag clears and the state flips back, still one call.
      flipped = false;
      head = head1;
      // The local branch tip is still the second commit, so only the PR
      // reviews clear here.
      const res2 = await app.inject({ method: "POST", url: `/api/repos/${repo.id}/review-statuses`, headers: authed });
      expect(res2.statusCode).toBe(200);
      expect(statusCalls).toBe(2);
      const statuses2 = (res2.json() as { statuses: { reviewId: string; prState?: string; stale: boolean }[] }).statuses;
      const pr1Again = statuses2.find((s) => s.reviewId === pr1);
      expect(pr1Again?.prState).toBe("open");
      expect(pr1Again?.stale).toBe(false);
      const snap2 = (await app.inject({ method: "GET", url: `/api/reviews/${pr1}`, headers: authed })).json() as { pendingHeadSha?: string };
      expect(snap2.pendingHeadSha).toBeUndefined();
    } finally {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds one aliased query and parses it back", async () => {
    const { buildPrStatusesQuery, parsePrStatuses } = await import("../src/repos/index.js");
    const query = buildPrStatusesQuery([3, 7]);
    expect(query).toContain("pr3: pullRequest(number: 3)");
    expect(query).toContain("pr7: pullRequest(number: 7)");
    expect(query).toContain("headRefOid");
    const parsed = parsePrStatuses(
      JSON.stringify({ data: { repository: { pr3: { state: "MERGED", headRefOid: "abc" }, pr7: null } } }),
      [3, 7],
    );
    expect(parsed.get(3)?.state).toBe("MERGED");
    expect(parsed.has(7)).toBe(false);
    expect(parsePrStatuses("not json", [3]).size).toBe(0);
  });
});
