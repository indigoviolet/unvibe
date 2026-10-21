/**
 * Issue #99: a hunk summary in the diff pane shows the agent's raw JSON,
 * cut off at 140 characters. The small-model hunk reply sometimes carries
 * the `{"hunk": …}` object bare (no Markdown line, no fence); both hunk
 * call sites then fell back to the first raw line sliced at 140 chars and
 * lost `hiddenReason` too.
 *
 * These tests drive `summarizeHunk` (on-demand) and the `hunk-pass`
 * background stage with the scripted fake runner, one reply shape at a
 * time, and assert the stored summary / hiddenReason.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const SUMMARY = "Maps the widget to the new label via overrides.";
const HIDDEN = "import-only change";

function bareJson(summary: string, hidden: string | null): string {
  return `{"hunk": {"summary": ${JSON.stringify(summary)}, "hiddenReason": ${hidden === null ? "null" : JSON.stringify(hidden)}}}`;
}

/** Reply shapes: canonical, fenced-only, bare, bare+Markdown, bare+trailing. */
const SHAPES: { name: string; reply: string }[] = [
  { name: "canonical md line + fenced json", reply: `${SUMMARY}\n\n\`\`\`json\n${bareJson(SUMMARY, HIDDEN)}\n\`\`\`\n` },
  { name: "fenced json, no md line", reply: `\`\`\`json\n${bareJson(SUMMARY, HIDDEN)}\n\`\`\`\n` },
  { name: "bare json, no fence, no md line", reply: bareJson(SUMMARY, HIDDEN) },
  { name: "bare json after md line, no fence", reply: `${SUMMARY}\n${bareJson(SUMMARY, HIDDEN)}` },
  { name: "bare json with trailing prose", reply: `${bareJson(SUMMARY, HIDDEN)}\nHope this helps!\n` },
  { name: "fenced json with trailing prose", reply: `${SUMMARY}\n\n\`\`\`json\n${bareJson(SUMMARY, HIDDEN)}\n\`\`\`\nThanks!\n` },
];

async function demoApp(agents: FakeAgentRunner): Promise<ReturnType<typeof createApp>> {
  return createApp("tok", { agents: agents as unknown as never, autoPipeline: false });
}

