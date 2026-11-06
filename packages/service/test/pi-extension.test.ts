/**
 * Pi extension bridge tests (issue #348).
 *
 * The extension (`PI_EXTENSION_SOURCE`, plain JS loaded by real pi with
 * `-e`) bridges Unvibe's review tools over MCP streamable HTTP. A reader
 * turn goes silent until pi's 10-minute timeout when a bridge call never
 * settles, so the extension must bound every call and must never reject a
 * tool promise: failures come back as tool errors the model can react to.
 *
 * These tests load the real generated source (proving it parses — the
 * template-literal escaping broke once already) against a stub MCP HTTP
 * server: normal call, JSON-RPC error, and a hanging call with a short
 * `UNVIBE_PI_TOOL_TIMEOUT_MS`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import { PI_EXTENSION_SOURCE } from "../src/agent/pi/extension.js";

interface RegisteredTool {
  name: string;
  execute: (toolCallId: string, params: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}

let dir = "";
let servers: Server[] = [];
let savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  "UNVIBE_PI_MCP_SERVERS",
  "UNVIBE_PI_CACHE_KEY",
  "UNVIBE_PI_READONLY",
  "UNVIBE_PI_CWD",
  "UNVIBE_PI_TOOL_TIMEOUT_MS",
  "UNVIBE_PI_TOOL_LOG",
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unvibe-pi-ext-"));
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.UNVIBE_PI_READONLY = "0";
  process.env.UNVIBE_PI_CWD = dir;
  delete process.env.UNVIBE_PI_CACHE_KEY;
  delete process.env.UNVIBE_PI_TOOL_TIMEOUT_MS;
  delete process.env.UNVIBE_PI_TOOL_LOG;
});

afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        }),
    ),
  );
  servers = [];
  if (dir) rmSync(dir, { recursive: true, force: true });
});

type CallBehavior =
  | { kind: "ok"; text: string }
  | { kind: "rpc-error"; message: string }
  | { kind: "hang" };

/** Stub MCP mount: initialize/list/call over plain JSON (no SSE needed). */
async function startStubMcp(behavior: CallBehavior): Promise<string> {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (d: Buffer) => (body += d.toString()));
    req.on("end", () => {
      let msg: { method?: string; id?: unknown; params?: { name?: string } } = {};
      try {
        msg = JSON.parse(body) as typeof msg;
      } catch {
        res.statusCode = 400;
        res.end("bad json");
        return;
      }
      res.setHeader("mcp-session-id", "stub-sid");
      if (msg.method === "notifications/initialized") {
        res.statusCode = 202;
        res.end();
        return;
      }
      const reply = (result: unknown): void => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? 1, result }));
      };
      if (msg.method === "initialize") {
        reply({ protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stub", version: "0" } });
      } else if (msg.method === "tools/list") {
        reply({ tools: [{ name: "get_hunk", description: "stub hunk", inputSchema: { type: "object", properties: {} } }] });
      } else if (msg.method === "tools/call") {
        if (behavior.kind === "hang") return; // never answer: the timeout must fire
        if (behavior.kind === "rpc-error") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? 1, error: { code: -32602, message: behavior.message } }));
          return;
        }
        reply({ content: [{ type: "text", text: behavior.text }], isError: false });
      } else {
        res.statusCode = 400;
        res.end("unknown method");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/mcp/secret`;
}

/** Load the real generated source and run it against the stub mount. */
async function loadBridge(mcpUrl: string): Promise<Map<string, RegisteredTool>> {
  process.env.UNVIBE_PI_MCP_SERVERS = JSON.stringify([{ name: "stub", url: mcpUrl }]);
  const file = join(dir, "unvibe-pi-stub.mjs");
  writeFileSync(file, PI_EXTENSION_SOURCE);
  const mod = (await import(pathToFileURL(file).href)) as { default: (pi: unknown) => Promise<void> };
  const tools = new Map<string, RegisteredTool>();
  await mod.default({
    on: () => {},
    registerTool: (t: RegisteredTool) => {
      tools.set(t.name, t);
    },
  });
  return tools;
}

describe("pi extension MCP bridge (issue #348)", () => {
  it("passes a normal tool call through unchanged", async () => {
    const tools = await loadBridge(await startStubMcp({ kind: "ok", text: "h:conn:9f2c" }));
    const tool = tools.get("get_hunk");
    expect(tool).toBeDefined();
    const out = await tool!.execute("c1", { id: "h:conn:9f2c" });
    expect(out).toEqual({ content: [{ type: "text", text: "h:conn:9f2c" }], details: undefined });
  });

  it("a failing MCP call returns a tool error instead of rejecting", async () => {
    const tools = await loadBridge(await startStubMcp({ kind: "rpc-error", message: "unknown hunk: h:bogus:0000" }));
    const out = await tools.get("get_hunk")!.execute("c1", { id: "h:bogus:0000" });
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/unknown hunk/);
  });

  it("a hanging MCP call fails with a tool timeout error, fast", async () => {
    process.env.UNVIBE_PI_TOOL_TIMEOUT_MS = "300";
    const tools = await loadBridge(await startStubMcp({ kind: "hang" }));
    const started = Date.now();
    const out = await tools.get("get_hunk")!.execute("c1", { id: "h:conn:9f2c" });
    const elapsed = Date.now() - started;
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/timed out after 300ms/);
    expect(elapsed).toBeLessThan(8000);
  });

  it("the tool-call log records the call", async () => {
    const logFile = join(dir, "tools.jsonl");
    process.env.UNVIBE_PI_TOOL_LOG = logFile;
    const tools = await loadBridge(await startStubMcp({ kind: "ok", text: "ok" }));
    await tools.get("get_hunk")!.execute("c1", { id: "h:conn:9f2c" });
    const { readFileSync } = await import("node:fs");
    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const call = lines.find((l) => l.tool === "get_hunk");
    expect(call).toMatchObject({ tool: "get_hunk", ok: true });
    expect(call.size).toBeGreaterThan(0);
    expect(call.end).toBeGreaterThanOrEqual(call.start);
  });
});
