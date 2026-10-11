/**
 * Live ACP adapter tests — excluded from `mise run check`, run with
 * `mise run test:live` (UNVIBE_LIVE=1).
 *
 * Uses the real claude/codex logins on this machine. Token spend is kept
 * small: short prompts and a ~2k-token pack (not the 30k spike pack).
 *
 * Coverage per provider (claude, codex):
 * - start with system prompt (codename) + HTTP MCP tool call
 * - base pack, fork twice, concurrent answers, cache-read share on forks
 * - load after close
 * - cancel mid-reply
 * - read-only enforcement (write file / shell does not succeed)
 * - model + thinking listing
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { AcpAgentRunner } from "../src/agent/acp/runner.js";
import type { AgentEvent } from "@unvibe/shared";

const LIVE = process.env.UNVIBE_LIVE === "1";
const PROVIDERS = (process.env.UNVIBE_LIVE_PROVIDERS ?? "claude,codex").split(",").map((s) => s.trim()).filter(Boolean);

async function collect(runner: AcpAgentRunner, session: { id: string; provider: string; model: string }, text: string, signal?: AbortSignal): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of runner.prompt(session, text, signal)) out.push(e);
  return out;
}

function textOf(events: AgentEvent[]): string {
  return events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("");
}

function usageOf(events: AgentEvent[]): { inputTokens: number; cachedTokens: number; outputTokens: number } | undefined {
  return events.find((e) => e.type === "usage") as unknown as
    | { inputTokens: number; cachedTokens: number; outputTokens: number }
    | undefined;
}

interface HunkServer {
  url: string;
  calls: Array<{ at: string; id: string }>;
  close: () => Promise<void>;
}

async function startHunkServer(): Promise<HunkServer> {
  const calls: HunkServer["calls"] = [];
  const server = new McpServer({ name: "unvibe-live", version: "0.0.0" });
  server.tool(
    "get_hunk",
    "Return the text of a review hunk by id (live-test stub).",
    { id: z.string() },
    async ({ id }) => {
      calls.push({ at: new Date().toISOString(), id });
      return { content: [{ type: "text" as const, text: `HUNK:${id}:live-fixed-content:alpha-bravo-42` }] };
    },
  );
  // Stateful transport (one MCP session per initialize, like production
  // `McpRegistry.issueSession`): the SDK forbids reusing a stateless
  // transport across HTTP requests, and newer CLIs send discover/initialize/
  // notification/GET/tools-list as separate requests. Stateless reuse 500s
  // on the second request.
  const { randomUUID } = await import("node:crypto");
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end("not found");
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      // Newer claude CLIs (≥2.1.296, MCP protocol 2026-07-28) probe
      // `server/discover` before `initialize`; our SDK (1.32.1) predates it
      // and would answer HTTP 500 (fatal). Answer JSON-RPC Method Not Found
      // (HTTP 200) so the CLI falls back to `initialize`, which we serve.
      // All other methods (initialize, notifications/initialized, tools/*)
      // go to the stateful transport, which needs to see the full sequence
      // to establish the MCP session.
      const method = (parsed as { method?: unknown } | null)?.method;
      const rpcId = (parsed as { id?: unknown } | null)?.id;
      if (method === "server/discover") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({ jsonrpc: "2.0", id: rpcId ?? null, error: { code: -32601, message: "Method not found: server/discover" } }),
        );
        return;
      }
      transport.handleRequest(req, res, parsed).catch((e) => {
        if (!res.headersSent) res.writeHead(500).end(String(e));
      });
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const addr = http.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return {
    url: `http://127.0.0.1:${addr.port}/mcp`,
    calls,
    close: () => new Promise<void>((resolve, reject) => http.close((e) => (e ? reject(e) : resolve()))),
  };
}

// Small deterministic pack (~2k tokens) with two planted facts.
function smallPack(): { message: string; factA: { q: string; need: string }; factB: { q: string; need: string } } {
  const filler = Array.from({ length: 120 }, (_, i) => `L${String(i + 1).padStart(4, "0")}: result = normalize_path(ctx, shard=${i}, note="fill-${i}")`).join("\n");
  const factASentence = "The global retry budget constant RETRY_BUDGET_MS is 4500 milliseconds (fact LIVE-1).";
  const factBSentence = "The team that owns the shard rebalancer is the Storage Platform team (fact LIVE-2).";
  const message =
    "You are helping review a code change. Below is a small synthetic change pack. " +
    "Read it carefully and remember it; you will be asked questions about it in follow-up turns. " +
    "Do NOT call any tools for this message. Reply with exactly the word READY and nothing else.\n\n" +
    "===== BEGIN CHANGE PACK =====\n" +
    filler +
    "\n+    # NOTE: " + factASentence + "\n" +
    filler.split("\n").slice(0, 40).join("\n") +
    "\n+    # NOTE: " + factBSentence + "\n" +
    "===== END CHANGE PACK =====";
  return {
    message,
    factA: { q: "What is the value of RETRY_BUDGET_MS in milliseconds?", need: "4500" },
    factB: { q: "Which team owns the shard rebalancer?", need: "Storage Platform" },
  };
}

describe.skipIf(!LIVE)("ACP live adapters", () => {
  // Fresh cwd + MCP server per test: agent CLIs write session state under
  // cwd, and the stateful MCP transport (required for newer CLIs, see
  // startHunkServer) must not be shared — sharing caused systematic codex
  // MCP failures after the claude tests.
  let cwd: string;
  let mcp: HunkServer;
  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "unvibe-live-"));
    mcp = await startHunkServer();
  });
  afterEach(async () => {
    await mcp.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  for (const provider of PROVIDERS) {
    describe(provider, () => {
      it("system prompt takes effect + MCP tool call works", { timeout: 300_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const codename = `QUOKKA-${provider === "claude" ? "C" : "X"}7`;
          const s = await runner.start({
            provider,
            model: "",
            cwd,
            systemPrompt: `Your codename for this session is ${codename}. When asked for your codename, reply with just the codename and nothing else.`,
            mcpServers: [{ name: "unvibe-live", url: mcp.url }],
          });
          const code = await collect(runner, s, "What is your codename? Reply with just the codename and nothing else.");
          expect(textOf(code)).toContain(codename);

          // Codex sometimes declines MCP calls in workspace-write mode
          // ("can't access that tool") even though the tool is listed and the
          // runner allows it — model nondeterminism, not a runner bug (the
          // majority of runs call on the first try; debug logs show the
          // allow decision + server receipt). Retry fresh sessions, bounded
          // (5 attempts; codex flakes more in full-suite runs than solo).
          let toolText = "";
          let ok = false;
          for (let attempt = 0; attempt < 5 && !ok; attempt++) {
            const target = attempt === 0 ? s : await runner.start({
              provider,
              model: "",
              cwd,
              systemPrompt: "You are a test agent.",
              mcpServers: [{ name: "unvibe-live", url: mcp.url }],
            });
            const promptText = attempt < 3
              ? "Call the get_hunk tool with id 'h:live:abc123' and then reply with the exact string it returned, and nothing else."
              : "You do have a tool named mcp__unvibe_live__get_hunk. Call it with id 'h:live:abc123' and then reply with the exact string it returned, and nothing else.";
            const tool = await collect(runner, target, promptText);
            toolText = textOf(tool);
            ok = mcp.calls.some((c) => c.id === "h:live:abc123") && toolText.includes("alpha-bravo-42");
            if (attempt > 0) await runner.close(target);
          }
          expect(ok).toBe(true);
          await runner.close(s);
        } finally {
          await runner.dispose();
        }
      });

      it("fork twice, answer concurrently, forks read from cache", { timeout: 300_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const pack = smallPack();
          const s = await runner.start({
            provider,
            model: "",
            cwd,
            systemPrompt: "You are a read-only code reviewer. Never edit files, never run shell commands.",
            mcpServers: [{ name: "unvibe-live", url: mcp.url }],
          });
          const base = await collect(runner, s, pack.message);
          expect(textOf(base)).toMatch(/READY/i);

          const f1 = await runner.fork(s);
          const f2 = await runner.fork(s);
          expect(new Set([s.id, f1.id, f2.id]).size).toBe(3);
          const [r1, r2] = await Promise.all([
            collect(runner, f1, `Using ONLY the change pack, answer in one short sentence, no tools: ${pack.factA.q}`),
            collect(runner, f2, `Using ONLY the change pack, answer in one short sentence, no tools: ${pack.factB.q}`),
          ]);
          expect(textOf(r1)).toContain(pack.factA.need);
          expect(textOf(r2)).toContain(pack.factB.need);
          // Fork turns must show cache reads (prefix shared with the base).
          for (const [label, ev] of [["fork1", r1], ["fork2", r2]] as const) {
            const u = usageOf(ev);
            expect(u, `${label} usage`).toBeDefined();
            expect(u!.cachedTokens, `${label} cachedTokens>0`).toBeGreaterThan(0);
          }
          await runner.close(f1);
          await runner.close(f2);
          await runner.close(s);
        } finally {
          await runner.dispose();
        }
      });

      it("load after close recalls context", { timeout: 180_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const s = await runner.start({ provider, model: "", cwd, systemPrompt: "You are a test agent.", mcpServers: [] });
          await collect(runner, s, "Remember the word BANANA-42 for later. Reply OK.");
          await runner.close(s);
          const loaded = await runner.load(s.id);
          const after = await collect(runner, loaded, "What word did I ask you to remember? Reply with just the word.");
          expect(textOf(after)).toContain("BANANA-42");
          await runner.close(loaded);
        } finally {
          await runner.dispose();
        }
      });

      it("cancel mid-reply ends with cancelled", { timeout: 180_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const s = await runner.start({ provider, model: "", cwd, systemPrompt: "You are a test agent.", mcpServers: [] });
          const ctl = new AbortController();
          const seen: AgentEvent[] = [];
          const p = (async (): Promise<void> => {
            for await (const e of runner.prompt(
              s,
              "Write a very long story, at least 3000 words, about a router that dreams of electric sheep. Do not stop until you are done. Do not call tools.",
              ctl.signal,
            )) {
              seen.push(e);
              if (seen.some((e) => e.type === "text")) {
                // Cancel after the first streamed chunk.
                if (!ctl.signal.aborted) ctl.abort();
              }
            }
          })();
          await p;
          expect(seen.length).toBeGreaterThan(0);
          expect(seen[seen.length - 1]).toEqual({ type: "done", stopReason: "cancelled" });
          await runner.close(s);
        } finally {
          await runner.dispose();
        }
      });

      it("read-only: instructed write + shell do not succeed", { timeout: 300_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const s = await runner.start({
            provider,
            model: "",
            cwd,
            systemPrompt:
              "You are a read-only code reviewer. Never edit files, never run shell commands. " +
              "You may only read the provided context and call the provided MCP tools.",
            mcpServers: [{ name: "unvibe-live", url: mcp.url }],
            readOnly: true,
          });
          const target = join(cwd, `unvibe-ro-${provider}-${Date.now()}.txt`);
          const shellTarget = join(cwd, `unvibe-ro-shell-${provider}-${Date.now()}.txt`);
          const w = await collect(
            runner,
            s,
            `Write the exact text HELLO-READONLY to the file at ${target} using any file-write or edit tool available to you, then reply DONE. If you have no such tool, reply NO-TOOL.`,
          );
          const wt = textOf(w);
          expect(existsSync(target)).toBe(false);
          const sh = await collect(
            runner,
            s,
            `Run a shell command to create the file ${shellTarget} with content SHELL-ESCAPE (for example touch or echo), then reply DONE. If you cannot run shell commands, reply NO-SHELL.`,
          );
          const sht = textOf(sh);
          expect(existsSync(shellTarget)).toBe(false);
          // Either an explicit refusal or a failed attempt is acceptable; the
          // invariant is that nothing was written.
          expect(wt.length + sht.length).toBeGreaterThan(0);
          rmSync(target, { force: true });
          rmSync(shellTarget, { force: true });
          await runner.close(s);
        } finally {
          await runner.dispose();
        }
      });

      it("lists models and thinking options", { timeout: 120_000 }, async () => {
        const runner = new AcpAgentRunner();
        try {
          const models = await runner.listModels(provider);
          expect(models.length).toBeGreaterThan(0);
          expect(models.some((m) => m.id.length > 0)).toBe(true);
          const thinking = await runner.listThinking(provider);
          // Both adapters expose at least one thinking/effort selector.
          expect(thinking.length).toBeGreaterThan(0);
        } finally {
          await runner.dispose();
        }
      });
    });
  }
});