async function waitForSummary(
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  id: string,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (ctx.reviews.getSnapshot(id)?.hunkStates.some((s) => s.summary !== undefined)) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitForSummary: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function makeReview(ctx: Awaited<ReturnType<typeof createApp>>["ctx"]): Promise<string> {
  const id = `rv_h99${Math.random().toString(36).slice(2, 8)}`;
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
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [
      {
        fileKey: "a-py",
        path: "a.py",
        category: "source",
        hunks: [
          {
            // Multi-line hunk: the one-line-change guard does not force
            // hiddenReason to null here, so recovery is observable.
            contentHash: "h222",
            header: "@@ -1,4 +1,5 @@",
            newStart: 1,
            newEnd: 5,
            oldStart: 1,
            oldEnd: 4,
            added: 2,
            removed: 1,
            lines: [
              { kind: "ctx", oldLine: 1, newLine: 1, text: "x = 1" },
              { kind: "del", oldLine: 2, text: "y = 1" },
              { kind: "add", newLine: 2, text: "y = 2" },
              { kind: "add", newLine: 3, text: "z = 3" },
              { kind: "ctx", oldLine: 3, newLine: 4, text: "w = 4" },
            ],
          },
        ],
      },
    ],
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
  ctx.reviews.putSnapshot(id, snap);
  return id;
}

async function summarizeWith(
  reply: string,
  seed?: { summary?: string },
): Promise<{ summary: string | undefined; hiddenReason: string | undefined; reused: boolean; prompts: number }> {
  const agents = new FakeAgentRunner([{ match: "Hunk pass", events: textEvents(reply) }]);
  const { app, ctx } = await demoApp(agents);
  try {
    const id = await makeReview(ctx);
    if (seed?.summary !== undefined) {
      await ctx.reviews.mutate(id, (draft) => {
        draft.hunkStates.push({ contentHash: "h222", folded: false, reviewed: false, summary: seed.summary });
      });
    }
    const res = await ctx.pipeline.summarizeHunk(id, "h222");
    const reused = "reused" in res;
    if (!reused) await ctx.jobs.drain(5000);
    const snap = ctx.reviews.getSnapshot(id)!;
    return {
      summary: snap.hunkStates.find((s) => s.contentHash === "h222")?.summary,
      hiddenReason: snap.files[0].hunks[0].hiddenReason,
      reused,
      prompts: agents.prompts.length,
    };
  } finally {
    await app.close();
  }
}

describe("hunk summarize reply shapes (#99, on-demand site)", () => {
  for (const shape of SHAPES) {
    it(`recovers summary + hiddenReason: ${shape.name}`, async () => {
      const got = await summarizeWith(shape.reply);
      expect(got.reused).toBe(false);
      expect(got.summary).toBe(SUMMARY);
      expect(got.hiddenReason).toBe(HIDDEN);
    });
  }

  it("markdown line only (no JSON): falls back to the line as plain text", async () => {
    const got = await summarizeWith(`${SUMMARY}\n`);
    expect(got.summary).toBe(SUMMARY);
    expect(got.hiddenReason).toBeUndefined();
  });

  it("long markdown-only line: cuts on a word boundary with an ellipsis, never mid-word", async () => {
    const long = `${"word ".repeat(40).trim()} tail`;
    expect(long.length).toBeGreaterThan(140);
    const got = await summarizeWith(`${long}\n`);
    expect(got.summary).toBeDefined();
    expect(got.summary!.length).toBeLessThanOrEqual(141);
    expect(got.summary!.endsWith("…")).toBe(true);
    // The char after the cut point in the source is mid-word-safe: the
    // stored text minus the ellipsis is a prefix ending at a space.
    const prefix = got.summary!.slice(0, -1);
    expect(long.startsWith(prefix)).toBe(true);
    expect(long[prefix.length]).toBe(" ");
  });

  it("long JSON summary is kept whole, never cut", async () => {
    const long = `Adds ${"very ".repeat(40)}long handling.`;
    expect(long.length).toBeGreaterThan(140);
    const got = await summarizeWith(bareJson(long, null));
    expect(got.summary).toBe(long);
  });

  it("truncated JSON (genuinely no parse): stores no summary, job still succeeds", async () => {
    const truncated = `{"hunk": {"summary": "Adds a retry around the upload call and logs each atte`;
    const got = await summarizeWith(truncated);
    expect(got.summary).toBeUndefined();
    expect(got.hiddenReason).toBeUndefined();
  });

  it("stored good summary still reuses with no agent call", async () => {
    const got = await summarizeWith(bareJson("SHOULD NOT BE USED", null), { summary: SUMMARY });
    expect(got.reused).toBe(true);
    expect(got.prompts).toBe(0);
    expect(got.summary).toBe(SUMMARY);
  });
});

describe("hunk job turn timings (#210, #194)", () => {
  it("hunk-pass job records session-start and first-turn timings", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: textEvents(bareJson(SUMMARY, HIDDEN)) }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeReview(ctx);
      await ctx.reviews.mutate(id, (draft) => {
        draft.pipeline = {
          stages: {
            reader: "done",
            base: "done",
            critic: "done",
            "hunk-pass": "pending",
            "go-deeper": "pending",
          },
        };
      });
      const resumed = await ctx.pipeline.resumeReview(id);
      expect(resumed.jobIds.length).toBeGreaterThan(0);
      await ctx.jobs.drain(15000);
      const job = ctx.jobs.listByReview(id).find((j) => j.kind === "hunk-pass");
      expect(job).toBeDefined();
      expect(job!.state).toBe("done");
      expect((job!.turns ?? []).map((t) => t.label)).toEqual(["session start", "first"]);
      for (const turn of job!.turns ?? []) {
        expect(turn.finishedAt).toBeDefined();
        expect(turn.finishedAt!).toBeGreaterThanOrEqual(turn.startedAt);
      }
    } finally {
      await app.close();
    }
  });

  it("on-demand summarize job records the same turn timings", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: textEvents(bareJson(SUMMARY, HIDDEN)) }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeReview(ctx);
      const res = await ctx.pipeline.summarizeHunk(id, "h222");
      expect("reused" in res).toBe(false);
      await ctx.jobs.drain(5000);
      const job = ctx.jobs.listByReview(id).find((j) => j.kind === "summarize");
      expect(job).toBeDefined();
      expect(job!.state).toBe("done");
      expect((job!.turns ?? []).map((t) => t.label)).toEqual(["session start", "first"]);
      for (const turn of job!.turns ?? []) {
        expect(turn.finishedAt).toBeDefined();
        expect(turn.finishedAt!).toBeGreaterThanOrEqual(turn.startedAt);
      }
    } finally {
      await app.close();
    }
  });

  it("session-start usage lands on the session-start turn, never folded into the first turn (#209)", async () => {
    // The fake runner reports no session-start usage, so the session-start
    // turn stays without token counts while the first turn carries exactly
    // the one reported usage event — no double counting anywhere. (With a
    // real Claude runner the session-start turn carries the warm-up usage
    // instead; see the acp-runner session-start test.)
    const event = { inputTokens: 5, cachedReadTokens: 100, cachedWriteTokens: 900, outputTokens: 10 };
    const agents = new FakeAgentRunner([{
      match: "Hunk pass",
      events: [
        { type: "text", delta: bareJson(SUMMARY, null) },
        { type: "usage", ...event },
        { type: "done", stopReason: "end_turn" },
      ],
    }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeReview(ctx);
      const res = await ctx.pipeline.summarizeHunk(id, "h222");
      expect("reused" in res).toBe(false);
      await ctx.jobs.drain(5000);
      const job = ctx.jobs.listByReview(id).find((j) => j.kind === "summarize");
      expect(job).toBeDefined();
      expect(job!.state).toBe("done");
      const full = ctx.jobs.get(job!.id);
      const records = full?.turnRecords ?? [];
      expect(records.map((t) => t.label)).toEqual(["session start", "first"]);
      expect(records[0]!.usage).toBeUndefined();
      expect(records[1]!.usage).toEqual(event);
      expect(job!.usage).toEqual(event);
      expect(job!.cacheHitRate).toBeCloseTo(100 / 1005);
    } finally {
      await app.close();
    }
  });
});

