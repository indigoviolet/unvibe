/**
 * The reader job retries once when its review tools fail to connect (issue
 * #146, plus the repair-prompt record from #124). On `main` only fork jobs (`runInFork`) retried on a fresh session
 * after a turn observably hit a dead review-MCP connection
 * (`DegradedConnError`); the reader had no attempt loop, so the same failure
 * there failed the guide outright.
 *
 * With the fake `AgentRunner` the review MCP server is unreachable by
 * construction, so a mid-turn `noteUnknownHit` is exactly the production
 * failure shape (a dead review-MCP URL): the service observes the hit
 * itself (#180 — the reply's wording is never judged), throws
 * `DegradedConnError`, and the reader must retry once on a fresh session.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import type { McpRegistry } from "../src/mcp/registry.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

async function waitFor(check: () => boolean, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

/**
 * First attempt streams a real card while a review-tool call fails to
 * connect: the observed hit fails it with a connection error, and the
 * provisional card must not survive.
 */
const CHATTER_WITH_CARD = `## The problem

Partial problem text.

I could not look up the central change because the review lookup failed to connect.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

const DEGRADED_FIELD_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"], "degraded": "resolve returned nothing for the description paragraphs"}
\`\`\`
`;

/**
 * Fake that hits a dead review-MCP URL on the first `hitCount` reader
 * turns, then answers per attempt. Later attempts use the fresh
 * session's working connection, so they do not hit.
 */
function hittingRunner(replies: string[], hitCount = 1): {
  agents: FakeAgentRunner & { readerPrompts: () => { sessionId: string; text: string }[] };
  mcp: { current: McpRegistry | null };
} {
  const mcp: { current: McpRegistry | null } = { current: null };
  const scripted = replies.map(textEvents);
  let calls = 0;
  class HittingFakeRunner extends FakeAgentRunner {
    readerPrompts(): { sessionId: string; text: string }[] {
      return this.prompts.filter((p) => p.text.includes("# Reader task"));
    }
    override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
      if (text.includes("# Reader task")) {
        calls += 1;
        // The base records prompts; this override bypasses it, so record here.
        this.prompts.push({ sessionId: session.id, text });
        if (calls <= hitCount) mcp.current?.noteUnknownHit();
        yield* scripted[Math.min(calls, scripted.length) - 1]!;
        return;
      }
      yield* super.prompt(session, text);
    }
  }
  const agents = new HittingFakeRunner([
    { match: "reply with exactly", events: textEvents("ready") },
  ]) as FakeAgentRunner & { readerPrompts: () => { sessionId: string; text: string }[] };
  return { agents, mcp };
}

async function openReview(
  agents: FakeAgentRunner,
  mcp: { current: McpRegistry | null },
): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
  id: string;
}> {
  const { app, ctx } = await createApp("tok", { agents });
  mcp.current = ctx.mcp;
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  return { app, ctx, id };
}

function readerJobOf(ctx: { jobs: { listByReview(id: string): { kind: string }[] } }, id: string): string {
  const jobs = ctx.jobs.listByReview(id).filter((j) => j.kind === "reader");
  expect(jobs.length).toBeGreaterThan(0);
  return (jobs[jobs.length - 1] as { id: string }).id;
}

async function waitForJob(
  ctx: {
    jobs: { get(id: string): { state: string; error?: string; usage?: Record<string, number> } | undefined };
  },
  jobId: string,
  timeoutMs = 60000,
): Promise<void> {
  await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), timeoutMs);
}

function rootCardIds(ctx: { reviews: { getSnapshot(id: string): ReviewSnapshot | null } }, id: string): string[] {
  return (ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards ?? []).map((c) => c.id);
}

