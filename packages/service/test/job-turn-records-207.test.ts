/**
 * Issue #207: every job keeps per-turn records (prompt, streamed output,
 * tool calls with truncated results, derived + raw usage) for the Debug
 * page's Output view — not only failed jobs.
 *
 * All with the fake AgentRunner — never a real agent.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { JobQueue } from "../src/jobs/queue.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

const RAW = {
  usage: { inputTokens: 10, outputTokens: 10, totalTokens: 25, cachedReadTokens: 5 },
  _meta: { quota: { token_count: { inputTokens: 10, cachedInputTokens: 5, outputTokens: 10, totalTokens: 25 } } },
};

function textEvents(text: string, extra: AgentEvent[] = []): AgentEvent[] {
  return [
    ...extra,
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10, raw: RAW },
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

const BAD_READER = `## The problem

Body cites [[diff:nope:1-2]] and [[diff:nope:3-4]].

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

async function waitFor(check: () => boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function openDemo(agents: FakeAgentRunner) {
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  await waitFor(() => (ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length ?? 0) > 0);
  return { app, ctx, id };
}

function baseScripts(extra: { match: string; events: AgentEvent[] }[] = []): { match: string; events: AgentEvent[] }[] {
  return [
    { match: "Some citations in your previous reply", events: textEvents("Fixed answer.\n\n```json\n{}\n```\n") },
    { match: "reply with exactly", events: textEvents("ready") },
    { match: "# Reader task", events: textEvents(READER) },
    ...extra,
  ];
}

async function postAction(app: { inject: (o: never) => Promise<{ statusCode: number; json: () => Record<string, unknown> }> }, id: string, body: unknown) {
  const res = await app.inject({ method: "POST", url: `/api/reviews/${id}/actions`, headers: authed, payload: body } as never);
  return { status: res.statusCode, json: res.json() as Record<string, unknown> };
}

async function waitJob(ctx: { jobs: { get(id: string): { state: string } | undefined } }, id: string): Promise<void> {
  await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(id)?.state ?? ""));
}

describe("job turn records (#207)", () => {
  it("reader with a repair: both turns keep prompt, output, usage and raw usage", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "Some citations in your previous reply", events: textEvents(READER) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(BAD_READER) },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const readerJob = ctx.jobs.listByReview(id).find((j) => j.kind === "reader")!;
      await waitJob(ctx, readerJob.id);
      const job = ctx.jobs.get(readerJob.id)!;
      expect(job.state).toBe("done");
      // Successful jobs keep their output too (not only failures).
      const turns = job.turnRecords ?? [];
      expect(turns.map((t) => t.label)).toEqual(["first", "repair"]);
      expect(turns[0].prompt).toContain("# Reader task");
      expect(turns[0].output).toContain("Body cites");
      expect(turns[0].outputOriginalLength).toBe(turns[0].output.length);
      expect(turns[1].prompt).toContain("Some citations in your previous reply");
      expect(turns[1].prompt).toContain("diff:nope:1-2");
      expect(turns[1].output).toContain("The central paragraph.");
      for (const turn of turns) {
        expect(turn.usage).toEqual({ inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 });
        // Raw usage stored verbatim, exactly as the runner reported it.
        expect(turn.rawUsage).toEqual(RAW);
        expect(turn.finishedAt).toBeTypeOf("number");
      }
      // Lists omit the records; the per-job output endpoint serves them.
      expect(ctx.jobs.listByReview(id).find((j) => j.id === job.id)?.turnRecords).toBeUndefined();
      const out = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/output`, headers: authed } as never);
      expect(out.statusCode).toBe(200);
      expect((out.json() as { turnRecords: unknown[] }).turnRecords).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("a fork turn records tool calls with arguments and a truncated result", { timeout: 90000 }, async () => {
    const longResult = `hunk text ${"x".repeat(5000)}`;
    const agents = new FakeAgentRunner(baseScripts([
      {
        match: "tool question",
        events: textEvents("The answer.\n\n```json\n{}\n```\n", [
          { type: "tool", name: "Read", status: "start", id: "tc-1", detail: "{\"path\":\"src/example_module.py\"}" },
          { type: "tool", name: "Read", status: "end", id: "tc-1", result: longResult },
        ]),
      },
    ]));
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app as never, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "tool question" });
      expect(res.status).toBe(200);
      const jobId = res.json.jobId as string;
      await waitJob(ctx, jobId);
      const job = ctx.jobs.get(jobId)!;
      expect(job.state).toBe("done");
      const turns = job.turnRecords ?? [];
      expect(turns).toHaveLength(1);
      expect(turns[0].label).toBe("first");
      expect(turns[0].prompt).toContain("tool question");
      expect(turns[0].output).toContain("The answer.");
      expect(turns[0].tools).toHaveLength(1);
      const tool = turns[0].tools[0];
      expect(tool.name).toBe("Read");
      expect(tool.detail).toContain("example_module.py");
      // Truncated with a marker naming the original length.
      expect(tool.resultOriginalLength).toBe(longResult.length);
      expect(tool.result).toContain("[truncated:");
      expect(tool.result).toContain(`${longResult.length} chars`);
      expect(tool.result!.length).toBeLessThan(longResult.length);
      expect(tool.finishedAt).toBeTypeOf("number");
      expect(turns[0].rawUsage).toEqual(RAW);
    } finally {
      await app.close();
    }
  });

  it("a failed turn keeps its partial output and usage", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner(baseScripts([
      {
        match: "partial question",
        events: [
          { type: "text", delta: "Partial answer" },
          { type: "usage", inputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 0, outputTokens: 4, raw: RAW },
          { type: "error", message: "boom mid-stream", retryable: false },
        ],
      },
    ]));
    const { app, ctx, id } = await openDemo(agents);
    try {
      const res = await postAction(app as never, id, { kind: "ask", quote: "central paragraph", anchor: { where: "block", blockId: "central#b1" }, message: "partial question" });
      expect(res.status).toBe(200);
      const jobId = res.json.jobId as string;
      await waitJob(ctx, jobId);
      const job = ctx.jobs.get(jobId)!;
      expect(job.state).toBe("error");
      const turns = job.turnRecords ?? [];
      expect(turns).toHaveLength(1);
      expect(turns[0].output).toContain("Partial answer");
      expect(turns[0].usage).toEqual({ inputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 0, outputTokens: 4 });
      expect(turns[0].rawUsage).toEqual(RAW);
      expect(turns[0].finishedAt).toBeTypeOf("number");
    } finally {
      await app.close();
    }
  });

  it("an aborted (cancelled) job keeps the turn so far, with usage", async () => {
    const queue = new JobQueue();
    let started!: () => void;
    const running = new Promise<void>((r) => { started = r; });
    const job = queue.enqueue({
      reviewId: "r1",
      kind: "ask",
      provider: "claude",
      model: "m",
      effort: "",
      priority: 10,
      promptSnapshot: "the prompt",
      run: async (ctx) => {
        ctx.beginTurn("first", "the prompt");
        ctx.reportText("half an answer");
        ctx.reportTool("Read", "a.py", { status: "start", id: "t1" });
        ctx.reportTool("Read", undefined, { status: "end", id: "t1", result: "file body" });
        ctx.reportTurnUsage({ inputTokens: 3, cachedReadTokens: 1, cachedWriteTokens: 0, outputTokens: 2 }, RAW);
        started();
        await new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    });
    await running;
    queue.cancel(job.id);
    const cancelled = queue.get(job.id)!;
    expect(cancelled.state).toBe("cancelled");
    const turns = cancelled.turnRecords ?? [];
    expect(turns).toHaveLength(1);
    expect(turns[0].prompt).toBe("the prompt");
    expect(turns[0].output).toBe("half an answer");
    expect(turns[0].tools[0]).toMatchObject({ name: "Read", detail: "a.py", result: "file body" });
    expect(turns[0].usage).toEqual({ inputTokens: 3, cachedReadTokens: 1, cachedWriteTokens: 0, outputTokens: 2 });
    expect(turns[0].rawUsage).toEqual(RAW);
    expect(turns[0].finishedAt).toBeTypeOf("number");
    await queue.drain().catch(() => {});
  });
});
