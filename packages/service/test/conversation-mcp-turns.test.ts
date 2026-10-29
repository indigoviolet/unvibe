/**
 * Conversation turns keep a working review-tool connection (follow-up to
 * the unified card work): turn 1 runs on a fork with its own MCP secret;
 * the job ending revokes nothing; turn 2 continues on the same session
 * and the same secret still serves review tools.
 *
 * Through the real stack (live HTTP + SDK client + real registry), with
 * a recording fake runner: turn 1, end its job, turn 2 on the same
 * session, then a `get_hunk` tool call on the fork's secret.
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { AgentEvent, McpServerConfig, ReviewSnapshot, Session } from "@unvibe/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { createApp } from "../src/server.js";

const authed = { authorization: "Bearer tok" };

function textEvents(text: string): AgentEvent[] {
  return [
    { type: "text", delta: text },
    { type: "usage", inputTokens: 10, cachedReadTokens: 5, cachedWriteTokens: 0, outputTokens: 10 },
    { type: "done", stopReason: "end_turn" },
  ];
}

const MINIMAL_READER = `## The problem

The problem paragraph.

## The central change

The central paragraph.

\`\`\`json
{"cardIds": ["problem", "central"]}
\`\`\`
`;

const FIRST_ANSWER = `First answer body about the fold.

\`\`\`json
{}
\`\`\`
`;

const SECOND_ANSWER = `Second answer body about ordering.

\`\`\`json
{}
\`\`\`
`;

/** Fake that records the MCP servers handed to every started session. */
class RecordingFake extends FakeAgentRunner {
  mcpStarts: { sessionId: string; mcpServers: McpServerConfig[] }[] = [];
  override async start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  }): Promise<Session> {
    const session = await super.start(opts);
    this.mcpStarts.push({ sessionId: session.id, mcpServers: opts.mcpServers });
    return session;
  }
  override async fork(session: Session): Promise<Session> {
    // ACP forks inherit the parent's MCP servers (#124); mirror that so
    // the recorded fork start carries the fork's MCP URL like production.
    const child = await super.fork(session);
    const parent = this.mcpStarts.find((s) => s.sessionId === session.id);
    const rec = this.mcpStarts.find((s) => s.sessionId === child.id);
    if (rec && parent) rec.mcpServers = parent.mcpServers;
    return child;
  }
}

type App = Awaited<ReturnType<typeof createApp>>;

async function waitFor(check: () => boolean, timeoutMs = 30000, intervalMs = 50): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function postAction(
  app: App["app"],
  id: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.inject({
    method: "POST",
    url: `/api/reviews/${id}/actions`,
    headers: authed,
    payload: body,
  } as never);
  return { status: res.statusCode, json: (res.json() ?? {}) as Record<string, unknown> };
}

async function waitForJob(ctx: App["ctx"], jobId: string, timeoutMs = 30000): Promise<string> {
  let state = "";
  await waitFor(() => {
    const j = ctx.jobs.get(jobId);
    if (!j) return false;
    state = j.state;
    return state === "done" || state === "error" || state === "cancelled";
  }, timeoutMs);
  return state;
}

function secretOf(mcpServers: McpServerConfig[]): string | null {
  const url = mcpServers[0]?.url ?? "";
  const m = url.match(/\/api\/mcp\/([0-9a-f]{64})/);
  return m ? m[1] : null;
}

