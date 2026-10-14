/**
 * Base sessions belong to one review (#43).
 *
 * Every new review starts at v1 with the same guide revision, so the base
 * key must carry the review id: a second review never picks up the first
 * one's agent session, and a review removed and added again starts from a
 * new session.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { McpServerConfig, ReviewSnapshot, Session } from "@unvibe/shared";
import { FakeAgentRunner } from "../src/agent/fake.js";
import { MCP_ROUTE_PREFIX } from "../src/mcp/routes.js";
import { createApp } from "../src/server.js";
import { openDatabase } from "../src/store/db.js";

const authed = { authorization: "Bearer tok" };
const BASE_PACK = "Read the base context below";

async function waitFor(check: () => boolean, timeoutMs = 10000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (check()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Fake runner that records the MCP servers each started session was given. */
class RecordingAgents extends FakeAgentRunner {
  readonly mcpBySession = new Map<string, McpServerConfig[]>();

  override async start(opts: Parameters<FakeAgentRunner["start"]>[0]): Promise<Session> {
    const session = await super.start(opts);
    this.mcpBySession.set(session.id, opts.mcpServers);
    return session;
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

function agents(): RecordingAgents {
  return new RecordingAgents([
    { match: BASE_PACK, events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end_turn" }] },
    // Real content for the turns whose success these tests wait on: an
    // empty answer is a failed turn (#180), so the old empty catch-all
    // left the reader failed and no base was ever built.
    { match: "# Reader task", events: [{ type: "text", delta: MINIMAL_READER }, { type: "done", stopReason: "end_turn" }] },
    {
      match: "## The question",
      events: [
        { type: "text", delta: "The line is explained here.\n\n```json\n{}\n```\n" },
        { type: "done", stopReason: "end_turn" },
      ],
    },
    { match: "", events: [{ type: "done", stopReason: "end_turn" }] },
  ]);
}

/** Session ids that received a base pack, in order. */
function baseSessions(runner: FakeAgentRunner): string[] {
  return runner.prompts.filter((p) => p.text.includes(BASE_PACK)).map((p) => p.sessionId);
}

describe("base sessions are per review", () => {
  beforeEach(() => {
    process.env.UNVIBE_REPO_ROOTS = "";
  });

  async function createDemo(app: Awaited<ReturnType<typeof createApp>>["app"]): Promise<string> {
    const created = await app.inject({ method: "POST", url: "/api/reviews", headers: authed, payload: { repoId: "demo" } });
    expect(created.statusCode).toBe(201);
    return (created.json() as ReviewSnapshot).review.id;
  }

  it("two reviews of the same change each build their own base", async () => {
    const runner = agents();
    const { app } = await createApp("tok", { agents: runner });
    try {
      await createDemo(app);
      await waitFor(() => baseSessions(runner).length >= 1);
      await createDemo(app);
      await waitFor(() => new Set(baseSessions(runner)).size >= 2);
    } finally {
      await app.close();
    }
  });

  it("a review removed and added again starts from a new base session", async () => {
    const runner = agents();
    const { app, ctx } = await createApp("tok", { agents: runner });
    try {
      const first = await createDemo(app);
      await waitFor(() => baseSessions(runner).length >= 1);
      const firstBase = baseSessions(runner)[0]!;

      const removed = await app.inject({ method: "DELETE", url: `/api/reviews/${first}`, headers: authed });
      expect(removed.statusCode).toBe(200);
      // Remove forgets the review's sessions: no base is left to reuse.
      expect(ctx.sessions.baseKeys().filter((k) => k.startsWith(`${first}|`))).toEqual([]);

      const second = await createDemo(app);
      expect(second).not.toBe(first);
      await waitFor(() => baseSessions(runner).some((id) => id !== firstBase));
      expect(ctx.sessions.baseKeys().every((k) => !k.startsWith(`${first}|`))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("after a restart the rebuilt base holds an MCP URL the registry accepts (#68)", async () => {
    type App = Awaited<ReturnType<typeof createApp>>;
    /** Explain on a diff line (needs the base), then wait for the queue to drain. */
    async function explain({ app, ctx }: App, id: string, pick = 0): Promise<void> {
      const adds = ctx.reviews
        .getSnapshot(id)!
        .files.flatMap((f) => f.hunks.flatMap((h) => h.lines.filter((l) => l.kind === "add").map((l) => ({ file: f, line: l }))));
      const { file, line } = adds[pick]!;
      const res = await app.inject({
        method: "POST",
        url: `/api/reviews/${id}/actions`,
        headers: authed,
        payload: {
          kind: "explain",
          quote: line.text,
          anchor: { where: "diff-line", fileKey: file.fileKey, line: line.newLine },
        },
      });
      expect(res.statusCode).toBe(200);
      await waitFor(() => ctx.jobs.activeCount() === 0);
    }

    const db = openDatabase(":memory:");
    const runner1 = agents();
    const first = await createApp("tok", { agents: runner1, db });
    let id: string;
    let keys: string[];
    try {
      id = await createDemo(first.app);
      await waitFor(() => baseSessions(runner1).length >= 1 && first.ctx.jobs.activeCount() === 0);
      // Settle: the base for the review's final guide revision exists.
      await explain(first, id);
      await explain(first, id);
      keys = first.ctx.sessions.baseKeys();
    } finally {
      await first.app.close();
    }

    // New process over the same store: new registry, and an agent runner
    // that no longer knows the old base session.
    const runner2 = agents();
    const second = await createApp("tok", { agents: runner2, db });
    try {
      // A different line than the pre-restart explains: the stored
      // answer would be reused with no job (#10), and this test needs a
      // real job so the closed base is rebuilt on the new runner.
      await explain(second, id, 1);
      // Same base key as before the restart: the closed base was rebuilt.
      expect(second.ctx.sessions.baseKeys()).toEqual(keys);
      const base = baseSessions(runner2);
      expect(base.length).toBe(1);
      const url = runner2.mcpBySession.get(base[0]!)?.[0]?.url ?? "";
      const secret = url.slice(url.indexOf(MCP_ROUTE_PREFIX) + MCP_ROUTE_PREFIX.length);
      expect(secret).not.toBe("");
      expect(second.ctx.mcp.hasSession(secret)).toBe(true);
    } finally {
      await second.app.close();
    }
  });
});