describe("hunk-pass background stage (#99)", () => {
  it("bare JSON reply stores summary + hiddenReason on the hunk-pass path", async () => {
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: textEvents(bareJson(SUMMARY, HIDDEN)) }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = await makeReview(ctx);
      // Earlier stages already done: resumeReview enqueues only the
      // hunk-pass jobs (no reader/critic/concepts machinery involved).
      await ctx.reviews.mutate(id, (draft) => {
        draft.pipeline = {
          stages: {
            reader: "done",
            base: "done",
            critic: "done",
            "hunk-pass": "pending",
            "go-deeper": "pending",
          },
        };
      });
      const resumed = await ctx.pipeline.resumeReview(id);
      expect(resumed.jobIds.length).toBeGreaterThan(0);
      await ctx.jobs.drain(15000);
      await waitForSummary(ctx, id);
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(snap.hunkStates.find((s) => s.contentHash === "h222")?.summary).toBe(SUMMARY);
      expect(snap.files[0].hunks[0].hiddenReason).toBe(HIDDEN);
    } finally {
      await app.close();
    }
  });
});

function multiHunkSnapshot(id: string, hashes: string[]): ReviewSnapshot {
  return {
    review: { id, repoId: "demo", branch: "main", versions: [], currentVersion: 1, createdAt: Date.now() },
    version: { n: 1, headSha: "abc1234def5678abc1234def5678abc1234def5", mergeBaseSha: "0000000", baseRef: "main", fetchedAt: Date.now(), idMapping: {} },
    files: [
      {
        fileKey: "a-py",
        path: "a.py",
        category: "source",
        hunks: hashes.map((contentHash, i) => ({
          contentHash,
          header: `@@ -${i + 1},1 +${i + 1},2 @@`,
          newStart: i + 1,
          newEnd: i + 2,
          oldStart: i + 1,
          oldEnd: i + 1,
          added: 1,
          removed: 0,
          lines: [{ kind: "add" as const, newLine: i + 1, text: `line_${contentHash} = ${i}` }],
        })),
      },
    ],
    pages: [{ id: "root", kind: "root", title: "Guide", saved: false, cards: [] }],
    annotations: [],
    hunkStates: [],
    fileStates: [],
    viewPrefs: { showExistingComments: true, existingCommentsCollapsed: false },
    jobs: [],
    contributions: [],
    logTail: [],
    rev: 1,
    ingest: { status: "ready" },
  };
}

describe("hunk-pass session isolation (#209)", () => {
  it("many hunks: each hunk-pass job starts a fresh session with only its own hunk", async () => {
    const hashes = ["hA1", "hB2", "hC3"];
    const agents = new FakeAgentRunner([{ match: "Hunk pass", events: textEvents(bareJson(SUMMARY, null)) }]);
    const { app, ctx } = await demoApp(agents);
    try {
      const id = `rv_h209${Math.random().toString(36).slice(2, 8)}`;
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
      ctx.reviews.putSnapshot(id, multiHunkSnapshot(id, hashes));
      await ctx.reviews.mutate(id, (draft) => {
        draft.pipeline = {
          stages: {
            reader: "done",
            base: "done",
            critic: "done",
            "hunk-pass": "pending",
            "go-deeper": "pending",
          },
        };
      });
      const resumed = await ctx.pipeline.resumeReview(id);
      expect(resumed.jobIds.length).toBe(hashes.length);
      await ctx.jobs.drain(15000);
      const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "hunk-pass");
      expect(jobs).toHaveLength(hashes.length);
      for (const j of jobs) expect(j.state).toBe("done");
      // One fresh session per hunk job: no fork, no pool, no reuse.
      expect(agents.starts.length).toBe(hashes.length);
      // Each session sees exactly one prompt — its own hunk — and never
      // an earlier hunk's turn. No accumulation across jobs.
      for (const sessionId of agents.startCalls.map((s) => s.sessionId)) {
        const seen = agents.prompts.filter((p) => p.sessionId === sessionId);
        expect(seen).toHaveLength(1);
      }
      const byHash = new Map(
        agents.prompts.map((p) => [hashes.find((h) => p.text.includes(`[[h:a-py:${h}]]`)), p] as const),
      );
      expect([...byHash.keys()].sort()).toEqual([...hashes].sort());
      for (const [hash, prompt] of byHash) {
        for (const other of hashes) {
          if (other === hash) continue;
          expect(prompt!.text).not.toContain(`[[h:a-py:${other}]]`);
        }
      }
      // Per-job reads do not grow across jobs: every job reports only
      // its own single usage event.
      for (const j of jobs) {
        expect(j.usage).toEqual({ inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 3 });
      }
      // Sessions close when their job ends: nothing leaks for reuse.
      expect(agents.sessions.size).toBe(0);
    } finally {
      await app.close();
    }
  });
});
