/**
 * SPIKE(#124) live fork-cache re-measure — Codex only, tiny spend.
 * Excluded from `mise run check`; run via the sanctioned live path:
 *
 *   UNVIBE_LIVE=1 UNVIBE_ALLOW_LIVE_AGENT=1 UNVIBE_LIVE_PROVIDERS=codex \
 *     npx vitest run test/live-124-fork-cache.test.ts --testTimeout 300000
 *
 * One base session with a ~2k-token pack, then 5 sequential fork turns on
 * identical state (same base, same system prompt, same MCP servers —
 * production passes all three on session/fork since #124/#174). Prints
 * one JSON line per turn with the usage split (uncached / cache-read /
 * cache-write / output) so the spike write-up can quote counts only.
 * No repository content: the pack is synthetic filler + planted facts.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { AcpAgentRunner } from "../src/agent/acp/runner.js";
import type { AgentEvent } from "@unvibe/shared";

const LIVE = process.env.UNVIBE_LIVE === "1";

function usageOf(events: AgentEvent[]) {
  return events.find((e) => e.type === "usage") as
    | { inputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; outputTokens: number }
    | undefined;
}
function textOf(events: AgentEvent[]): string {
  return events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
}
async function collect(runner: AcpAgentRunner, session: { id: string; provider: string; model: string }, text: string): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of runner.prompt(session, text)) out.push(e);
  return out;
}

/** One-connection-per-client MCP stub (mirrors production after #174). */
async function startHunkServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const makeServer = (): McpServer => {
    const server = new McpServer({ name: "unvibe-live", version: "0.0.0" });
    server.tool("get_hunk", "Return the text of a review hunk by id (live-test stub).", { id: z.string() },
      async ({ id }) => ({ content: [{ type: "text" as const, text: `HUNK:${id}:live-fixed-content` }] }));
    return server;
  };
  const { randomUUID } = await import("node:crypto");
  const connections = new Map<string, StreamableHTTPServerTransport>();
  const makeTransport = (): StreamableHTTPServerTransport => {
    const holder: { transport?: StreamableHTTPServerTransport } = {};
    holder.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => { if (holder.transport) connections.set(sid, holder.transport); },
      onsessionclosed: (sid) => { connections.delete(sid); },
    });
    return holder.transport;
  };
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp") { res.writeHead(404).end("not found"); return; }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try { parsed = body ? JSON.parse(body) : undefined; } catch { res.writeHead(400).end("bad json"); return; }
      const method = (parsed as { method?: unknown } | null)?.method;
      const rpcId = (parsed as { id?: unknown } | null)?.id;
      if (method === "server/discover") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: rpcId ?? null, error: { code: -32601, message: "Method not found: server/discover" } }));
        return;
      }
      if (method === "initialize") {
        const transport = makeTransport();
        void makeServer().connect(transport).then(() => transport.handleRequest(req, res, parsed))
          .catch((e) => { if (!res.headersSent) res.writeHead(500).end(String(e)); });
        return;
      }
      const sid = req.headers["mcp-session-id"];
      const transport = connections.get(Array.isArray(sid) ? sid[0] : sid ?? "");
      if (!transport) { res.writeHead(404).end("session not found"); return; }
      transport.handleRequest(req, res, parsed).catch((e) => { if (!res.headersSent) res.writeHead(500).end(String(e)); });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const addr = http.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return { url: `http://127.0.0.1:${addr.port}/mcp`, close: () => new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))) };
}

function pack(): string {
  const filler = Array.from({ length: 120 }, (_, i) => `L${String(i + 1).padStart(4, "0")}: result = normalize_path(ctx, shard=${i}, note="fill-${i}")`).join("\n");
  return (
    "You are helping review a code change. Below is a small synthetic change pack. " +
    "Read it carefully and remember it; you will be asked questions about it in follow-up turns. " +
    "Do NOT call any tools for this message. Reply with exactly the word READY and nothing else.\n\n" +
    "===== BEGIN CHANGE PACK =====\n" + filler +
    "\n+    # NOTE: The global retry budget constant RETRY_BUDGET_MS is 4500 milliseconds (fact LIVE-1).\n" +
    filler.split("\n").slice(0, 40).join("\n") +
    "\n+    # NOTE: The team that owns the shard rebalancer is the Storage Platform team (fact LIVE-2).\n" +
    "===== END CHANGE PACK ====="
  );
}

describe.skipIf(!LIVE)("SPIKE #124 Codex fork cache", () => {
  it("base + 5 fork turns on identical state", { timeout: 300_000 }, async () => {
    const cwd = mkdtempSync(join(tmpdir(), "unvibe-124-"));
    const mcp = await startHunkServer();
    const runner = new AcpAgentRunner();
    try {
      const model = process.env.UNVIBE_124_MODEL ?? "gpt-5.6-terra";
      const base = await runner.start({
        provider: "codex", model, cwd,
        systemPrompt: "You are a read-only code reviewer. Never edit files, never run shell commands.",
        mcpServers: [{ name: "unvibe-live", url: mcp.url }],
      });
      const t0 = Date.now();
      const baseEv = await collect(runner, base, pack());
      console.log(`[124] ${JSON.stringify({ turn: "base", ms: Date.now() - t0, usage: usageOf(baseEv), reply: textOf(baseEv).slice(0, 20) })}`);
      expect(textOf(baseEv)).toMatch(/READY/i);

      const questions = [
        "Using ONLY the change pack, answer in one short sentence, no tools: What is the value of RETRY_BUDGET_MS in milliseconds?",
        "Using ONLY the change pack, answer in one short sentence, no tools: Which team owns the shard rebalancer?",
        "Using ONLY the change pack, answer in one short sentence, no tools: What function appears most often in the pack?",
        "Using ONLY the change pack, answer in one short sentence, no tools: How many milliseconds is the retry budget?",
        "Using ONLY the change pack, answer in one short sentence, no tools: Name the team that owns the shard rebalancer.",
      ];
      for (let i = 0; i < questions.length; i++) {
        const fork = await runner.fork(base);
        const t = Date.now();
        const ev = await collect(runner, fork, questions[i]!);
        const u = usageOf(ev);
        console.log(`[124] ${JSON.stringify({ turn: `fork${i + 1}`, ms: Date.now() - t, usage: u, replyChars: textOf(ev).length })}`);
        expect(u, `fork${i + 1} usage`).toBeDefined();
        await runner.close(fork);
      }
      await runner.close(base);
    } finally {
      await runner.dispose();
      await mcp.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
