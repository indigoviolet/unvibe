/**
 * M3 pipeline integration (PRD §11): demo e2e with the replay runner,
 * failure paths with scripted fakes, and the runInFork/runSmall seam.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentEvent, Job, Review, ReviewSnapshot } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { FakeCommandRunner } from "../src/exec/index.js";
import type { ModelCatalog } from "../src/settings/index.js";
import { ReplayAgentRunner } from "../src/replay/runner.js";
import { buildBasePack } from "../src/context/index.js";
import { writeReviewRows } from "../src/ingest/index.js";
import { toPromptSnapshot } from "../src/routes/prompts.js";
import type { IssuedSession } from "../src/mcp/index.js";
import { createApp } from "../src/server.js";
import { createSnapshotLookup, validateReply } from "../src/validate/index.js";
import { collectTargets } from "@unvibe/shared";
import { descriptionFor, HEAD_SHA, repoRow, sourceFile, versionRow } from "./m6-helpers.js";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "urllib3-5020",
);
const authed = { authorization: "Bearer tok" };

function replay(): ReplayAgentRunner {
  // Small streaming delay so the patch-order assertion below sees the
  // pipeline stream (with delayMs 0 the replay finishes inside the create
  // inject on fast hardware and the post-create subscriber sees nothing).
  return new ReplayAgentRunner({ fixturesDir, chunkChars: 256, delayMs: 5 });
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 30000,
  intervalMs = 50,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function textOf(events: AgentEvent[]): string {
  return events
    .filter((e) => e.type === "text")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
}

describe("pipeline demo e2e (replay)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("demo review streams to a complete snapshot equivalent to snapshot.json", async () => {
    const { app, ctx } = await createApp("tok", { agents: replay() });
    const patches: { ops: unknown[]; headRev: number }[] = [];
    try {
      // Start-page demo entry (repo-less change of kind demo).
      const repos = await app.inject({ method: "GET", url: "/api/repos", headers: authed });
      expect(repos.statusCode).toBe(200);
      const demoRepo = (repos.json() as { repos: { id: string }[] }).repos.find((r) => r.id === "demo");
      expect(demoRepo).toBeDefined();
      const changes = await app.inject({ method: "GET", url: "/api/repos/demo/changes", headers: authed });
      expect(changes.statusCode).toBe(200);
      expect((changes.json() as { changes: { kind: string }[] }).changes[0].kind).toBe("demo");

      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;

      // Capture patch order: subscribe before the pipeline finishes.
      const unsub = ctx.bus.subscribe(id, (ev) => {
        if (ev.type === "patch") patches.push({ ops: ev.ops, headRev: ev.headRev });
      });

      // Wait for the full demo (reader + critic×2 + stubs + 8 hunks +
      // 4 go-deeper fills + 7 concept fills).
      await waitFor(() => {
        const s = ctx.reviews.getSnapshot(id);
        if (!s) return false;
        const root = s.pages.find((p) => p.id === "root");
        if (!root || root.cards.length < 6) return false;
        if (root.cards.some((c) => c.pending)) return false;
        if (s.pages.filter((p) => p.kind === "finding").length < 2) return false;
        if (s.pages.filter((p) => p.kind === "concept").length < 7) return false;
        // Concept pages filled (revision bumped past the one-line stub).
        const concepts = s.pages.filter((p) => p.kind === "concept");
        if (concepts.some((p) => (p.cards[0]?.revision ?? 1) < 2)) return false;
        if (s.hunkStates.filter((h) => h.summary).length < 8) return false;
        return true;
      }, 60000);
      unsub();

      const snap = ctx.reviews.getSnapshot(id)!;
      const expected = JSON.parse(fs.readFileSync(path.join(fixturesDir, "snapshot.json"), "utf8")) as ReviewSnapshot;

      // Pages / cards / findings match the fixture in content.
      expect(snap.pages.find((p) => p.id === "root")!.cards.map((c) => c.id)).toEqual(
        expected.pages.find((p) => p.id === "root")!.cards.map((c) => c.id),
      );
      for (const fid of ["f-lf", "f-perf"]) {
        const got = snap.pages.find((p) => p.id === fid)!;
        const want = expected.pages.find((p) => p.id === fid)!;
        expect(got.title).toBe(want.title);
        expect(got.confidence).toBe(want.confidence);
        expect(got.summary).toBe(want.summary);
      }
      // Suggested comments (agent drafts, NOT marked for PR).
      const sug = snap.annotations.filter((a) => a.messages.some((m) => m.suggested));
      expect(sug.length).toBeGreaterThanOrEqual(2);
      for (const a of sug) {
        expect(a.post).toBe(false);
        expect(a.type).toBe("thread");
      }
      // threads.ts assigns `ann_` ids (not the fixture seed ids); match
      // the bare-LF draft by its suggested text instead.
      const tlf = snap.annotations.find((a) =>
        a.messages.some((m) => m.suggested && (m.text ?? "").includes("bare LF")),
      );
      expect(tlf).toBeDefined();
      expect(tlf?.anchor.host).toMatchObject({ kind: "diff-line" });
      // Every finding page links its suggested comment (PRD §4.9): the
      // Assessment card ends with a comment-link block whose thread is a
      // suggested, unposted draft with a canonical diff target.
      for (const fid of ["f-lf", "f-perf"]) {
        const page = snap.pages.find((p) => p.id === fid)!;
        const last = page.cards[page.cards.length - 1];
        const link = last.blocks.find((b) => b.type === "comment-link");
        expect(link, `${fid} links its suggested comment`).toBeDefined();
        if (link?.type === "comment-link") {
          const thread = snap.annotations.find((a) => a.id === link.threadId);
          expect(thread?.messages.some((m) => m.suggested)).toBe(true);
          expect(thread?.post).toBe(false);
          expect(link.diffRef).not.toMatch(/:(conn|tconn|tsock|log):/);
        }
      }

      // Hunk summaries + hidden reasons match the recordings.
      expect(snap.hunkStates).toHaveLength(8);
      for (const h of snap.hunkStates) expect(h.summary).toBeTruthy();
      const hiddenOf = (s: ReviewSnapshot, fileKey: string, i: number): string | undefined =>
        s.files.find((f) => f.fileKey === fileKey)!.hunks[i].hiddenReason;
      for (const s of [snap, expected]) {
        void s;
      }
      expect(hiddenOf(snap, "test-test_connection.py", 0)).toBe("imports");
      expect(hiddenOf(snap, "changelog-1362.bugfix.rst", 0)).toBe("docs / config");
      expect(hiddenOf(snap, "src-urllib3-connection.py", 0)).toBeUndefined();

      // Zero unverified citations across all cards.
      const lookup = createSnapshotLookup(snap, {
        aliases: { conn: "src-urllib3-connection.py", tconn: "test-test_connection.py", tsock: "test-with_dummyserver-test_socketlevel.py", log: "changelog-1362.bugfix.rst" },
        descTexts: { "d-p1": "x", "d-p2": "x", "d-p3": "x", "d-p4": "x", "d-p5": "x" },
        concepts: ["obs-fold", "http-headers", "header-injection", "regex-performance", "ows-rws", "set-cookie", "requests-cookies"],
      });
      for (const page of snap.pages) {
        for (const card of page.cards) {
          const rep = validateReply(card.blocks, lookup);
          expect(rep.tokens.filter((t) => t.status === "unverified")).toEqual([]);
        }
      }
      const totalCites = snap.pages.flatMap((p) => p.cards.flatMap((c) => collectTargets(c.blocks).citations));
      expect(totalCites.length).toBeGreaterThan(30);

      // Patches streamed in order: first card (problem) before critic findings.
      expect(patches.length).toBeGreaterThan(2);
      const opsText = JSON.stringify(patches.map((p) => p.ops));
      const firstProblem = opsText.indexOf("problem");
      const firstFinding = opsText.indexOf("f-lf");
      expect(firstProblem).toBeGreaterThanOrEqual(0);
      expect(firstFinding).toBeGreaterThanOrEqual(0);
      expect(firstProblem).toBeLessThan(firstFinding);

      // Measurement: totals + cache-hit rate + time-to-first-card.
      expect(snap.usageTotals).toBeDefined();
      expect(snap.usageTotals!.inputTokens).toBeGreaterThan(0);
      expect(snap.usageTotals!.cacheHitRate).toBeDefined();
      expect(snap.usageTotals!.firstCardAt).toBeDefined();
      const jobs = await app.inject({ method: "GET", url: `/api/jobs?review=${id}`, headers: authed });
      expect(jobs.statusCode).toBe(200);
      expect((jobs.json() as { jobs: Job[] }).jobs.length).toBeGreaterThan(10);
    } finally {
      await app.close();
    }
  }, 90000);
});

describe("pipeline failure paths (scripted fakes)", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  async function demoApp(agents: FakeAgentRunner, models?: ModelCatalog): Promise<ReturnType<typeof createApp>> {
    const created = await createApp("tok", {
      agents: agents as unknown as never,
      autoPipeline: false,
      ...(models ? { models } : {}),
    });
    return created;
  }

  async function makeDemoReview(ctx: Awaited<ReturnType<typeof createApp>>["ctx"]): Promise<string> {
    const { app } = { app: null as never };
    void app;
    // Direct demo ingest via the pipeline's demo helper is covered by the
    // e2e above; here we create a minimal review row + snapshot so fake
    // runners exercise validation/repair without fixtures.
    const id = `rv_test${Math.random().toString(36).slice(2, 8)}`;
    // Jobs FK requires reviews + repos rows (ReviewStore alone is not enough).
    ctx.db.prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
    ctx.db.prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    ).run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
    ctx.db.prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
    ).run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
    const snap: ReviewSnapshot = {
      review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
      version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
      files: [
        {
          fileKey: "a-py",
          path: "a.py",
          category: "source",
          hunks: [
            {
              contentHash: "h111",
              header: "@@ -1,2 +1,3 @@",
              newStart: 1,
              newEnd: 3,
              oldStart: 1,
              oldEnd: 2,
              added: 1,
              removed: 0,
              lines: [
                { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
                { kind: "add", newLine: 2, text: "y = 2" },
                { kind: "ctx", oldLine: 2, newLine: 3, text: "z = 3" },
              ],
            },
          ],
        },
      ],
      pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
      annotations: [],
      hunkStates: [],
      jobs: [],
      contributions: [],
      logTail: [],
      rev: 1,
    };
    ctx.reviews.putSnapshot(id, snap);
    return id;
  }

  it("malformed trailing JSON is a job-visible error", async () => {
    const agents = new FakeAgentRunner([
      { match: "Reader", events: [{ type: "text", delta: "## T\n\nBody.\n\n```json\n{bad\n```\n" }, { type: "done", stopReason: "end_turn" }] },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      await ctx.pipeline.startReview(id);
      await ctx.jobs.drain(5000).catch(() => {});
      const readerJobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
      expect(readerJobs.length).toBeGreaterThan(0);
      expect(readerJobs[0].state).toBe("error");
      expect(readerJobs[0].error).toMatch(/trailing JSON/);
    } finally {
      await app.close();
    }
  });

  // #28: a real agent sends no `cardIds`, narrates before its first card,
  // and streams cards before the reply ends.
  it("reader cards are stored once, without the agent's preamble", async () => {
    const trailer = `\`\`\`json\n{"pendingCards": [{"id": "g-flow", "label": "Data flow", "why": "w"}]}\n\`\`\`\n`;
    const agents = new FakeAgentRunner([
      {
        match: "Reader",
        events: [
          { type: "text", delta: "I'll start by reading the files to ground my restatement." },
          { type: "tool", name: "read", status: "start" },
          { type: "tool", name: "read", status: "end" },
          { type: "text", delta: "Two notes before the cards: only two files changed.\n\n" },
          { type: "text", delta: "## The problem\n\nIt was broken.\n\n" },
          { type: "text", delta: "## The central change\n\nNow it works.\n\n" },
          { type: "text", delta: trailer },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.kind === "reader" && j.state === "done"));
      const root = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => [c.id, c.title])).toEqual([
        ["problem", "The problem"],
        ["central", "The central change"],
        ["g-flow", "Data flow"],
      ]);
      expect(JSON.stringify(root.cards)).not.toMatch(/I'll start|Two notes/);
    } finally {
      await app.close();
    }
  });

  it("an untitled first card is kept when only one titled card follows", async () => {
    const agents = new FakeAgentRunner([
      {
        match: "Reader",
        events: [
          { type: "text", delta: "It was broken.\n\n## The central change\n\nNow it works.\n\n```json\n{}\n```\n" },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.kind === "reader" && j.state === "done"));
      const root = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!;
      expect(root.cards.map((c) => [c.id, c.title])).toEqual([
        ["problem", null],
        ["central", "The central change"],
      ]);
    } finally {
      await app.close();
    }
  });

  it("several bad citations → exactly one repair turn", async () => {
    let prompts = 0;
    const bad = `First [[diff:a-py:99-100]] and second [[diff:a-py:101-102]].\n\n\`\`\`json\n{}\n\`\`\`\n`;
    const good = `Fixed [[diff:a-py:1-2]].\n\n\`\`\`json\n{}\n\`\`\`\n`;
    const agents = new FakeAgentRunner();
    const origPrompt = agents.prompt.bind(agents);
    void origPrompt;
    agents.prompt = async function* (session, text, signal) {
      void signal;
      prompts += 1;
      void session;
      void text;
      if (prompts === 1) {
        yield { type: "text", delta: bad };
        yield { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 5 };
        yield { type: "done", stopReason: "end_turn" };
      } else {
        yield { type: "text", delta: good };
        yield { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 5 };
        yield { type: "done", stopReason: "end_turn" };
      }
    };
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      const res = await ctx.pipeline.runSmall({
        reviewId: id,
        kind: "hunk-pass",
        template: "hunk_pass",
        variables: { hunk: "### [[h:a-py:h111]] a.py\n@@ -1,2 +1,3 @@\n x", path: "a.py" },
        priority: JOB_PRIORITY.background,
      });
      expect(res.repaired).toBe(true);
      expect(prompts).toBe(2);
      expect(res.validation.unverified).toBeLessThan(2);
    } finally {
      await app.close();
    }
  });

  it("retryable error → back-off → success", async () => {
    let calls = 0;
    const agents = new FakeAgentRunner();
    agents.prompt = async function* (session, text, signal) {
      void session; void text; void signal;
      calls += 1;
      if (calls === 1) {
        yield { type: "error", message: "rate limited", retryable: true };
      } else {
        yield { type: "text", delta: "Ok [[diff:a-py:1-2]]\n\n```json\n{}\n```\n" };
        yield { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 };
        yield { type: "done", stopReason: "end_turn" };
      }
    };
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      const res = await ctx.pipeline.runSmall({
        reviewId: id,
        kind: "hunk-pass",
        template: "hunk_pass",
        variables: { hunk: "h", path: "a.py" },
        priority: JOB_PRIORITY.background,
      });
      expect(calls).toBe(2);
      expect(res.text).toContain("Ok");
    } finally {
      await app.close();
    }
  });

  it("cancel mid-reader marks the job cancelled", async () => {
    const big = "## T\n\n" + "word ".repeat(500) + "\n\n```json\n{}\n```\n";
    const agents = new FakeAgentRunner();
    agents.prompt = async function* (s, t, signal) {
      void s; void t;
      for (const word of big.split(" ")) {
        if (signal?.aborted) {
          yield { type: "error", message: "aborted", retryable: true };
          return;
        }
        yield { type: "text", delta: `${word} ` };
        await new Promise((r) => setTimeout(r, 2));
      }
      yield { type: "done", stopReason: "end_turn" };
    };
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      await ctx.pipeline.startReview(id);
      await new Promise((r) => setTimeout(r, 30));
      const reader = ctx.jobs.listByReview(id).find((j) => j.kind === "reader")!;
      expect(reader).toBeDefined();
      ctx.jobs.cancel(reader.id);
      await ctx.jobs.drain(5000).catch(() => {});
      expect(ctx.jobs.get(reader.id)?.state).toBe("cancelled");
    } finally {
      await app.close();
    }
  });

  it("restart mid-pipeline then resume re-enqueues missing stages", async () => {
    const { app, ctx } = await createApp("tok", { agents: replay(), autoPipeline: false });
    try {
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      // Simulate a restart: pipeline started, then stages reset to pending.
      await ctx.pipeline.startReview(id);
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.kind === "reader" && j.state === "done"), 30000);
      // Crash lost the reader's done marker (the completed job row is
      // history; the stage no longer reads done): resume must name the
      // missing stage and enqueue a job for it.
      await ctx.reviews.mutate(id, (draft) => {
        if (draft.pipeline) draft.pipeline.stages.reader = "pending";
      });
      const resumed = await app.inject({ method: "POST", url: `/api/reviews/${id}/resume`, headers: authed });
      expect(resumed.statusCode).toBe(200);
      const body = resumed.json() as { resumed: boolean; jobIds: string[]; pendingStages: string[] };
      expect(body.resumed).toBe(true);
      expect(body.pendingStages).toContain("reader");
      expect(body.jobIds.length).toBeGreaterThan(0);
      const reenqueued = body.jobIds.map((jobId) => ctx.jobs.get(jobId)?.kind);
      expect(reenqueued).toContain("reader");
    } finally {
      await app.close();
    }
  }, 60000);

  it("a hunk cited by the guide is never hidden", async () => {
    const agents = new FakeAgentRunner([
      {
        match: "Hunk pass",
        events: [
          { type: "text", delta: "Summary [[diff:a-py:1-2]]\n\n```json\n{\"hunk\": {\"summary\": \"S\", \"hiddenReason\": \"imports\"}}\n```\n" },
          { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      // Guide cites the hunk: central card with a diff citation.
      await ctx.reviews.mutate(id, (draft) => {
        draft.pages[0].cards.push({
          id: "central",
          pageId: "root",
          title: "Central",
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          blocks: [{ type: "paragraph", id: "b1", text: { standard: "Does [[diff:a-py:1-2]]" }, citations: [{ target: "diff:a-py:1-2" }] }],
          undoStack: [],
        });
      });
      const job = await ctx.pipeline.summarizeHunk(id, "h111");
      await ctx.jobs.drain(5000);
      expect(ctx.jobs.get(job.id)?.state).toBe("done");
      const snap = ctx.reviews.getSnapshot(id)!;
      const hunk = snap.files[0].hunks[0];
      expect(hunk.hiddenReason).toBeUndefined();
      expect(snap.hunkStates.find((s) => s.contentHash === "h111")?.summary).toBe("S");
    } finally {
      await app.close();
    }
  });

  it("jobs use the live default models, not the stored static ids (issue #88)", async () => {
    // No haiku-5-5 offered: the live small default is gpt-6-luna on Codex.
    // The stored static pick (claude-haiku-5-5) must not be used.
    const norm = (id: string): { id: string } => ({ id });
    const live = { claude: ["claude-haiku-4-5"], codex: ["gpt-6-luna", "gpt-5.6-luna"] };
    const models: ModelCatalog = {
      listModels: (p: string) => Promise.resolve((live[p as keyof typeof live] ?? []).map(norm)),
      offered: (p: string) =>
        Promise.resolve({ models: (live[p as keyof typeof live] ?? []).map(norm), defaultId: null }),
    };
    const { app, ctx } = await demoApp(new FakeAgentRunner([]), models);
    try {
      const id = await makeDemoReview(ctx);
      const job = await ctx.pipeline.summarizeHunk(id, "h111");
      if (!("id" in job)) throw new Error("expected a job");
      expect(job.provider).toBe("codex");
      expect(job.model).toBe("gpt-6-luna");
    } finally {
      await app.close();
    }
  });

  it("fork unavailable → fresh-session fallback still succeeds", async () => {
    const agents = new FakeAgentRunner([
      { match: "ready", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      {
        match: "Go deeper",
        events: [{ type: "text", delta: "Body [[diff:a-py:1-2]]\n\n```json\n{\"title\": \"T\"}\n```\n" }, { type: "done", stopReason: "end_turn" }],
      },
    ]);
    // Remove fork capability (PRD §6 fallback path).
    (agents as unknown as { fork?: unknown }).fork = undefined;
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      const res = await ctx.pipeline.runInFork({
        reviewId: id,
        kind: "go-deeper",
        template: "go_deeper",
        variables: { direction: "D\nW" },
        priority: JOB_PRIORITY.userRequested,
      });
      expect(res.viaFork).toBe(false);
      expect(res.cards.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("toy consumer uses runInFork + runSmall (the documented seam)", async () => {
    const seen: string[] = [];
    const agents = new FakeAgentRunner([
      { match: "ready", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      {
        match: "Go deeper",
        events: [{ type: "text", delta: "Toy body [[diff:a-py:1-2]]\n\n```json\n{\"title\": \"Toy\"}\n```\n" }, { type: "done", stopReason: "end_turn" }],
      },
      {
        match: "Hunk pass",
        events: [{ type: "text", delta: "Toy summary\n\n```json\n{\"hunk\": {\"summary\": \"Toy summary\", \"hiddenReason\": null}}\n```\n" }, { type: "done", stopReason: "end_turn" }],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      const forked = await ctx.pipeline.runInFork({
        reviewId: id,
        kind: "go-deeper",
        template: "go_deeper",
        variables: { direction: "Toy direction\nWhy" },
        priority: JOB_PRIORITY.userRequested,
        onPartial: async (cards) => {
          seen.push(`partial:${cards.length}`);
        },
      });
      expect(forked.cards.length).toBeGreaterThan(0);
      expect(forked.data?.["title"]).toBe("Toy");
      const small = await ctx.pipeline.runSmall({
        reviewId: id,
        kind: "hunk-pass",
        template: "hunk_pass",
        variables: { hunk: "h", path: "a.py" },
        priority: JOB_PRIORITY.background,
      });
      expect(small.data?.["hunk"]).toMatchObject({ summary: "Toy summary" });
      expect(textOf).toBeDefined();
    } finally {
      await app.close();
    }
  });
});

describe("reader pinned code (#37)", () => {
  it(
    "a pin through the MCP pin tool persists excerpt text and L1b shows it",
    async () => {
      const fileBody = "x = 1\ny = 2\nz = 3\nw = 4\n";
      const commands = new FakeCommandRunner();
      commands.enqueue({
        cmd: "git",
        args: ["show", `${HEAD_SHA}:a.py`],
        stdout: fileBody,
        stderr: "",
        code: 0,
      });
      const agents = new FakeAgentRunner();
      const readerReply =
        "## Problem\n\nBody cites [[diff:a-py:1-2]].\n\n```json\n{}\n```\n";
      let base = "";
      let issued: IssuedSession | null = null;
      let pinIssued = false;
      const origPrompt = agents.prompt.bind(agents);
      agents.prompt = async function* (session, text) {
        // Reader turn (or its citation-repair follow-up): answer with a
        // minimal valid reply. Mid-turn the agent pins code through MCP,
        // exactly as a live reader session would.
        if (text.includes("Reader") || text.startsWith("Some citations")) {
          if (!pinIssued) {
            pinIssued = true;
            const client = new Client({ name: "t", version: "0" });
            await client.connect(
              new StreamableHTTPClientTransport(new URL(base + issued!.path)),
            );
            try {
              const res = (await client.callTool({
                name: "pin_context",
                arguments: { path: "a.py", lines: "2-3", why: "core lines" },
              })) as { isError?: boolean };
              if (res.isError) throw new Error("pin_context was refused");
            } finally {
              await client.close();
            }
          }
          yield { type: "text", delta: readerReply };
          yield { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 5 };
          yield { type: "done", stopReason: "end_turn" };
          return;
        }
        yield* origPrompt(session, text);
      };

      const { app, ctx } = await createApp("tok", {
        runner: commands,
        agents: agents as unknown as never,
        autoPipeline: false,
      });
      try {
        // Review rows without ingest (same shape as m6-helpers setupReview).
        const repo = repoRow();
        ctx.repos.upsert(repo);
        const reviewId = "rv_pin37";
        const version = versionRow();
        const review: Review = {
          id: reviewId,
          repoId: repo.id,
          branch: "feature",
          prNumber: 7,
          versions: [version],
          currentVersion: 1,
          createdAt: 1,
        };
        const files = [sourceFile()];
        const description = descriptionFor("First para.\n");
        writeReviewRows(ctx.db, repo.id, {
          review,
          version,
          files,
          description,
          worktreePath: os.tmpdir(),
        });
        ctx.reviews.putSnapshot(reviewId, {
          review,
          version,
          files,
          description,
          pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
          annotations: [],
          hunkStates: [],
          jobs: [],
          contributions: [],
          logTail: [],
          rev: 1,
        });

        await app.listen({ host: "127.0.0.1", port: 0 });
        base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
        issued = ctx.mcp.issueSession(reviewId, "sess-reader", "reader");

        await ctx.pipeline.startReview(reviewId);
        await ctx.jobs.drain(15000).catch(() => {});

        const readerJobs = ctx.jobs.listByReview(reviewId).filter((j) => j.kind === "reader");
        expect(readerJobs.length).toBeGreaterThan(0);
        expect(readerJobs[0].state).toBe("done");

        // The persisted pin carries the excerpt text at the version head…
        const snap = ctx.reviews.getSnapshot(reviewId)!;
        expect(snap.pinnedCode).toHaveLength(1);
        expect(snap.pinnedCode![0]).toMatchObject({
          path: "a.py",
          start: 2,
          end: 3,
          sha: HEAD_SHA,
          text: "y = 2\nz = 3",
          language: "python",
        });
        // …resolved through the injectable command runner (no real git)…
        expect(
          commands.calls.some(
            (c) => c.cmd === "git" && c.opts.args.join(" ") === `show ${HEAD_SHA}:a.py`,
          ),
        ).toBe(true);
        // …and the base pack built afterwards shows it in L1b.
        const pack = buildBasePack(toPromptSnapshot(snap), "L0 instructions");
        expect(pack.l1b).toContain("y = 2\nz = 3");
        expect(pack.l1b).toContain("```python");
        expect(pack.l1b).toContain("code:a.py:2-3@");
      } finally {
        await app.close();
      }
    },
    30000,
  );
  it(
    "re-pinning an empty-text range refills it; ranged with text are left alone",
    async () => {
      const fileBody = "x = 1\ny = 2\nz = 3\nw = 4\n";
      const commands = new FakeCommandRunner();
      // One `git show` per pin (same file, resolved per range).
      for (let i = 0; i < 2; i++) {
        commands.enqueue({
          cmd: "git",
          args: ["show", `${HEAD_SHA}:a.py`],
          stdout: fileBody,
          stderr: "",
          code: 0,
        });
      }
      const agents = new FakeAgentRunner();
      const readerReply =
        "## Problem\n\nBody cites [[diff:a-py:1-2]].\n\n```json\n{}\n```\n";
      let base = "";
      let issued: IssuedSession | null = null;
      let pinIssued = false;
      const origPrompt = agents.prompt.bind(agents);
      agents.prompt = async function* (session, text) {
        if (text.includes("Reader") || text.startsWith("Some citations")) {
          if (!pinIssued) {
            pinIssued = true;
            const client = new Client({ name: "t", version: "0" });
            await client.connect(
              new StreamableHTTPClientTransport(new URL(base + issued!.path)),
            );
            try {
              for (const lines of ["2-3", "1-1"]) {
                const res = (await client.callTool({
                  name: "pin_context",
                  arguments: { path: "a.py", lines, why: "re-pin" },
                })) as { isError?: boolean };
                if (res.isError) throw new Error("pin_context was refused");
              }
            } finally {
              await client.close();
            }
          }
          yield { type: "text", delta: readerReply };
          yield { type: "usage", inputTokens: 10, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 5 };
          yield { type: "done", stopReason: "end_turn" };
          return;
        }
        yield* origPrompt(session, text);
      };

      const { app, ctx } = await createApp("tok", {
        runner: commands,
        agents: agents as unknown as never,
        autoPipeline: false,
      });
      try {
        const repo = repoRow();
        ctx.repos.upsert(repo);
        const reviewId = "rv_pin37_refill";
        const version = versionRow();
        const review: Review = {
          id: reviewId,
          repoId: repo.id,
          branch: "feature",
          prNumber: 7,
          versions: [version],
          currentVersion: 1,
          createdAt: 1,
        };
        const files = [sourceFile()];
        const description = descriptionFor("First para.\n");
        writeReviewRows(ctx.db, repo.id, {
          review,
          version,
          files,
          description,
          worktreePath: os.tmpdir(),
        });
        ctx.reviews.putSnapshot(reviewId, {
          review,
          version,
          files,
          description,
          pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
          annotations: [],
          hunkStates: [],
          jobs: [],
          contributions: [],
          logTail: [],
          rev: 1,
        });
        // Seed: an empty-text pin (stale remap fields included) plus a
        // pin on another range that already has text.
        await ctx.reviews.mutate(reviewId, (draft) => {
          draft.pinnedCode = [
            {
              path: "a.py",
              start: 2,
              end: 3,
              sha: "0".repeat(40),
              text: "",
              language: "python",
              needsRepining: true,
              remappedSha: "0".repeat(40),
              remappedStart: 9,
              remappedEnd: 9,
            },
            {
              path: "a.py",
              start: 1,
              end: 1,
              sha: "0".repeat(40),
              text: "STALE",
              language: "python",
            },
          ];
        });

        await app.listen({ host: "127.0.0.1", port: 0 });
        base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
        issued = ctx.mcp.issueSession(reviewId, "sess-reader", "reader");

        await ctx.pipeline.startReview(reviewId);
        await ctx.jobs.drain(15000).catch(() => {});

        const snap = ctx.reviews.getSnapshot(reviewId)!;
        expect(snap.pinnedCode).toHaveLength(2);
        // The empty entry was refilled in place: text, current head sha,
        // flags cleared — and no duplicate row.
        const refilled = snap.pinnedCode!.find((p) => p.start === 2)!;
        expect(refilled.text).toBe("y = 2\nz = 3");
        expect(refilled.sha).toBe(HEAD_SHA);
        expect(refilled.language).toBe("python");
        expect(refilled.needsRepining).toBeUndefined();
        expect(refilled.remappedSha).toBeUndefined();
        expect(refilled.remappedStart).toBeUndefined();
        expect(refilled.remappedEnd).toBeUndefined();
        // The entry that already had text is left alone.
        const kept = snap.pinnedCode!.find((p) => p.start === 1)!;
        expect(kept.text).toBe("STALE");
        expect(kept.sha).toBe("0".repeat(40));
        // L1b renders the refilled code, not the "unavailable" line.
        const pack = buildBasePack(toPromptSnapshot(snap), "L0 instructions");
        expect(pack.l1b).toContain("y = 2\nz = 3");
        expect(pack.l1b).not.toContain("unavailable");
      } finally {
        await app.close();
      }
    },
    30000,
  );
});
