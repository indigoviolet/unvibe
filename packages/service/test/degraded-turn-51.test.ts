/**
 * Agent replies are never judged by their wording (issues #51, #180).
 *
 * The service used to fail a turn when the reply's prose matched a
 * process-complaint phrase list and the turn had made no review-tool
 * call. That discarded honest answers ("I couldn't confirm whether the
 * caller retries"), so the phrase matching is gone: whatever the agent
 * writes is shown. A turn now fails only on facts the service observes
 * itself — the turn errored or was cancelled, the answer is empty, or
 * a review-tool call failed to connect (one retry on a fresh session).
 * The trailing `degraded` field stays: with a usable body it is kept,
 * recorded on the job and shown with a quiet note; only an empty
 * degraded answer fails.
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
  quote = "q",
): Promise<{ annotationId: string; jobId?: string }> {
  const acted = await app.inject({
    method: "POST",
    url: `/api/reviews/${id}/actions`,
    headers: authed,
    payload: { kind: "explain", quote, anchor: { where: "block", blockId: "b1" } },
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
      | { working: string | null; turns?: { working: string | null }[] }
      | undefined;
    return a?.working == null && (a?.turns ?? []).every((t) => t.working == null);
  }, 60000);
  return { annotationId, ...(jobId ? { jobId } : {}) };
}

function turnBlocks(
  ctx: Awaited<ReturnType<typeof createApp>>["ctx"],
  id: string,
  annotationId: string,
): unknown[] {
  const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
  return (ann.turns ?? [])[0]?.blocks ?? [];
}

/**
 * Access modes for answer turns. On `main` every session runs with the
 * ACP `readOnly` flag on; #160's full-access branch adds the second
 * entry (`{ name: "full-access", readOnly: false }`) when it lands —
 * the wording-kept expectation is identical in both modes.
 */
const ACCESS_MODES: { name: string; readOnly: boolean }[] = [{ name: "read-only", readOnly: true }];

