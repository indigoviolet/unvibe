/**
 * #122 click-path waits: ordering tests with the fake runner.
 *
 * - 122.1: runInFork enqueues before the base is ready (the click gets its
 *   job id at once); the base rebuild starts in the background when the
 *   guide changes (warmBase after a go-deeper fill).
 */
import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, Job, ReviewSnapshot } from "@unvibe/shared";
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
    ingest: { status: "ready" },
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
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
          { type: "usage", inputTokens: 10, cachedReadTokens: 90, cachedWriteTokens: 0, outputTokens: 5 },
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
          kind: "ask",
          template: "ask",
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
        kind: "ask",
        template: "ask",
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

describe("#123 hunk pass starts at ingest", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  it("hunk summaries land before the reader finishes; a hide the guide contradicts is undone", async () => {
    const agents = new FakeAgentRunner([
      {
        match: "Hunk pass",
        events: [
          { type: "text", delta: 'Other summary\n\n```json\n{"hunk": {"summary": "S", "hiddenReason": "imports"}}\n```\n' },
          { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
      {
        match: "Reader task",
        events: [
          { type: "text", delta: "## T\n\nBody [[h:a-py:h222]].\n\n```json\n{}\n```\n" },
          { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
          { type: "done", stopReason: "end_turn" },
        ],
      },
    ]);
    // Block the reader turn until the hunk jobs have settled.
    let readerRelease!: () => void;
    const readerGate = new Promise<void>((r) => {
      readerRelease = r;
    });
    let readerGated = true;
    const origPrompt = agents.prompt.bind(agents);
    agents.prompt = async function* (session, text, signal) {
      if (readerGated && text.includes("Reader task")) await readerGate;
      yield* origPrompt(session, text, signal);
    };
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeDemoReview(ctx);
      // A second, multi-line hunk (hideable, unlike one-line h111).
      await ctx.reviews.mutate(id, (draft) => {
        const f = draft.files.find((x) => x.fileKey === "a-py")!;
        f.hunks.push({
          contentHash: "h222",
          header: "@@ -10,3 +10,4 @@",
          newStart: 10,
          newEnd: 13,
          oldStart: 10,
          oldEnd: 12,
          added: 2,
          removed: 1,
          lines: [
            { kind: "ctx", oldLine: 10, newLine: 10, text: "a = 1" },
            { kind: "del", oldLine: 11, text: "b = 2" },
            { kind: "add", newLine: 11, text: "b = 3" },
            { kind: "add", newLine: 12, text: "c = 4" },
            { kind: "ctx", oldLine: 12, newLine: 13, text: "d = 5" },
          ],
        });
      });

      await ctx.pipeline.startReview(id);
      // Both hunk summaries settle while the reader is still blocked: the
      // pass started at ingest, not after the reader.
      await waitFor(
        () => ctx.jobs.listByReview(id).filter((j) => j.kind === "hunk-pass" && j.state === "done").length === 2,
        8000,
      );
      expect(ctx.jobs.listByReview(id).find((j) => j.kind === "reader")?.state).toBe("running");
      // No guide yet, so the multi-line hunk hid as uninteresting.
      expect(ctx.reviews.getSnapshot(id)!.files.flatMap((f) => f.hunks).find((h) => h.contentHash === "h222")?.hiddenReason).toBe(
        "imports",
      );

      readerGated = false;
      readerRelease();
      await ctx.jobs.drain(15000);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.filter((h) => h.summary).length).toBe(2);
      // The guide cites h222 now: the early hide is undone.
      expect(snap.files.flatMap((f) => f.hunks).find((h) => h.contentHash === "h222")?.hiddenReason).toBeUndefined();
      expect(ctx.jobs.listByReview(id).find((j) => j.kind === "reader")?.state).toBe("done");
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
          { type: "usage", inputTokens: 10, cachedReadTokens: 90, cachedWriteTokens: 0, outputTokens: 5 },
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
        kind: "ask",
        template: "ask",
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
          { type: "usage", inputTokens: 10, cachedReadTokens: 90, cachedWriteTokens: 0, outputTokens: 5 },
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

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

/** Fake `d2`: version ok, rejects inline `{.class`, renders the rest. */
function writeSmartD2(): { dir: string; bin: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-smartd2-"));
  const bin = path.join(dir, "d2");
  fs.writeFileSync(
    bin,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "d2 v0.9.0"; exit 0; fi\n' +
      'src=$(cat)\ncase "$src" in\n"{.class"*|*"{.class"*) echo "err: bad class" >&2; exit 1;;\n' +
      "esac\n" +
      'if [ "$1" = "validate" ]; then echo "Success!"; exit 0; fi\n' +
      'echo \'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text>ok</text></svg>\'\nexit 0\n',
  );
  fs.chmodSync(bin, 0o755);
  return { dir, bin };
}

const GODEEPER_BROKEN = `Deep body.

\`\`\`d2
direction: right
gone: "unmount cleanup" {.class: [bad]}
start -> gone: finish
\`\`\`

\`\`\`json
{"title": "Deep"}
\`\`\`
`;

const GODEEPER_FIXED = `Deep body.

\`\`\`d2
direction: right
gone: "unmount cleanup"
gone.class: [bad]
start -> gone: finish
\`\`\`

\`\`\`json
{"title": "Deep"}
\`\`\`
`;

const GODEEPER_NO_DIAGRAM = `Deep body, no diagram this time.

\`\`\`json
{"title": "Deep"}
\`\`\`
`;

describe("go-deeper inline diagrams (#130)", () => {
  it("a bad diagram gets exactly one repair turn and lands drawn", { timeout: 60000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const runners = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(GODEEPER_FIXED) },
        { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
        { match: "Go deeper", events: textEvents(GODEEPER_BROKEN) },
      ]);
      const { app, ctx } = await demoApp(runners);
      try {
        const id = await makeDemoReview(ctx);
        await ctx.reviews.mutate(id, (draft) => {
          const root = draft.pages.find((p) => p.id === "root")!;
          root.cards.push({
            id: "g-1",
            pageId: "root",
            title: null,
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [],
            undoStack: [],
            pending: { label: "Deeper", why: "because" },
          });
        });
        await ctx.pipeline.fillGoDeeper(id, "g-1", undefined, () => {});
        // Exactly one repair turn, no loop.
        expect(runners.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const card = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-1")!;
        expect(card.title).toBe("Deep");
        const dg = card.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { status: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.status).toBe("ok");
        expect(dg.source).toContain("gone.class: [bad]");
        // The prose is unaffected.
        expect(JSON.stringify(card.blocks)).toContain("Deep body.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unrepairable diagram keeps an error block and the prose", { timeout: 60000 }, async () => {
    const { dir, bin } = writeSmartD2();
    const prev = process.env.UNVIBE_D2_BIN;
    process.env.UNVIBE_D2_BIN = bin;
    try {
      const runners = new FakeAgentRunner([
        { match: "failed validation", events: textEvents(GODEEPER_NO_DIAGRAM) },
        { match: "reply with exactly", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
        { match: "Go deeper", events: textEvents(GODEEPER_BROKEN) },
      ]);
      const { app, ctx } = await demoApp(runners);
      try {
        const id = await makeDemoReview(ctx);
        await ctx.reviews.mutate(id, (draft) => {
          const root = draft.pages.find((p) => p.id === "root")!;
          root.cards.push({
            id: "g-1",
            pageId: "root",
            title: null,
            level: "standard",
            collapsed: false,
            revision: 1,
            blocks: [],
            undoStack: [],
            pending: { label: "Deeper", why: "because" },
          });
        });
        await ctx.pipeline.fillGoDeeper(id, "g-1", undefined, () => {});
        // Exactly one repair turn even when it fails.
        expect(runners.prompts.filter((p) => p.text.includes("failed validation"))).toHaveLength(1);
        const card = ctx.reviews.getSnapshot(id)!.pages.find((p) => p.id === "root")!.cards.find((c) => c.id === "g-1")!;
        const dg = card.blocks.find((b) => b.type === "diagram") as unknown as {
          source: string;
          render?: { status: string; error?: string };
        };
        expect(dg).toBeDefined();
        expect(dg.render?.status).toBe("error");
        expect(dg.render?.error).toMatch(/not valid D2/);
        expect(JSON.stringify(card.blocks)).toContain("Deep body.");
      } finally {
        await app.close();
      }
    } finally {
      if (prev === undefined) delete process.env.UNVIBE_D2_BIN;
      else process.env.UNVIBE_D2_BIN = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
