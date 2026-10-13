/**
 * #122 click-path waits: ordering tests with the fake runner.
 *
 * - 122.1: runInFork enqueues before the base is ready (the click gets its
 *   job id at once); the base rebuild starts in the background when the
 *   guide changes (warmBase after a go-deeper fill).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

async function demoApp(agents: FakeAgentRunner): Promise<ReturnType<typeof createApp>> {
  return createApp("tok", {
    agents: agents as unknown as never,
    autoPipeline: false,
  });
}

async function makeDemoReview(ctx: Awaited<ReturnType<typeof createApp>>["ctx"]): Promise<string> {
  const id = `rv_122${Math.random().toString(36).slice(2, 8)}`;
  ctx.db
    .prepare(
      "INSERT INTO repos (id, owner, name, local_path, last_opened) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run("demo", "demo", "urllib3-5020", "/tmp", Date.now());
  ctx.db
    .prepare(
      "INSERT INTO reviews (id, repo_id, branch, pr_number, current_version, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
    )
    .run(id, "demo", "main", null, 1, Date.now(), JSON.stringify({}));
  ctx.db
    .prepare(
      "INSERT INTO versions (review_id, n, head_sha, merge_base_sha, base_ref, fetched_at, id_mapping) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id, n) DO NOTHING",
    )
    .run(id, 1, "abc1234def5678abc1234def5678abc1234def5", "0000000", "main", Date.now(), JSON.stringify({}));
  const snap: ReviewSnapshot = {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: {
      n: 1,
      headSha: "abc1234def5678abc1234def5678abc1234def5",
      mergeBaseSha: "0000000",
      baseRef: "main",
      fetchedAt: Date.now(),
      idMapping: {},
    },
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await sleep(20);
  }
}

const EXPLAIN_VARS = {
  anchor: { quote: "y = 2", block: "y = 2" },
  card: "Alpha body text.",
  thread: "(none)",
  message: "Why?",
} as unknown as Record<string, string>;

const FORK_REPLY =
  `## Answer\n\nBody with citation [[diff:a-py:1-2]].\n\n` +
  '```json\n{"title": "T"}\n```\n';

describe("#122.2 answer before bookkeeping", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("the answer resolves while bookkeeping is still pending; the next job waits; the job stays open", async () => {
    const forkReplyWithContribute =
      `## Answer\n\nBody with citation [[diff:a-py:1-2]].\n\n` +
      "```json\n" +
      JSON.stringify({ title: "T", contribute: { facts: [{ text: "y equals two", citations: ["diff:a-py:2"] }] } }) +
      "\n```\n";
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      {
        match: "",
        events: [
          { type: "text", delta: forkReplyWithContribute },
          { type: "usage", inputTokens: 10, cachedTokens: 90, outputTokens: 5 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      // Seed enough log volume that post-turn growth appends a batch to the
      // base (default batch is 2000 tokens).
      await ctx.reviews.mutate(id, (draft) => {
        for (let i = 0; i < 60; i++) {
          const seq = draft.logTail.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
          draft.logTail.push({
            seq,
            kind: "new-card",
            payload: { summary: `seed entry ${i} ${"x".repeat(300)}` },
            scope: { scope: "global" },
          });
        }
      });
      // Gate the base-growth append: bookkeeping blocks here.
      const origAppend = ctx.sessions.appendLogBatch.bind(ctx.sessions);
      let releaseAppend!: () => void;
      const appendGate = new Promise<void>((r) => {
        releaseAppend = r;
      });
      let appendCalls = 0;
      let appendGated = true;
      ctx.sessions.appendLogBatch = async (key, batch, opts) => {
        appendCalls += 1;
        if (appendGated) await appendGate;
        return origAppend(key, batch, opts);
      };

      let jobA: Job | undefined;
      let aResolved = false;
      const doneA = ctx.pipeline
        .runInFork({
          reviewId: id,
          kind: "explain",
          template: "explain",
          variables: EXPLAIN_VARS,
          priority: JOB_PRIORITY.userRequested,
          conversationKey: "conv-A",
          onJob: (job) => {
            jobA = job;
          },
        })
        .then((r) => {
          aResolved = true;
          return r;
        });
      // A reaches its (gated) bookkeeping…
      await waitFor(() => appendCalls >= 1, 8000);
      await sleep(200);
      // …and the answer is already out, while the job is still open (a crash
      // now leaves it visibly interrupted, never silently unbookkept).
      expect(aResolved).toBe(true);
      expect(jobA).toBeDefined();
      expect(ctx.jobs.get(jobA!.id)?.state).toBe("running");

      // The next job must not fork from the stale log: its turn waits for
      // A's bookkeeping to land.
      const varsB = { ...EXPLAIN_VARS, message: "Bee?" };
      const doneB = ctx.pipeline.runInFork({
        reviewId: id,
        kind: "explain",
        template: "explain",
        variables: varsB,
        priority: JOB_PRIORITY.userRequested,
        conversationKey: "conv-B",
      });
      await sleep(300);
      expect(agents.prompts.some((p) => p.text.includes("Bee?"))).toBe(false);

      appendGated = false;
      releaseAppend();
      const [resA, resB] = await Promise.all([doneA, doneB]);
      expect(resA.text).toContain("Body with citation");
      expect(resB.text).toContain("Body with citation");
      await ctx.jobs.drain(8000);
      expect(ctx.jobs.get(jobA!.id)?.state).toBe("done");
      // Bookkeeping was not lost: the contribution landed.
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.contributions.length).toBeGreaterThan(0);
      expect(agents.prompts.some((p) => p.text.includes("Bee?"))).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("#122.1 enqueue before the base", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("runInFork hands out the job before the base build finishes", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      {
        match: "",
        events: [
          { type: "text", delta: FORK_REPLY },
          { type: "usage", inputTokens: 10, cachedTokens: 90, outputTokens: 5 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    // Gate the first session start (the base build): the job must exist
    // while the base is still blocked.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let gated = true;
    const origStart = agents.start.bind(agents);
    agents.start = async (opts) => {
      if (gated) {
        gated = false;
        await gate;
      }
      return origStart(opts);
    };
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      let seen: Job | undefined;
      const done = ctx.pipeline.runInFork({
        reviewId: id,
        kind: "explain",
        template: "explain",
        variables: EXPLAIN_VARS,
        priority: JOB_PRIORITY.userRequested,
        onJob: (job) => {
          seen = job;
        },
      });
      // The base build is still gated, yet the job id is already out.
      await sleep(200);
      expect(seen).toBeDefined();
      expect(ctx.jobs.get(seen!.id)?.state).not.toBe("done");
      release();
      const res = await done;
      expect(res.text).toContain("Body with citation");
      await ctx.jobs.drain(5000);
      expect(ctx.jobs.get(seen!.id)?.state).toBe("done");
      void authed;
    } finally {
      await app.close();
    }
  });

  it("a go-deeper fill rebuilds the base in the background", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
      {
        match: "Go deeper",
        events: [
          { type: "text", delta: `Deep body [[diff:a-py:1-2]]\n\n\`\`\`json\n{"title": "Deep"}\n\`\`\`\n` },
          { type: "usage", inputTokens: 10, cachedTokens: 90, outputTokens: 5 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      await ctx.reviews.mutate(id, (draft) => {
        const root = draft.pages.find((p) => p.id === "root")!;
        root.cards.push({
          id: "g-1",
          pageId: "root",
          title: null,
          level: "standard",
          read: false,
          collapsed: false,
          revision: 1,
          blocks: [],
          undoStack: [],
          pending: { label: "Deeper", why: "because" },
        });
      });
      const basePacks = (): number =>
        agents.prompts.filter((p) => p.text.includes("Read the base context below")).length;
      await ctx.pipeline.fillGoDeeper(id, "g-1", undefined, () => {});
      expect(basePacks()).toBe(1);
      // The fill changed the guide: a second base build warms in the
      // background without another click.
      await waitFor(() => basePacks() >= 2, 8000);
    } finally {
      await app.close();
    }
  });
});