describe("reader retry (#146) + repair record (#124)", () => {
  it("a dead connection on the first attempt retries once on a fresh session and builds one guide", { timeout: 90000 }, async () => {
    const { agents, mcp } = hittingRunner([CHATTER_WITH_CARD, MINIMAL_READER]);
    const { app, ctx, id } = await openReview(agents, mcp);
    try {
      const jobId = readerJobOf(ctx, id);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("done");
      // Exactly two reader turns: the failed attempt plus one retry.
      const readerPrompts = agents.readerPrompts();
      expect(readerPrompts).toHaveLength(2);
      // Fresh session per attempt: the retry never reuses the dead session.
      expect(new Set(readerPrompts.map((p) => p.sessionId)).size).toBe(2);
      // One guide, no leftover provisional cards: the failed attempt's
      // streamed card was overwritten, not duplicated.
      expect(rootCardIds(ctx, id).sort()).toEqual(["central", "problem"]);
      // Usage accounting: each attempt reported + recorded exactly once.
      expect(ctx.jobs.get(jobId)?.usage).toMatchObject({
        inputTokens: 20,
        cachedReadTokens: 10,
        cachedWriteTokens: 0,
        outputTokens: 20,
      });
    } finally {
      await app.close();
    }
  });

  it("two dead connections fail terminally with a plain-words error state and Retry", { timeout: 120000 }, async () => {
    const { agents, mcp } = hittingRunner([CHATTER_WITH_CARD, CHATTER_WITH_CARD, MINIMAL_READER], 2);
    const { app, ctx, id } = await openReview(agents, mcp);
    try {
      const jobId = readerJobOf(ctx, id);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("error");
      // Exactly one retry: the second failure is terminal.
      expect(agents.readerPrompts()).toHaveLength(2);
      // The guide's error state is plain words (#45: no MCP, no tool names).
      const stageError = ctx.reviews.getSnapshot(id)?.pipeline?.errors?.["reader"];
      expect(stageError).toBe("The guide couldn't be started because the review details couldn't be reached. Please retry.");
      expect(stageError).not.toMatch(/MCP/i);
      // The raw reason stays on the job error for the Debug page.
      expect(ctx.jobs.get(jobId)?.error).toMatch(/review-MCP call failed to connect/);
      // …and the failed job keeps its reply next to the prompt (#180).
      expect(ctx.jobs.get(jobId)?.replySnapshot).toContain("Partial problem text.");
      // No leftover provisional cards from either attempt.
      expect(rootCardIds(ctx, id)).toEqual([]);
      // Retry (the guide's Retry control, #86) re-enqueues the reader and
      // the third attempt builds the guide.
      const resumed = await app.inject({ method: "POST", url: `/api/reviews/${id}/resume`, headers: authed } as never);
      expect(resumed.statusCode).toBe(200);
      await waitFor(() => rootCardIds(ctx, id).length > 0, 60000);
      expect(rootCardIds(ctx, id).sort()).toEqual(["central", "problem"]);
      expect(agents.readerPrompts()).toHaveLength(3);
    } finally {
      await app.close();
    }
  });

  it("a citation repair turn is kept on the job's stored prompt (#124)", { timeout: 90000 }, async () => {
    // The repair prompt names the failed citations, so the Debug page shows
    // what failed (prompt wording, an ID shape, or the validator).
    const badReader = `## The problem

Body cites [[diff:nope:1-2]] and [[diff:nope:3-4]].

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;
    const agents = new FakeAgentRunner([
      { match: "Some citations in your previous reply", events: textEvents(MINIMAL_READER) },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(badReader) },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      // The repair turn ran and the guide landed.
      await waitFor(() => rootCardIds(ctx, id).length > 0, 60000);
      expect(agents.prompts.filter((p) => p.text.includes("# Reader task"))).toHaveLength(1);
      expect(agents.prompts.some((p) => p.text.includes("Some citations in your previous reply"))).toBe(true);
      const jobId = readerJobOf(ctx, id);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("done");
      const snapshot = ctx.jobs.get(jobId)?.promptSnapshot ?? "";
      expect(snapshot).toContain("--- repair turn ---");
      expect(snapshot).toContain("diff:nope:1-2");
      expect(snapshot).toContain("diff:nope:3-4");
    } finally {
      await app.close();
    }
  });

  it("a trailing degraded field with a usable guide keeps it, with no retry", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(DEGRADED_FIELD_READER) },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      const jobId = readerJobOf(ctx, id);
      await waitForJob(ctx, jobId);
      // Kept (#180): the explicit field records the reason on the job and
      // the guide lands; it is never a failure when there is content.
      expect(ctx.jobs.get(jobId)?.state).toBe("done");
      expect(ctx.jobs.get(jobId)?.degradedReason).toContain("resolve returned nothing");
      expect(agents.prompts.filter((p) => p.text.includes("# Reader task"))).toHaveLength(1);
      expect(rootCardIds(ctx, id).sort()).toEqual(["central", "problem"]);
    } finally {
      await app.close();
    }
  });

  it("an empty reader reply fails the job with no retry", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents("") },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      const jobId = readerJobOf(ctx, id);
      await waitForJob(ctx, jobId);
      expect(ctx.jobs.get(jobId)?.state).toBe("error");
      expect(ctx.jobs.get(jobId)?.error).toMatch(/empty/);
      expect(agents.prompts.filter((p) => p.text.includes("# Reader task"))).toHaveLength(1);
      expect(rootCardIds(ctx, id)).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
