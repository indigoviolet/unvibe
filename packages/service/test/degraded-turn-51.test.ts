/**
 * Agent process chatter never reaches the reader (issue #51).
 *
 * With the fake `AgentRunner` the review MCP server is unreachable by
 * construction (fakes never connect), which is exactly the production
 * failure shape: a turn that reports a degraded reply — in the trailing
 * `degraded` field or as tool chatter in the body — must fail its job
 * instead of storing a card, and must leave no streamed partials behind.
 * A turn whose session did use its tools is exempt from the fuzzy match.
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

async function openDemo(agents: FakeAgentRunner): Promise<{
  app: Awaited<ReturnType<typeof createApp>>["app"];
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"];
  id: string;
}> {
  const { app, ctx } = await createApp("tok", { agents });
  const created = await app.inject({
    method: "POST",
    url: "/api/reviews",
    headers: authed,
    payload: { repoId: "demo" },
  } as never);
  expect(created.statusCode).toBe(201);
  const id = (created.json() as ReviewSnapshot).review.id;
  await waitFor(() => !!ctx.reviews.getSnapshot(id)?.pages.find((p) => p.id === "root")?.cards.length);
  return { app, ctx, id };
}

async function runExplain(
  app: Awaited<ReturnType<typeof createApp>>["app"],
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  id: string,
): Promise<{ annotationId: string; jobId?: string }> {
  const acted = await app.inject({
    method: "POST",
    url: `/api/reviews/${id}/actions`,
    headers: authed,
    payload: { kind: "explain", quote: "q", anchor: { where: "block", blockId: "b1" } },
  } as never);
  expect(acted.statusCode).toBe(200);
  const annotationId = ((acted.json() ?? {}) as { annotationId?: string }).annotationId!;
  const jobId = ((acted.json() ?? {}) as { jobId?: string }).jobId;
  if (jobId) {
    await waitFor(() => ["done", "error", "cancelled"].includes(ctx.jobs.get(jobId)?.state ?? ""), 60000);
  }
  // The fill settles after the job (final mutate clears `working`).
  await waitFor(() => {
    const s = ctx.reviews.getSnapshot(id);
    const a = s?.annotations.find((x) => x.id === annotationId) as unknown as
      | { working: string | null; expansion?: { working: string | null } }
      | undefined;
    return a?.working == null && a?.expansion?.working == null;
  }, 60000);
  return { annotationId, ...(jobId ? { jobId } : {}) };
}

describe("degraded turns (#51)", () => {
  it("a trailing degraded field fails the job and stores nothing", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "# Explain",
        events: textEvents(
          `The host block is described here.\n\n\`\`\`json\n{"degraded": "resolve returned nothing for the description paragraphs"}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      expect(ctx.jobs.get(jobId!)?.error).toMatch(/degraded/);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(ann.type).toBe("expansion");
      // No card content survived: neither the stored fill (never applied)
      // nor streamed partials (cleared on degraded errors).
      expect((ann as unknown as { expansion: { blocks: unknown[] } }).expansion.blocks).toEqual([]);
      expect(JSON.stringify(ctx.reviews.getSnapshot(id))).not.toContain("The host block is described here.");
    } finally {
      await app.close();
    }
  });

  it("MCP chatter in the body fails the job and stores nothing", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "# Explain",
        events: textEvents(
          `The review's MCP server failed to connect, so I could not look up the host block's ID.\n\n\`\`\`json\n{}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      const snap = ctx.reviews.getSnapshot(id)!;
      const ann = snap.annotations.find((a) => a.id === annotationId)!;
      expect((ann as unknown as { expansion: { blocks: unknown[] } }).expansion.blocks).toEqual([]);
      expect(JSON.stringify(snap)).not.toContain("failed to connect");
    } finally {
      await app.close();
    }
  });

  it("a refused shell lookup in the body fails the job", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "# Explain",
        events: textEvents(
          `I don't know the exact repo name, though. I tried to look it up with gh, but the command was refused.\n\n\`\`\`json\n{}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      const snap = ctx.reviews.getSnapshot(id)!;
      expect(JSON.stringify(snap)).not.toContain("command was refused");
      const ann = snap.annotations.find((a) => a.id === annotationId)!;
      expect((ann as unknown as { expansion: { blocks: unknown[] } }).expansion.blocks).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("first-person chatter passes when the turn used its tools", { timeout: 90000 }, async () => {
    // A fake that connects a review secret mid-turn: the fuzzy match is
    // exempt once the turn ran *with* its tools (the transport call fails
    // on stub objects; the connected flag flips first).
    let reviewId: string | null = null;
    let mcp: McpRegistry | null = null;
    class ConnectingFakeRunner extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (reviewId && mcp && text.includes("# Explain")) {
          const issued = mcp.issueSession(reviewId, "mid-turn", "session");
          void mcp.handleRequest(issued.secret, {} as never, {} as never, { method: "ping" }).catch(() => {});
          await new Promise((r) => setTimeout(r, 150));
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new ConnectingFakeRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "# Explain",
        events: textEvents(`I could not verify the timeout from the context alone.\n\n\`\`\`json\n{}\n\`\`\`\n`),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      reviewId = id;
      mcp = ctx.mcp;
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(
        (ann as unknown as { expansion: { blocks: unknown[] } }).expansion.blocks.length,
      ).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("registry activity counts connections, calls and unknown hits", async () => {
    const agents = new FakeAgentRunner();
    const { app, ctx } = await createApp("tok", { agents });
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      const id = (created.json() as ReviewSnapshot).review.id;
      expect(ctx.mcp.activitySnapshot(id)).toEqual({ connected: 0, toolCalls: 0, unknownHits: 0 });
      const issued = ctx.mcp.issueSession(id, "probe-conn", "session");
      void ctx.mcp.handleRequest(issued.secret, {} as never, {} as never, { method: "ping" }).catch(() => {});
      await waitFor(() => ctx.mcp.activitySnapshot(id).connected > 0, 5000);
      await ctx.mcp.handleRequest("dead-secret", {} as never, { statusCode: 0, end: () => {} } as never, null).catch(() => {});
      expect(ctx.mcp.activitySnapshot(id)).toEqual({ connected: 1, toolCalls: 0, unknownHits: 1 });
    } finally {
      await app.close();
    }
  });
});

describe("card-only anchors (#51 validator)", () => {
  it("a card-only anchor gets one repair turn with the reason, then lands", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      {
        match: "Anchor problem",
        events: textEvents(
          `The host block is described here.\n\n\`\`\`json\n{"anchor": {"quote": "problem paragraph", "host": "card:problem#b1"}}\n\`\`\`\n`,
        ),
      },
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "# Explain",
        events: textEvents(
          `The host block is described here.\n\n\`\`\`json\n{"anchor": {"quote": "problem paragraph", "host": "card:central"}}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      // The anchor repair turn ran exactly once, carrying the reason.
      const repairs = agents.prompts.filter((p) => p.text.includes("Anchor problem"));
      expect(repairs).toHaveLength(1);
      expect(repairs[0].text).toMatch(/only the card/);
      // The fixed anchor validates; the job succeeds with content stored.
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(
        (ann as unknown as { expansion: { blocks: unknown[] } }).expansion.blocks.length,
      ).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