async function openTools(origin: string, secret: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp/${secret}`)));
  return client;
}

async function callHunk(client: Client, id: string): Promise<string> {
  const tools = await client.listTools();
  expect(tools.tools.map((t) => t.name)).toContain("get_hunk");
  const res = (await client.callTool({ name: "get_hunk", arguments: { id } })) as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  expect(res.isError).not.toBe(true);
  return res.content.map((c) => c.text).join("\n");
}

describe("conversation MCP connection across turns", () => {
  it("turn 2 on the continued session still serves review tools on the fork secret", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const agents = new RecordingFake([
      { match: "reply with exactly", events: textEvents("ready") },
      { match: "# Reader task", events: textEvents(MINIMAL_READER) },
      { match: "## The question\n\nExplain this.", events: textEvents(FIRST_ANSWER) },
      { match: "# Ask", events: textEvents(SECOND_ANSWER) },
    ]);
    const { app, ctx } = await createApp("tok", { agents });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/reviews",
        headers: authed,
        payload: { repoId: "demo" },
      } as never);
      expect(created.statusCode).toBe(201);
      const id = (created.json() as ReviewSnapshot).review.id;
      await waitFor(
        () =>
          !!ctx.reviews
            .getSnapshot(id)
            ?.pages.find((p) => p.id === "root")
            ?.cards.find((c) => c.id === "problem")?.blocks.length,
      );
      const snap = ctx.reviews.getSnapshot(id)!;
      const file = snap.files.find((f) => f.path.includes("connection") && !f.path.includes("test")) ?? snap.files[0];
      const hunkId = `h:${file.fileKey}:${file.hunks[0].contentHash}`;

      // Turn 1 on a fork with its own MCP secret.
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      expect(await waitForJob(ctx, ex.json.jobId as string)).toBe("done");
      const first = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === (ex.json.annotationId as string))!;
      const sessionId = first.sessionId!;
      expect(sessionId).toBeTruthy();
      // The fork's own secret (not the reader's per-attempt one, which
      // is revoked when its job ends).
      const forkStart = agents.mcpStarts.find((s) => s.sessionId === sessionId);
      const forkSecret = forkStart ? secretOf(forkStart.mcpServers) : null;
      expect(forkSecret).toBeTruthy();
      // Issue #174: the fork shares the base's secret (ACP forks inherit
      // the parent's MCP servers). The base's own client stays connected
      // while the fork's client initializes on the same secret — before
      // the fix the fork's initialize was refused ("Server already
      // initialized") and its tool calls never landed.
      const baseTools = await openTools(origin, forkSecret!);
      expect(await callHunk(baseTools, hunkId)).toContain(file.fileKey);
      // The fork's secret serves review tools while its job runs…
      const tools = await openTools(origin, forkSecret!);
      try {
        expect(await callHunk(baseTools, hunkId)).toContain(file.fileKey);
        expect(await callHunk(tools, hunkId)).toContain(file.fileKey);

        // …and still after its job ended: turn 2 continues on the same
        // session, and the same secret still serves tools.
        const rep = await postAction(app, id, {
          kind: "reply",
          annotationId: first.id,
          message: "What about ordering?",
        });
        expect(rep.status).toBe(200);
        if (rep.json.jobId) expect(await waitForJob(ctx, rep.json.jobId as string)).toBe("done");
        const after = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === first.id)!;
        expect(after.sessionId).toBe(sessionId);
        expect(await callHunk(tools, hunkId)).toContain(file.fileKey);
      } finally {
        await tools.close().catch(() => {});
        await baseTools.close().catch(() => {});
      }
    } finally {
      await app.close();
    }
  });

  it("a continued turn that hits a dead review-MCP URL retries once on a fresh fork", { timeout: 90000 }, async () => {
    process.env.UNVIBE_REPO_ROOTS = "";
    const CHATTER =
      `I tried to fetch the code with get_code but failed to connect to the review MCP server.\n\n\`\`\`json\n{}\n\`\`\`\n`;
    class ConnFlakeFake extends RecordingFake {
      seen: string[] = [];
      calls = 0;
      release!: () => void;
      private gate: Promise<void>;
      constructor() {
        super([
          { match: "reply with exactly", events: textEvents("ready") },
          { match: "# Reader task", events: textEvents(MINIMAL_READER) },
          { match: "## The question\n\nExplain this.", events: textEvents(FIRST_ANSWER) },
        ]);
        this.gate = new Promise<void>((r) => {
          this.release = r;
        });
      }
      override async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
        this.seen.push(text);
        if (text.includes("connflake question")) {
          this.calls += 1;
          this.prompts.push({ sessionId: session.id, text });
          if (this.calls === 1) {
            await this.gate;
            yield* textEvents(CHATTER);
            return;
          }
          yield* textEvents(SECOND_ANSWER);
          return;
        }
        yield* super.prompt(session, text);
      }
    }
    const agents = new ConnFlakeFake();
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
      await waitFor(
        () =>
          !!ctx.reviews
            .getSnapshot(id)
            ?.pages.find((p) => p.id === "root")
            ?.cards.find((c) => c.id === "problem")?.blocks.length,
      );
      const ex = await postAction(app, id, {
        kind: "explain",
        quote: "raw CRLF",
        anchor: { where: "block", blockId: "b1" },
      });
      expect(ex.status).toBe(200);
      expect(await waitForJob(ctx, ex.json.jobId as string)).toBe("done");
      const annotationId = ex.json.annotationId as string;

      // Turn 2 starts on the continued session and blocks mid-prompt.
      const rep = await postAction(app, id, {
        kind: "reply",
        annotationId,
        message: "connflake question about ordering?",
      });
      expect(rep.status).toBe(200);
      await waitFor(() => agents.calls >= 1);
      // While it runs, its tool call hits a dead review-MCP URL.
      const dead = await app.inject({
        method: "POST",
        url: `/api/mcp/${"d".repeat(64)}`,
        headers: authed,
      } as never);
      expect(dead.statusCode).toBe(404);
      agents.release();
      expect(await waitForJob(ctx, rep.json.jobId as string)).toBe("done");

      // Exactly two attempts: the continued session, then a fresh fork.
      const attempts = agents.seen.filter((t) => t.includes("connflake question"));
      expect(attempts).toHaveLength(2);
      const firstSession = agents.prompts.find((p) => p.text === attempts[0])?.sessionId;
      const secondSession = agents.prompts.find((p) => p.text === attempts[1])?.sessionId;
      expect(firstSession).toBeTruthy();
      expect(secondSession).toBeTruthy();
      expect(secondSession).not.toBe(firstSession);
      // The retry carries the full first-turn prompt plus the stored
      // transcript (the short follow-up prompt assumes live history).
      expect(attempts[1]).toContain("## Selected text");
      expect(attempts[1]).toContain("First answer body");
      const turn = ctx.reviews.getSnapshot(id)!.annotations.find((a) => a.id === annotationId)!.replies![1];
      expect(turn.blocks.length).toBeGreaterThan(0);
      expect(turn.error).toBeFalsy();
    } finally {
      await app.close();
    }
  });
});