describe("answers are never judged by wording (#180)", () => {
  for (const mode of ACCESS_MODES) {
    it(`a hedged answer with content is kept in ${mode.name} mode`, { timeout: 90000 }, async () => {
      const agents = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        {
          match: "## The question\n\nExplain this.",
          events: textEvents(
            `I couldn't confirm whether the caller retries, but the host block is described here.\n\n\`\`\`json\n{}\n\`\`\`\n`,
          ),
        },
      ]);
      const { app, ctx, id } = await openDemo(agents);
      try {
        const { annotationId, jobId } = await runExplain(app, ctx, id);
        expect(jobId).toBeTruthy();
        expect(ctx.jobs.get(jobId!)?.state).toBe("done");
        expect(ctx.jobs.get(jobId!)?.error).toBeUndefined();
        const blocks = turnBlocks(ctx, id, annotationId);
        expect(blocks.length).toBeGreaterThan(0);
        expect(JSON.stringify(blocks)).toContain("couldn't confirm whether the caller retries");
      } finally {
        await app.close();
      }
    });
  }

  it("process-complaint wording with content is kept and shown as written", { timeout: 90000 }, async () => {
    const wordings = [
      `The review's MCP server failed to connect, so I could not look up the host block's ID. The block itself is described here.`,
      `I tried to look it up with gh, but the command was refused. The host block is described here anyway.`,
      `Resolve returned no IDs for this, so here is the host block described from the context.`,
    ];
    // Each wording gets its own app run (the fake matches the first
    // script per prompt, so one runner cannot vary its reply).
    for (const wording of wordings) {
      const runner = new FakeAgentRunner([
        { match: "reply with exactly", events: textEvents("ready") },
        { match: "# Reader task", events: textEvents(MINIMAL_READER) },
        {
          match: "## The question\n\nExplain this.",
          events: textEvents(`${wording}\n\n\`\`\`json\n{}\n\`\`\`\n`),
        },
      ]);
      const { app, ctx, id } = await openDemo(runner);
      try {
        const { annotationId, jobId } = await runExplain(app, ctx, id);
        expect(ctx.jobs.get(jobId!)?.state).toBe("done");
        const blocks = turnBlocks(ctx, id, annotationId);
        expect(blocks.length).toBeGreaterThan(0);
        expect(JSON.stringify(blocks)).toContain(wording.slice(0, 40));
      } finally {
        await app.close();
      }
    }
  });

  it("complaint wording passes when the turn used its tools", { timeout: 90000 }, async () => {
    let reviewId: string | null = null;
    let mcp: McpRegistry | null = null;
    class ConnectingFakeRunner extends FakeAgentRunner {
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        if (reviewId && mcp && text.includes("## The question\n\nExplain this.")) {
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
        match: "## The question\n\nExplain this.",
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
      expect(turnBlocks(ctx, id, annotationId).length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("prose about the tools themselves is kept with no tool activity", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "## The question\n\nExplain this.",
        events: textEvents(
          `The MCP server exposes get_hunk for hunk slices, and most people run gh for everything else.\n\n\`\`\`json\n{}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      const blocks = turnBlocks(ctx, id, annotationId);
      expect(blocks.length).toBeGreaterThan(0);
      expect(JSON.stringify(blocks)).toContain("MCP server exposes get_hunk");
    } finally {
      await app.close();
    }
  });
});

describe("the trailing degraded field (#51, #180)", () => {
  it("a trailing degraded field with a usable body keeps the answer with a note", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "## The question\n\nExplain this.",
        events: textEvents(
          `The host block is described here.\n\n\`\`\`json\n{"degraded": "resolve returned nothing for the description paragraphs"}\n\`\`\`\n`,
        ),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      // The job succeeds: the usable answer is kept, not thrown away.
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      expect(ctx.jobs.get(jobId!)?.error).toBeUndefined();
      // The raw reason lands on the job for the Debug page…
      expect(ctx.jobs.get(jobId!)?.degradedReason).toContain("resolve returned nothing");
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(ann.type).toBe("conversation");
      const blocks = (ann.turns ?? [])[0]?.blocks ?? [];
      // …the answer shows with the body plus a plain-words note (never
      // the agent's internal wording on the card).
      expect(JSON.stringify(blocks)).toContain("The host block is described here.");
      expect(JSON.stringify(blocks)).toContain("Some references in this answer could not be linked to the code.");
      expect(JSON.stringify(blocks)).not.toContain("resolve returned nothing");
      expect(ann.turns?.[0]?.error).toBeFalsy();
    } finally {
      await app.close();
    }
  });

  it("a trailing degraded field with no usable body fails the job and stores nothing", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "## The question\n\nExplain this.",
        events: textEvents(`\`\`\`json\n{"degraded": "the MCP was unreachable and there is no answer"}\n\`\`\`\n`),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      expect(ctx.jobs.get(jobId!)?.error).toMatch(/degraded/);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(((ann.turns ?? [])[0]?.blocks ?? [])).toEqual([]);
      // The failed job keeps its reply for the Debug page (#180).
      expect(ctx.jobs.get(jobId!)?.replySnapshot).toContain("there is no answer");
    } finally {
      await app.close();
    }
  });

  it("an empty answer fails the job and stores nothing", { timeout: 90000 }, async () => {
    const agents = new FakeAgentRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      {
        match: "## The question\n\nExplain this.",
        events: textEvents(`\`\`\`json\n{}\n\`\`\`\n`),
      },
    ]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      expect(jobId).toBeTruthy();
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      expect(ctx.jobs.get(jobId!)?.error).toMatch(/empty/);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(((ann.turns ?? [])[0]?.blocks ?? [])).toEqual([]);
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
        match: "## The question\n\nExplain this.",
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
        ((ann.turns ?? [])[0]?.blocks ?? []).length,
      ).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

describe("connection-error retry (#51, #180)", () => {
  const CHATTER = `I could not look up the host block, so this names the card only.\n\n\`\`\`json\n{}\n\`\`\`\n`;
  const CLEAN = `The host block is described here.\n\n\`\`\`json\n{}\n\`\`\`\n`;

  /**
   * Fake that hits a dead review-MCP URL on the first `hitCount`
   * explain turns, then answers per attempt. Later attempts use the
   * fresh session's working connection, so they do not hit.
   */
  function hittingRunner(replies: string[], hitCount = 1): {
    agents: FakeAgentRunner & { seen: string[] };
    mcp: { current: McpRegistry | null };
  } {
    const mcp: { current: McpRegistry | null } = { current: null };
    const scripted = replies.map(textEvents);
    let calls = 0;
    class HittingFakeRunner extends FakeAgentRunner {
      seen: string[] = [];
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        this.seen.push(text);
        if (text.includes("## The question\n\nExplain this.")) {
          calls += 1;
          if (calls <= hitCount) mcp.current?.noteUnknownHit();
          yield* scripted[Math.min(calls, scripted.length) - 1]!;
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new HittingFakeRunner([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
    ]);
    return { agents, mcp };
  }

  it("a connection failure retries once, then fails with the reply kept on the job", { timeout: 90000 }, async () => {
    const { agents, mcp } = hittingRunner([CHATTER, CHATTER], 2);
    const { app, ctx, id } = await openDemo(agents);
    try {
      mcp.current = ctx.mcp;
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      // Exactly two turns: the first attempt plus one retry on a fresh fork.
      const explains = agents.seen.filter((t) => t.includes("## The question\n\nExplain this."));
      expect(explains).toHaveLength(2);
      expect(ctx.jobs.get(jobId!)?.state).toBe("error");
      expect(ctx.jobs.get(jobId!)?.error).toMatch(/failed to connect/);
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(((ann.turns ?? [])[0]?.blocks ?? [])).toEqual([]);
      // The failed job keeps its reply, served next to the prompt (#180).
      expect(ctx.jobs.get(jobId!)?.replySnapshot).toContain("could not look up the host block");
      const replyRes = await app.inject({
        method: "GET",
        url: `/api/jobs/${jobId}/reply`,
        headers: authed,
      } as never);
      expect(replyRes.statusCode).toBe(200);
      expect((replyRes.json() as { replySnapshot: string }).replySnapshot).toContain(
        "could not look up the host block",
      );
    } finally {
      await app.close();
    }
  });

  it("a clean retry recovers and stores", { timeout: 90000 }, async () => {
    const { agents, mcp } = hittingRunner([CHATTER, CLEAN]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      mcp.current = ctx.mcp;
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      const explains = agents.seen.filter((t) => t.includes("## The question\n\nExplain this."));
      expect(explains).toHaveLength(2);
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      expect(
        ((ann.turns ?? [])[0]?.blocks ?? []).length,
      ).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("a retry that still reports degraded keeps its usable body", { timeout: 90000 }, async () => {
    const FIELD_WITH_BODY = `The host block is described here.\n\n\`\`\`json\n{"degraded": "resolve came back empty"}\n\`\`\`\n`;
    const { agents, mcp } = hittingRunner([CHATTER, FIELD_WITH_BODY]);
    const { app, ctx, id } = await openDemo(agents);
    try {
      mcp.current = ctx.mcp;
      const { annotationId, jobId } = await runExplain(app, ctx, id);
      const explains = agents.seen.filter((t) => t.includes("## The question\n\nExplain this."));
      expect(explains).toHaveLength(2);
      // The retry's body is usable with an explicit degraded field, so
      // the answer is kept with the note instead of failing the job.
      expect(ctx.jobs.get(jobId!)?.state).toBe("done");
      expect(ctx.jobs.get(jobId!)?.degradedReason).toContain("resolve came back empty");
      const ann = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!;
      const blocks = (ann.turns ?? [])[0]?.blocks ?? [];
      expect(JSON.stringify(blocks)).toContain("The host block is described here.");
      expect(JSON.stringify(blocks)).toContain("Some references in this answer could not be linked to the code.");
    } finally {
      await app.close();
    }
  });
});
