/**
 * Issues #143 + #151: session lifecycle and job records.
 *
 * #143: every fork is registered with the session manager, idle sessions
 * are swept in production, and a reply after a restart resumes (load when
 * the runner supports it, rebuild-from-transcript once otherwise) instead
 * of resending the whole thread every turn.
 * #151: fork / small-model repair prompts land on the job's prompt
 * snapshot, and usage counted before an abort/error is kept.
 *
 * All with the fake AgentRunner — never a real agent.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { JOB_PRIORITY } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";
import { openDatabase } from "../src/store/db.js";
import { SessionManager, type BaseKey } from "../src/sessions/manager.js";
import { SessionStore } from "../src/sessions/store.js";
import { ManualClock } from "../src/jobs/clock.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string, usage = { inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 }): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", ...usage },
    { type: "done", stopReason: "end_turn" },
  ];
}

const READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function waitJob(ctx: { jobs: { get(id: string): { state: string } | undefined } }, id: string): Promise<void> {
  await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(id)?.state ?? ""), 60000);
}

function baseScripts(extra: { match: string; events: AgentEvent[] }[] = []): { match: string; events: AgentEvent[] }[] {
  return [
    { match: "Some citations in your previous reply", events: textEvents("Fixed answer.\n\n```json\n{}\n```\n") },
    { match: "Some citations could not be verified", events: textEvents("Fixed summary.\n\n```json\n{\"hunk\": {\"summary\": \"Fixed\", \"hiddenReason\": null}}\n```\n") },
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(READER) },
    ...extra,
  ];
}

async function openDemo(agents: FakeAgentRunner, opts: Record<string, unknown> = {}) {
  const { app, ctx } = await createApp("tok", { agents, ...opts } as never);
  const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  await waitFor(() => (ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length ?? 0) > 0);
  return { app, ctx, id };
}

async function postAction(app: { inject: (o: never) => Promise<{ statusCode: number; json: () => Record<string, unknown> }> }, id: string, body: unknown) {
  const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/actions`, headers: authed, payload: body } as never);
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

const KEY: BaseKey = { reviewId: "r1", reviewVersion: "v1", guideRevision: "g1", provider: "claude", model: "m", access: "lockdown", effort: "" };

describe("session manager restore (#143)", () => {
  it("a restored conversation keeps its posture, so a post-restart reply can load it", async () => {
    const db = openDatabase(":memory:");
    const store = new SessionStore(db);
    const runner = new FakeAgentRunner([
      { match: "BASE PACK", events: textEvents("ready") },
      { match: "hello", events: textEvents("hi") },
    ]);
    const build = { key: KEY, cwd: "/r", systemPrompt: "s", readOnly: true, mcpServers: [], pack: "BASE PACK" };
    const mgr1 = new SessionManager({ runner, store, clock: new ManualClock(1000) });
    const base = await mgr1.getBase(build);
    const conv = await mgr1.forkConversation(base.key, "hello");
    expect(mgr1.conversationAccess(conv.session.id)).toBe(true);

    const mgr2 = new SessionManager({ runner, store, clock: new ManualClock(2000) });
    mgr2.restore();
    // Posture survived the restart: the probe must not treat the session
    // as a mode mismatch and drop it without trying load.
    expect(mgr2.conversationAccess(conv.session.id)).toBe(true);
    const ensured = await mgr2.ensureConversation(conv.session.id);
    expect(ensured).toEqual({ session: expect.objectContaining({ id: conv.session.id }), rebuilt: false });
  });
});

describe("idle sweep never closes a session mid-turn (#143)", () => {
  it("a turn streaming past the threshold survives; after it ends, the threshold runs from the end", async () => {
    const clock = new ManualClock(0);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let started = false;
    class GatedRunner extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (text.includes("long turn")) {
          this.prompts.push({ sessionId: session.id, text });
          started = true;
          await gate;
          yield { type: "text", delta: "long done" };
          yield { type: "done", stopReason: "end_turn" };
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const runner = new GatedRunner([
      { match: "BASE PACK", events: textEvents("ready") },
      { match: "hello", events: textEvents("hi") },
    ]);
    const mgr = new SessionManager({ runner, clock });
    const build = { key: KEY, cwd: "/r", systemPrompt: "s", readOnly: true, mcpServers: [], pack: "BASE PACK" };
    const base = await mgr.getBase(build);
    const conv = await mgr.forkConversation(base.key, "hello");

    const turn = mgr.sendOnConversation(conv.session.id, "long turn");
    await waitFor(() => started);
    // The turn is still streaming long past the idle threshold.
    await clock.advance(10 * 60 * 1000);
    const mid = await mgr.sweepIdle(clock.now(), 5 * 60 * 1000);
    expect(mid.closed).not.toContain(conv.session.id);

    release();
    await turn;
    // Idle runs from when the turn finished, not from when it started.
    await clock.advance(4 * 60 * 1000);
    const afterEnd = await mgr.sweepIdle(clock.now(), 5 * 60 * 1000);
    expect(afterEnd.closed).not.toContain(conv.session.id);
    await clock.advance(2 * 60 * 1000);
    const later = await mgr.sweepIdle(clock.now(), 5 * 60 * 1000);
    expect(later.closed).toContain(conv.session.id);
  });

  it("a long pipeline turn is not swept mid-stream, and is swept after it finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let started = false;
    class LongRunner extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (text.includes("long question")) {
          this.prompts.push({ sessionId: session.id, text });
          started = true;
          yield { type: "text", delta: "partial" };
          await gate;
          yield { type: "text", delta: "Long answer.\n\n```json\n{}\n```\n" };
          yield { type: "usage", inputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 5 };
          yield { type: "done", stopReason: "end_turn" };
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new LongRunner(baseScripts());
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "long question" });
      expect(res.status).toBe(200);
      await waitFor(() => started);
      const card = ctx.reviews.getSnapshot(id)!.annotations.find((a) => (a.replies ?? []).some((t) => t.question === "long question"));
      // Find the session the running job is on from its prompt record.
      const sessionId = agents.prompts.find((p) => p.text.includes("long question"))!.sessionId;
      void card;
      const mid = await ctx.sessions.sweepIdle(Date.now() + 10 * 60 * 1000, 5 * 60 * 1000);
      expect(mid.closed).not.toContain(sessionId);
      expect(agents.sessions.has(sessionId)).toBe(true);
      release();
      await waitJob(ctx, res.json.jobId as string);
      expect(ctx.jobs.get(res.json.jobId as string)?.state).toBe("done");
      const after = await ctx.sessions.sweepIdle(Date.now() + 10 * 60 * 1000, 5 * 60 * 1000);
      expect(after.closed).toContain(sessionId);
    } finally {
      await app.close();
    }
  });
});

describe("fork registration and idle sweep (#143)", () => {
  it("one-shot forks (critic) are registered and swept, not leaked", async () => {
    const agents = new FakeAgentRunner(baseScripts());
    const { app, ctx, id } = await openDemo(agents);
    try {
      await ctx.jobs.drain(10000);
      const criticJobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "critic");
      expect(criticJobs.length).toBeGreaterThan(0);
      const forkIds = criticJobs.map((j) => ctx.jobs.get(j.id)?.sessionId).filter(Boolean) as string[];
      expect(forkIds.length).toBeGreaterThan(0);
      // Registered: live in the manager until swept (#215/#216: the one
      // critic fork plus its base).
      const counts = ctx.sessions.countsByProvider();
      expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      const { closed } = await ctx.sessions.sweepIdle(Date.now() + 10 * 60 * 1000, 5 * 60 * 1000);
      for (const fid of forkIds) expect(closed).toContain(fid);
    } finally {
      await app.close();
    }
  });

  it("production wiring sweeps idle sessions without a manual call", async () => {
    const agents = new FakeAgentRunner(baseScripts([
      { match: "sweep question", events: textEvents("Answer.\n\n```json\n{}\n```\n") },
    ]));
    const { app, ctx, id } = await openDemo(agents, { lifecycle: { idleMs: 0, sessionSweepMs: 50 } });
    try {
      ctx.settings.update({ cacheLifetimeMs: 1000 });
      const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "sweep question" });
      expect(res.status).toBe(200);
      await waitJob(ctx, res.json.jobId as string);
      await ctx.jobs.drain(10000);
      expect(Object.values(ctx.sessions.countsByProvider()).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
      await waitFor(() => Object.values(ctx.sessions.countsByProvider()).reduce((a, b) => a + b, 0) === 0, 5000);
    } finally {
      await app.close();
    }
  });
});

describe("post-restart reply (#143)", () => {
  async function askFirst(app: never, ctx: never, id: string): Promise<string> {
    const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "first question" });
    expect(res.status).toBe(200);
    await waitJob(ctx, res.json.jobId as string);
    return res.json.annotationId as string;
  }

  it("loads the card session when the runner still knows it: only the new turn is sent", async () => {
    const db = openDatabase(":memory:");
    const agents = new FakeAgentRunner(baseScripts([
      { match: "first question", events: textEvents("First answer text.\n\n```json\n{}\n```\n") },
      { match: "after restart question", events: textEvents("Second answer text.\n\n```json\n{}\n```\n") },
    ]));
    const first = await createApp("tok", { agents, db });
    const created = await first.app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
    const id = (created.json() as ReviewSnapshot).review.id;
    await waitFor(() => (first.ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length ?? 0) > 0);
    const annotationId = await askFirst(first.app as never, first.ctx as never, id);
    const sessionId = first.ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!.sessionId!;
    expect(sessionId).toBeTruthy();
    await first.app.close();

    // Restart: new app + session manager over the same DB, same runner
    // (it still knows the session, so load can succeed).
    const second = await createApp("tok", { agents, db });
    try {
      const before = agents.prompts.length;
      const res = await postAction(second.app as never, id, { kind: "reply", annotationId, message: "after restart question" });
      expect(res.status).toBe(200);
      await waitJob(second.ctx, res.json.jobId as string);
      const card = second.ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(card.sessionId).toBe(sessionId);
      expect((card.replies ?? []).length).toBe(2);
      const sent = agents.prompts.slice(before).filter((p) => p.sessionId === sessionId);
      expect(sent.length).toBeGreaterThan(0);
      const last = sent[sent.length - 1]!.text;
      expect(last).toContain("# Ask follow-up");
      expect(last).not.toContain("## Selected text");
    } finally {
      await second.app.close();
    }
  });

  it("rebuilds from stored turns once when load cannot succeed, then continues short", async () => {
    const db = openDatabase(":memory:");
    const agents1 = new FakeAgentRunner(baseScripts([
      { match: "first question", events: textEvents("First answer text.\n\n```json\n{}\n```\n") },
    ]));
    const first = await createApp("tok", { agents: agents1, db });
    const created = await first.app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
    const id = (created.json() as ReviewSnapshot).review.id;
    await waitFor(() => (first.ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length ?? 0) > 0);
    const annotationId = await askFirst(first.app as never, first.ctx as never, id);
    await first.app.close();

    // Restart with a runner that knows no prior sessions: load fails.
    const agents2 = new FakeAgentRunner(baseScripts([
      { match: "after restart question", events: textEvents("Second answer text.\n\n```json\n{}\n```\n") },
      { match: "third question", events: textEvents("Third answer text.\n\n```json\n{}\n```\n") },
    ]));
    const second = await createApp("tok", { agents: agents2, db });
    try {
      const res = await postAction(second.app as never, id, { kind: "reply", annotationId, message: "after restart question" });
      expect(res.status).toBe(200);
      await waitJob(second.ctx, res.json.jobId as string);
      const card = second.ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect((card.replies ?? []).length).toBe(2);
      expect(card.sessionId).toBeTruthy();
      // The rebuild turn carried the earlier turns once.
      const rebuildPrompt = agents2.prompts.find((p) => p.text.includes("after restart question") && p.text.includes("# Ask"));
      expect(rebuildPrompt?.text).toContain("First answer text.");
      // The next reply continues on that session with only what is new.
      const res2 = await postAction(second.app as never, id, { kind: "reply", annotationId, message: "third question" });
      await waitJob(second.ctx, res2.json.jobId as string);
      const card2 = second.ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(card2.sessionId).toBe(card.sessionId);
      const last = agents2.prompts.filter((p) => p.sessionId === card.sessionId).at(-1)!;
      expect(last.text).toContain("# Ask follow-up");
      expect(last.text).not.toContain("## Selected text");
    } finally {
      await second.app.close();
    }
  });
});

describe("repair prompt snapshots (#151)", () => {
  it("a fork job keeps its citation-repair prompt on the snapshot", async () => {
    const agents = new FakeAgentRunner(baseScripts([
      { match: "badcite question", events: textEvents("## Answer\n\nAnswer cites [[diff:nope:1-2]] and [[diff:nope:3-4]].\n\n```json\n{}\n```\n") },
    ]));
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "badcite question" });
      expect(res.status).toBe(200);
      await waitJob(ctx, res.json.jobId as string);
      expect(ctx.jobs.get(res.json.jobId as string)?.state).toBe("done");
      const snapshot = ctx.jobs.get(res.json.jobId as string)?.promptSnapshot ?? "";
      expect(snapshot).toContain("badcite question");
      expect(snapshot).toContain("--- repair turn ---");
      expect(snapshot).toContain("diff:nope:1-2");
    } finally {
      await app.close();
    }
  });

  it("a small-model job keeps its citation-repair prompt on the snapshot", async () => {
    const agents = new FakeAgentRunner([
      { match: "Some citations could not be verified", events: textEvents("Fixed summary.\n\n```json\n{\"hunk\": {\"summary\": \"Fixed\", \"hiddenReason\": null}}\n```\n") },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(READER) },
      { match: "HUNKX", events: textEvents("## Summary\n\nSummary cites [[diff:nope:1-2]] and [[diff:nope:3-4]]\n\n```json\n{\"hunk\": {\"summary\": \"Bad\", \"hiddenReason\": null}}\n```\n") },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await ctx.pipeline.runSmall({
        reviewId: id,
        kind: "hunk-pass",
        template: "hunk_pass",
        variables: { hunk: "HUNKX", path: "a.py", plotline: "(none assigned yet)" },
        priority: JOB_PRIORITY.background,
      });
      expect(res.repaired).toBe(true);
      const snapshot = ctx.jobs.get(res.job.id)?.promptSnapshot ?? "";
      expect(snapshot).toContain("HUNKX");
      expect(snapshot).toContain("--- repair turn ---");
      expect(snapshot).toContain("diff:nope:1-2");
    } finally {
      await app.close();
    }
  });
});

describe("partial usage (#151)", () => {
  it("a fork turn that errors mid-stream keeps the usage already counted", async () => {
    const agents = new FakeAgentRunner(baseScripts([
      {
        match: "partial question",
        events: [
          { type: "text", delta: "Partial answer" },
          { type: "usage", inputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 0, outputTokens: 4 },
          { type: "error", message: "boom mid-stream", retryable: false },
        ],
      },
    ]));
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "partial question" });
      expect(res.status).toBe(200);
      await waitJob(ctx, res.json.jobId as string);
      const job = ctx.jobs.get(res.json.jobId as string);
      expect(job?.state).toBe("error");
      expect(job?.usage).toMatchObject({ inputTokens: 7, cachedReadTokens: 3, outputTokens: 4 });
      expect(ctx.reviews.getSnapshot(id)?.usageTotals?.inputTokens).toBeGreaterThanOrEqual(7);
    } finally {
      await app.close();
    }
  });

  it("a reader turn that errors mid-stream keeps the usage already counted", async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      {
        match: "# Reader task",
        events: [
          { type: "text", delta: "## The problem\n\nPartial" },
          { type: "usage", inputTokens: 9, cachedReadTokens: 2, cachedWriteTokens: 0, outputTokens: 6 },
          { type: "error", message: "reader boom", retryable: false },
        ],
      },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitFor(() => ctx.jobs.listByReview(id).some((j) => j.kind === "reader"));
      const readerJob = ctx.jobs.listByReview(id).find((j) => j.kind === "reader")!;
      await waitJob(ctx, readerJob.id);
      const job = ctx.jobs.get(readerJob.id);
      expect(job?.state).toBe("error");
      expect(job?.usage).toMatchObject({ inputTokens: 9, cachedReadTokens: 2, outputTokens: 6 });
    } finally {
      await app.close();
    }
  });

  it("a cancelled fork turn keeps the usage already counted", async () => {
    class AbortFake extends FakeAgentRunner {
      started = false;
      override async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
        if (text.includes("abort question")) {
          this.prompts.push({ sessionId: session.id, text });
          this.started = true;
          yield { type: "usage", inputTokens: 11, cachedReadTokens: 1, cachedWriteTokens: 0, outputTokens: 2 };
          yield { type: "text", delta: "partial" };
          await new Promise<void>((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener("abort", () => resolve(), { once: true });
            setTimeout(resolve, 5000);
          });
          yield { type: "text", delta: "late" };
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new AbortFake(baseScripts());
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "abort question" });
      expect(res.status).toBe(200);
      const jobId = res.json.jobId as string;
      await waitFor(() => agents.started);
      ctx.jobs.cancel(jobId);
      await waitFor(() => ctx.jobs.get(jobId)?.usage !== undefined, 10000);
      const job = ctx.jobs.get(jobId);
      expect(job?.usage).toMatchObject({ inputTokens: 11, cachedReadTokens: 1, outputTokens: 2 });
    } finally {
      await app.close();
    }
  });
});
