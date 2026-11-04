/**
 * Since-B step 2 (issue #351): any commit as B, and the no-review-yet path.
 *
 * - `POST /since-baseline {sha}` stores a commit baseline with the B..head
 *   hunk set by hunk-content comparison (never git ancestry): a rebased B
 *   that is no longer an ancestor compares the same as a fast-forward one.
 * - An unfetchable B fails loudly (502 naming the short sha); a malformed
 *   sha is a 400. `DELETE` clears back to the default B.
 * - `GET /prior-github-review` answers the authenticated user's own latest
 *   GitHub review `commit_id` (other users' reviews ignored, entries
 *   without a `commit_id` ignored), or null — best effort, never an error.
 * - The no-review path: with B from the stubbed reviews response, one
 *   guide run writes the normal guide plus the Since-B section (with a
 *   resolved feedback link), marks the all-since plotline new, and stores
 *   the hunk set the filter and markers read. No update-pass job runs.
 *
 * Fake/stub command runner (real local git, stubbed `gh`) + scripted fake
 * agent; made-up fixtures, no live spend.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { hunkChangedSinceB, isSinceBaseline, sinceBaselineLabel } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { RealCommandRunner } from "../src/exec/index.js";
import type { CommandRunner, RunOptions, RunResult } from "../src/exec/index.js";
import { createApp } from "../src/server.js";
import {
  baselineIdentity,
  buildSinceSectionCards,
  computeSinceHunks,
  diffFilesAtCommit,
  formatReaderReviewedContext,
  markNewSincePlotlines,
} from "../src/versions/since.js";
import { readerApply, requestedReaderFields } from "../src/pipeline/apply.js";
import { isGitFetch } from "./git-args.js";

const real = new RealCommandRunner();
const authed = { authorization: "Bearer tok" };

async function git(cwd: string, ...args: string[]): Promise<string> {
  const res = await real.run("git", { args, cwd });
  if (res.code !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout.trim();
}

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const DIV = ["# divider one", "# divider two", "# divider three", "", ""];
// c1 reworks alpha; c2 reworks beta and adds gamma. The dividers keep the
// two regions in separate -U3 hunks (like the j351 journey fixture).
const V1 = ["def alpha():", "    return 1", "", "", "CONST_A = 10", "", "", ...DIV, "def beta():", "    return 2", ""].join("\n");
const V2 = ["def alpha():", "    return 11", "", "", "CONST_A = 10", "", "", ...DIV, "def beta():", "    return 2", ""].join(
  "\n",
);
const V3 = ["def alpha():", "    return 11", "", "", "CONST_A = 10", "", "", ...DIV, "def beta():", "    return 22", "", "", "def gamma():", "    return 3", ""].join(
  "\n",
);

async function makeRepo(): Promise<{ dir: string; c1: string; c2: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-351s2-"));
  await git(dir, "init", "-b", "main");
  await git(dir, "config", "user.email", "t@example.com");
  await git(dir, "config", "user.name", "T");
  fs.writeFileSync(path.join(dir, "a.py"), `${V1}\n`);
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "base");
  await git(dir, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(dir, "a.py"), `${V2}\n`);
  await git(dir, "commit", "-am", "rework alpha");
  const c1 = await git(dir, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "a.py"), `${V3}\n`);
  await git(dir, "commit", "-am", "rework beta and add gamma");
  const c2 = await git(dir, "rev-parse", "HEAD");
  // No origin: branch reviews need none, and a gone sha must fail fast
  // (no network fetch attempt). The PR test below adds its own remote.
  return { dir, c1, c2 };
}

async function waitReady(
  inject: (opts: { method: string; url: string; headers?: Record<string, string> }) => Promise<{ statusCode: number; json(): unknown }>,
  id: string,
): Promise<ReviewSnapshot> {
  const start = Date.now();
  for (;;) {
    const got = await inject({ method: "GET", url: `/api/reviews/${id}` });
    if (got.statusCode === 200) {
      const snap = got.json() as ReviewSnapshot;
      if ((snap.ingest?.status ?? "ready") === "ready" && (snap.version?.n ?? 0) >= 1) return snap;
    }
    if (Date.now() - start > 15000) throw new Error("ingest did not finish");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function registerRepo(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  dir: string,
): Promise<string> {
  const added = await app.inject({ method: "POST", url: "/api/repos", headers: authed, payload: { path: dir } });
  expect(added.statusCode).toBe(200);
  const allRepos = (added.json() as { repos: { id: string; localPath?: string }[] }).repos;
  return allRepos.find((r) => (r.localPath ?? "").includes("unvibe-351s2-"))!.id;
}

describe("since-B step 2: pure context builders", () => {
  it("formats the reader context for a commit baseline, and the one-liner without one", () => {
    const sha = "b".repeat(40);
    const snap = {
      sinceBaseline: { kind: "commit", sha },
      review: { currentVersion: 1, versions: [{ n: 1, headSha: sha, mergeBaseSha: "0".repeat(40), baseRef: "main", fetchedAt: 1, idMapping: {} }] },
      version: { n: 1, headSha: sha, mergeBaseSha: "0".repeat(40), baseRef: "main", fetchedAt: 2, idMapping: {} },
      commits: [{ sha, subject: "rework alpha", body: "", files: [], hunks: [] }],
    } as unknown as ReviewSnapshot;
    const withHunks = formatReaderReviewedContext(snap, { added: ["h:k:a"], changed: ["h:k:b"] });
    expect(withHunks).toContain("Reviewed up to B");
    expect(withHunks).toContain(sha.slice(0, 8));
    expect(withHunks).toContain('"rework alpha"');
    expect(withHunks).toContain("h:k:b, h:k:a");
    expect(withHunks).toContain("Since-B section");
    const empty = formatReaderReviewedContext(snap, { added: [], changed: [] });
    expect(empty).toContain("no hunks changed since B");
    const unavailable = formatReaderReviewedContext(snap, undefined);
    expect(unavailable).toContain("comparison is unavailable");
    expect(unavailable).toContain("write the normal guide and no Since-B section");
    const plain = formatReaderReviewedContext({} as ReviewSnapshot, undefined);
    expect(plain).toBe("(No prior-review baseline: explain the whole change; write no Since-B section.)");
    expect(baselineIdentity(snap, { kind: "commit", sha })).toBe(`${sha.slice(0, 8)} "rework alpha"`);
    expect(sinceBaselineLabel({ kind: "commit", sha })).toBe(sha.slice(0, 8));
    expect(sinceBaselineLabel({ kind: "version", version: 2 })).toBe("v2");
  });

  it("buildSinceSectionCards uniquifies ids and drops unknown answers", () => {
    const snap = {
      review: { currentVersion: 1 },
      pages: [{ id: "p", kind: "root", title: "G", cards: [{ id: "since-1" }] }],
    } as unknown as ReviewSnapshot;
    const cards = buildSinceSectionCards(snap, [
      {
        id: "since-1",
        title: "Delta",
        blocks: [],
        answerRefs: [
          { kind: "comment", id: "7" },
          { kind: "comment", id: "999" },
        ],
      },
    ]);
    expect(cards).toHaveLength(1);
    // Collides with the existing card id: suffixed, not overwritten.
    expect(cards[0].id).toBe("since-1-v1");
    expect(cards[0].pageId).toBe("since");
    // Unknown answer ids resolve to nothing (no comments on the snapshot).
    expect(cards[0].answers ?? []).toEqual([]);
  });

  it("markNewSincePlotlines marks only all-since plotlines", () => {
    const plotlines = [{ id: "fresh" }, { id: "mixed" }, { id: "old" }];
    const states = [
      { contentHash: "a", plotline: "fresh" },
      { contentHash: "b", plotline: "fresh" },
      { contentHash: "b", plotline: "mixed" },
      { contentHash: "c", plotline: "mixed" },
      { contentHash: "c", plotline: "old" },
    ];
    const marked = markNewSincePlotlines(plotlines, states, new Set(["a", "b"]));
    expect(marked).toEqual(["fresh"]);
    expect(plotlines.find((p) => p.id === "fresh")?.newSinceBaseline).toBe(true);
    expect(plotlines.find((p) => p.id === "mixed")?.newSinceBaseline).toBeUndefined();
    expect(markNewSincePlotlines([{ id: "x" }], [{ contentHash: "a" }], new Set())).toEqual([]);
  });

  it("readerApply keeps sinceSection when the prompt requested it", () => {
    // Bodies stand in for the prompt generations (#252): the real
    // `prompts/reader.md` output-shape block names "sinceSection" quoted.
    const body = `... {"pendingCards": [], "plotlines": [], "glossary": [], "sinceSection": {"cards": []}} ...`;
    expect(requestedReaderFields(body)).toContain("sinceSection");
    const applied = readerApply(
      [{ title: "The problem", blocks: [] }],
      {
        cardIds: ["problem"],
        sinceSection: { cards: [{ id: "since-1", title: "Delta", blocks: [], answers: [] }] },
      } as unknown as Record<string, unknown>,
      body,
    );
    expect(applied.sinceSection?.cards).toHaveLength(1);
    const dropped = readerApply(
      [{ title: "The problem", blocks: [] }],
      { sinceSection: { cards: [{ id: "since-1" }] } } as unknown as Record<string, unknown>,
      "no quoted field names here",
    );
    expect(dropped.sinceSection).toBeUndefined();
  });
});

describe("since-B step 2: commit baselines on branch reviews", () => {
  it("picks a commit, survives a rebased B, and fails loudly when B is gone", async () => {
    const { dir, c1 } = await makeRepo();
    const { app, ctx } = await createApp("tok", { runner: real, autoPipeline: false });
    try {
      const repoId = await registerRepo(app, dir);
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, branch: "feature" } });
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitReady((o) => app.inject({ ...o, headers: authed }), id);

      // The offer has nothing to say on a branch review.
      const prior = await app.inject({ method: "GET", url: `/api/reviews/${id}/prior-github-review`, headers: authed });
      expect(prior.statusCode).toBe(200);
      expect(prior.json()).toEqual({ review: null });

      // Pick c1: the B..head set is the c2 delta by content.
      const picked = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { sha: c1 } });
      expect(picked.statusCode).toBe(200);
      const body = picked.json() as { baseline: unknown; changedHunks: number; newHunks: number };
      expect(body.baseline).toEqual({ kind: "commit", sha: c1 });
      expect(isSinceBaseline(body.baseline)).toBe(true);
      let snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.sinceBaseline).toEqual({ kind: "commit", sha: c1 });
      const headIds = new Set(snap.files.flatMap((f) => f.hunks.map((h) => `h:${f.fileKey}:${h.contentHash}`)));
      for (const hid of [...(snap.sinceHunks?.added ?? []), ...(snap.sinceHunks?.changed ?? [])]) {
        expect(headIds.has(hid)).toBe(true);
      }
      expect((snap.sinceHunks?.added.length ?? 0) + (snap.sinceHunks?.changed.length ?? 0)).toBeGreaterThan(0);
      // The alpha hunk is identical in the B diff and the head diff:
      // it is not part of the delta.
      const alphaHunk = snap.files[0].hunks.find((h) => h.lines.some((l) => l.text.includes("return 11")));
      expect(alphaHunk).toBeDefined();
      const alphaId = `h:${snap.files[0].fileKey}:${alphaHunk!.contentHash}`;
      expect(hunkChangedSinceB(alphaId, snap.sinceHunks)).toBe(false);
      const before = new Set([...(snap.sinceHunks?.added ?? []), ...(snap.sinceHunks?.changed ?? [])]);

      // Rebase the branch: same content, all new shas. B is fetchable but
      // no longer an ancestor — content comparison gives the same set.
      await git(dir, "reset", "--hard", "main");
      const ancestor = await real.run("git", { args: ["merge-base", "--is-ancestor", c1, "HEAD"], cwd: dir });
      expect(ancestor.code).not.toBe(0);
      fs.writeFileSync(path.join(dir, "a.py"), `${V2}\n`);
      await git(dir, "commit", "-am", "rework alpha (rebased)");
      fs.writeFileSync(path.join(dir, "a.py"), `${V3}\n`);
      await git(dir, "commit", "-am", "rework beta and add gamma (rebased)");
      const again = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { sha: c1 } });
      expect(again.statusCode).toBe(200);
      snap = ctx.reviews.getSnapshot(id)!;
      expect(new Set([...(snap.sinceHunks?.added ?? []), ...(snap.sinceHunks?.changed ?? [])])).toEqual(before);

      // Malformed sha: 400. Gone sha: loud 502 naming the short sha.
      const bad = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { sha: "xyz" } });
      expect(bad.statusCode).toBe(400);
      const gone = "f".repeat(40);
      const missing = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { sha: gone } });
      expect(missing.statusCode).toBe(502);
      expect((missing.json() as { error: string }).error).toContain(gone.slice(0, 8));
      expect((missing.json() as { error: string }).error).toContain("force-push");
      // The failed pick leaves the stored baseline alone but records a
      // persistent `sinceError` for the picker and the offer.
      expect(ctx.reviews.getSnapshot(id)!.sinceBaseline).toEqual({ kind: "commit", sha: c1 });
      expect(ctx.reviews.getSnapshot(id)!.sinceError).toContain(gone.slice(0, 8));

      // Clearing drops the baseline and the hunk set.
      const cleared = await app.inject({ method: "DELETE", url: `/api/reviews/${id}/since-baseline`, headers: authed });
      expect(cleared.statusCode).toBe(200);
      const clearedSnap = ctx.reviews.getSnapshot(id)!;
      expect(clearedSnap.sinceBaseline).toBeUndefined();
      expect(clearedSnap.sinceHunks).toBeUndefined();
      expect(clearedSnap.sinceError).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe("since-B step 2: the no-review-yet path", () => {
  it("one guide run writes the normal guide plus the Since-B section", async () => {
    const { dir, c1, c2 } = await makeRepo();
    await git(dir, "remote", "add", "origin", "https://github.com/acme/app.git");
    const { FakeCommandRunner } = await import("../src/exec/index.js");
    const fake = new FakeCommandRunner();
    fake.enqueue({
      cmd: "gh",
      args: ["pr", "view", "77", "--json", "title,body,author,state,isDraft,reviewDecision,reviewRequests,latestReviews,baseRefName,headRefName,headRefOid"],
      stdout: JSON.stringify({
        title: "Feature PR",
        body: "",
        author: { login: "you" },
        state: "OPEN",
        isDraft: false,
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: c2,
      }),
      stderr: "",
      code: 0,
    });
    fake.enqueue({ cmd: "gh", args: ["api", "repos/acme/app/pulls/77/comments"], stdout: "[]", stderr: "", code: 0 });
    fake.enqueue({ cmd: "gh", args: ["api", "repos/acme/app/issues/77/comments"], stdout: "[]", stderr: "", code: 0 });
    fake.enqueue({ cmd: "gh", args: ["api", "user", "--jq", ".login"], stdout: "you", stderr: "", code: 0 });
    fake.enqueue({
      cmd: "gh",
      args: ["api", "repos/acme/app/pulls/77/reviews", "--paginate"],
      stdout: JSON.stringify([
        { id: 11, user: { login: "teammate" }, commit_id: c2, state: "APPROVED", submitted_at: "2026-11-03T10:00:00Z" },
        { id: 12, user: { login: "you" }, commit_id: c1, state: "CHANGES_REQUESTED", submitted_at: "2026-11-01T10:00:00Z" },
        { id: 13, user: { login: "you" }, commit_id: c1, state: "COMMENTED", submitted_at: "2026-11-02T10:00:00Z" },
        { id: 14, user: { login: "you" }, state: "COMMENTED", submitted_at: "2026-11-04T10:00:00Z" },
      ]),
      stderr: "",
      code: 0,
    });
    const runner: CommandRunner = {
      run: async (cmd: string, opts: RunOptions): Promise<RunResult> => {
        if (cmd !== "gh") {
          if (cmd === "git" && isGitFetch(opts.args)) return { stdout: "", stderr: "", code: 0 };
          return real.run(cmd, opts);
        }
        return fake.run(cmd, opts);
      },
    };
    const agents = new FakeAgentRunner();
    const { app, ctx } = await createApp("tok", { runner, agents, autoPipeline: false });
    try {
      process.env.UNVIBE_REPO_ROOTS = "";
      const repoId = await registerRepo(app, dir);
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId, pr: 77 } });
      expect(created.statusCode).toBe(202);
      const id = (created.json() as ReviewSnapshot).review.id;

      // The offer: the user's own latest review (c1) wins over the
      // teammate's later review and the entry without a commit_id.
      const prior = await app.inject({ method: "GET", url: `/api/reviews/${id}/prior-github-review`, headers: authed });
      expect(prior.statusCode).toBe(200);
      expect(prior.json()).toEqual({
        review: { sha: c1, author: "you", submittedAt: "2026-11-02T10:00:00Z" },
      });

      // Accepting before the guide run stores the commit baseline. The
      // ingest may still be running (hunks filled by the reader) or done
      // (hunks computed here) — either way the baseline is what matters.
      const accepted = await app.inject({ method: "POST", url: `/api/reviews/${id}/since-baseline`, headers: authed, payload: { sha: c1 } });
      expect(accepted.statusCode).toBe(200);
      expect((accepted.json() as { baseline: unknown }).baseline).toEqual({ kind: "commit", sha: c1 });

      const ready = await waitReady((o) => app.inject({ ...o, headers: authed }), id);
      expect(ready.review.currentVersion).toBe(1);
      const stored = ctx.reviews.getSnapshot(id)!;
      expect(stored.sinceBaseline).toEqual({ kind: "commit", sha: c1 });

      // The expected B..head set, computed straight from git (the route
      // and the reader fill use the same function; POST timing decides
      // which one stored it).
      const bFiles = await diffFilesAtCommit(real, dir, stored.version.mergeBaseSha, c1);
      const expected = computeSinceHunks(bFiles, stored.files);
      const sinceIds = [...expected.changed, ...expected.added];
      expect(sinceIds.length).toBeGreaterThan(0);

      // The reader reply cites real hunks: the guide plus one Since-B
      // card answering the reviewed commit, and two plotlines — one over
      // the whole PR, one over the delta only.
      const snap = ctx.reviews.getSnapshot(id)!;
      const ids = snap.files.flatMap((f) => f.hunks.map((h) => `h:${f.fileKey}:${h.contentHash}`));
      expect(ids.length).toBeGreaterThan(0);
      const cite = sinceIds[0];
      const readerReply =
        `## The problem\n\nProblem text [[${ids[0]}]].\n\n` +
        `## The central idea\n\nCentral text.\n\n` +
        "```json\n" +
        JSON.stringify({
          cardIds: ["problem", "central"],
          pendingCards: [],
          plotlines: [
            // Fresh first: a twice-claimed hunk keeps its first plotline,
            // so the delta-only thread owns the since hunks.
            { id: "fresh", name: "Fresh follow-ups", description: "Post-B work.", hunks: sinceIds },
            { id: "core", name: "Core work", description: "The change.", hunks: ids },
          ],
          sinceSection: {
            cards: [{
              id: "since-1",
              title: "Beta reworked, gamma added",
              blocks: [{
                type: "paragraph",
                id: "b-s1",
                text: { standard: "Beta now returns 22 and gamma is new." },
                citations: [{ target: cite }],
              }],
              answers: [{ kind: "commit", id: c1 }],
            }],
          },
        }) +
        "\n```\n";
      agents.addScript({ match: "# Reader task", events: textEvents(readerReply) });
      agents.addScript({
        match: "# Critic task",
        events: textEvents(`No findings.\n\n\`\`\`json\n{"findings": []}\n\`\`\`\n`),
      });

      await ctx.pipeline.resumeReview(id);
      await ctx.jobs.drain(60000);
      const jobs = ctx.jobs.listByReview(id);
      const readers = jobs.filter((j) => j.kind === "reader");
      expect(readers).toHaveLength(1);
      expect(readers[0].state).toBe("done");
      expect(jobs.some((j) => j.kind === "update-pass")).toBe(false);

      // The single run was told about B.
      const readerPrompt = agents.prompts.find((p) => p.text.includes("# Reader task"))?.text ?? "";
      expect(readerPrompt).toContain("Reviewed up to B");
      expect(readerPrompt).toContain(c1.slice(0, 8));

      // The normal guide landed.
      const after = ctx.reviews.getSnapshot(id)!;
      const root = after.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => c.id)).toEqual(expect.arrayContaining(["problem", "central"]));

      // ...plus the Since-B section, with the commit answer resolved.
      expect(after.sinceSection?.baseline).toEqual({ kind: "commit", sha: c1 });
      expect(after.sinceSection?.headVersion).toBe(1);
      expect(after.sinceSection?.cards).toHaveLength(1);
      const card = after.sinceSection!.cards[0];
      expect(card.title).toContain("Beta");
      expect(card.answers).toHaveLength(1);
      expect(card.answers![0].kind).toBe("commit");
      expect(card.answers![0].label).toContain(c1.slice(0, 8));

      // Plotlines: the delta-only thread reads new; the whole-PR one joins
      // the count through the stored hunk set (no agent flag needed).
      expect(after.plotlines?.find((p) => p.id === "fresh")?.newSinceBaseline).toBe(true);
      expect(after.plotlines?.find((p) => p.id === "core")?.newSinceBaseline).toBeUndefined();
      expect(hunkChangedSinceB(cite, after.sinceHunks)).toBe(true);
      // The stored hunk set is the content-computed one, however it landed.
      expect(after.sinceHunks).toEqual({ added: expected.added, changed: expected.changed });
    } finally {
      await app.close();
    }
  }, 90000);
});
