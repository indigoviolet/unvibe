/**
 * Native pi runner tests (issue #279, route 2: `pi --mode rpc`).
 *
 * The runner drives a fake pi RPC process (`./fake-pi.mjs`, plain Node
 * speaking pi's JSONL protocol — no pi install, no login, no network
 * beyond loopback). The review tools are a stub MCP mount in this file.
 *
 * Covered, mirroring the spike's offline checks:
 * - the runner streams a reply; per-request usages aggregate with the
 *   #125 cache split intact;
 * - scripted tool calls go through the runner's MCP env to the mount and
 *   stream tool start/end with the result;
 * - a fork passes the base's id as UNVIBE_PI_CACHE_KEY (the extension
 *   stamps it onto the provider payload; verified against real pi);
 * - resume after a restart keeps history; cancel settles as cancelled;
 * - read-only spawns `--tools read,ls,…`, full access the wider list;
 * - dead post-restart MCP secrets fail `load` fast (manager rebuilds).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "@unvibe/shared";
import { PiAgentRunner } from "../src/agent/pi/pi-runner.js";
import { probePiLogin } from "../src/readiness/checks.js";
import { RealCommandRunner } from "../src/exec/runner.js";

const FAKE_PI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fake-pi.mjs");

interface StubMcp {
  url: string;
  calls: { tool: string; args: unknown }[];
  close(): Promise<void>;
}

function startStubMcp(): Promise<StubMcp> {
  const calls: { tool: string; args: unknown }[] = [];
  const sessions = new Set<string>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const send = (obj: unknown, sessionId?: string) => {
        if (sessionId) res.setHeader("mcp-session-id", sessionId);
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(obj));
      };
      if (req.method === "DELETE") {
        const sid = req.headers["mcp-session-id"];
        if (typeof sid === "string") sessions.delete(sid);
        res.writeHead(200).end("{}");
        return;
      }
      let body: { jsonrpc?: string; id?: unknown; method?: string; params?: { name?: string; arguments?: unknown } };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400).end("bad json");
        return;
      }
      if (body.method === "initialize") {
        const id = `sess-${Math.random().toString(36).slice(2)}`;
        sessions.add(id);
        send({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "stub", version: "0" } } }, id);
        return;
      }
      const sid = req.headers["mcp-session-id"];
      if (typeof sid !== "string" || !sessions.has(sid)) {
        res.writeHead(404).end("unknown session");
        return;
      }
      if (body.method === "notifications/initialized") {
        res.writeHead(202).end();
        return;
      }
      if (body.method === "tools/list") {
        send({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: [
              {
                name: "get_hunk",
                description: "Return one diff hunk.",
                inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
              },
            ],
          },
        });
        return;
      }
      if (body.method === "tools/call") {
        calls.push({ tool: body.params?.name ?? "", args: body.params?.arguments ?? {} });
        send({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: `stub hunk ${(body.params?.arguments as { id?: string } | undefined)?.id ?? "?"}` }] },
        });
        return;
      }
      send({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unknown method" } });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/mcp-test`,
        calls,
        close: () =>
          new Promise<void>((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

let dir = "";
let sessionDir = "";
let logFile = "";
let stub: StubMcp | null = null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-pi-runner-"));
  sessionDir = path.join(dir, "sessions");
  logFile = path.join(dir, "spawns.log");
  stub = await startStubMcp();
});

afterEach(async () => {
  await stub?.close();
  stub = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeRunner(extraEnv: Record<string, string> = {}): PiAgentRunner {
  return new PiAgentRunner({
    binPath: FAKE_PI,
    sessionDir,
    env: { ...process.env, UNVIBE_FAKE_PI_LOG: logFile, ...extraEnv },
  });
}

function mcpServers() {
  return [{ name: "unvibe", url: stub!.url }];
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const textOf = (evs: AgentEvent[]): string => evs.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");

function spawnLines(): string[] {
  try {
    return fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("pi runner over a fake pi RPC process", () => {
  it("streams a reply and reports usage with the cache split (#125)", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "hello there", cached: 100 }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      expect(s.provider).toBe("pi");
      const evs = await collect(runner.prompt(s, "pack"));
      expect(textOf(evs)).toBe("hello there");
      const usage = evs.find((e) => e.type === "usage");
      expect(usage).toMatchObject({ type: "usage", cachedReadTokens: 100, cachedWriteTokens: 0 });
      expect(usage?.type === "usage" && usage.inputTokens).toBeGreaterThan(0);
      expect(usage?.type === "usage" && usage.outputTokens).toBeGreaterThan(0);
      expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    } finally {
      await runner.dispose();
    }
  });

  it("calls a review tool through the mount and streams tool events", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ call: "get_hunk", args: { id: "h:abc" } }, { text: "done" }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const evs = await collect(runner.prompt(s, "show it"));
      const tools = evs.filter((e) => e.type === "tool");
      expect(tools).toEqual([
        { type: "tool", name: "get_hunk", status: "start", id: "call-1", detail: '{"id":"h:abc"}' },
        { type: "tool", name: "get_hunk", status: "end", id: "call-1", detail: '{"id":"h:abc"}', result: "stub hunk h:abc" },
      ]);
      expect(stub!.calls).toEqual([{ tool: "get_hunk", args: { id: "h:abc" } }]);
      expect(textOf(evs)).toBe("done");
      // Two provider requests (tool call + text) aggregate into one usage.
      const usages = evs.filter((e) => e.type === "usage");
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({ type: "usage", cachedReadTokens: 5 });
    } finally {
      await runner.dispose();
    }
  });

  it("passes the system prompt and the read-only tool list to the child", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "UNVIBE-SYS", mcpServers: mcpServers() });
      await collect(runner.prompt(s, "hi"));
      const spawns = spawnLines().filter((l) => l.includes("--mode"));
      expect(spawns.length).toBeGreaterThan(0);
      const argv = JSON.parse(spawns.find((l) => l.includes("--system-prompt"))!.split("argv=")[1].split(" cachekey=")[0]) as string[];
      expect(argv).toContain("--system-prompt");
      expect(argv[argv.indexOf("--system-prompt") + 1]).toBe("UNVIBE-SYS");
      const tools = argv[argv.indexOf("--tools") + 1].split(",");
      expect(tools).toEqual(expect.arrayContaining(["read", "ls", "get_hunk", "get_code", "search_review", "resolve", "pin_context"]));
      expect(tools).not.toContain("bash");
      expect(tools).not.toContain("edit");
    } finally {
      await runner.dispose();
    }
  });

  it("full access spawns the wider tool list (issue #160)", async () => {
    // Full access scrubs UNVIBE_* from the child env (like the ACP
    // adapters), so the fake's own log channel is gone here: capture argv
    // with a wrapper binary instead.
    const wrapper = path.join(dir, "pi-wrapper.sh");
    fs.writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logFile}.argv"\nexec "${process.execPath}" "${FAKE_PI}" "$@"\n`, { mode: 0o755 });
    const runner = new PiAgentRunner({
      binPath: wrapper,
      sessionDir,
      env: { ...process.env, UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) },
    });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers(), readOnly: false });
      await collect(runner.prompt(s, "hi"));
      const lines = fs.readFileSync(`${logFile}.argv`, "utf8").split("\n").filter((l) => l.includes("--tools"));
      const last = lines.at(-1)!;
      const toolsFlag = last.split("--tools")[1].trim().split(" ")[0];
      const tools = toolsFlag.split(",");
      expect(tools).toEqual(expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find", "ls", "get_hunk"]));
    } finally {
      await runner.dispose();
    }
  });

  it("a fork passes the base's id as the cache key and keeps working", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "base-ready" }, { text: "fork-reply" }]) });
    try {
      const base = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      expect(textOf(await collect(runner.prompt(base, "pack")))).toBe("base-ready");
      const fork = await runner.fork!(base);
      expect(fork.id).not.toBe(base.id);
      // The fork child saw the base's id as its cache-key override.
      const forkSpawn = spawnLines().find((l) => l.includes("--fork"));
      expect(forkSpawn).toBeDefined();
      expect(forkSpawn).toContain(`cachekey=${base.id}`);
      expect(textOf(await collect(runner.prompt(fork, "explain")))).toBe("fork-reply");
    } finally {
      await runner.dispose();
    }
  });

  it("resume after a restart keeps history", async () => {
    const script = JSON.stringify([{ text: "base-ready" }, { text: "fork-reply" }, { history: true }]);
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: script });
    let forkId = "";
    try {
      const base = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      await collect(runner.prompt(base, "pack"));
      const fork = await runner.fork!(base);
      forkId = fork.id;
      await collect(runner.prompt(fork, "explain"));
      await runner.dispose();
    } finally {
      await runner.dispose().catch(() => {});
    }
    // A new process on the same data dir reopens the fork.
    const runner2 = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: script });
    try {
      const reopened = await runner2.load(forkId);
      expect(reopened.id).toBe(forkId);
      const evs = await collect(runner2.prompt(reopened, "follow-up"));
      // base user+assistant, fork user+assistant, follow-up user = 5.
      expect(textOf(evs)).toBe("history:5");
    } finally {
      await runner2.dispose();
    }
  });

  it("cancels a running turn through the AbortSignal", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ hang: true }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const ac = new AbortController();
      const seen: AgentEvent[] = [];
      for await (const e of runner.prompt(s, "hang", ac.signal)) {
        seen.push(e);
        if (e.type === "text") ac.abort();
      }
      expect(seen.at(-1)).toEqual({ type: "done", stopReason: "cancelled" });
    } finally {
      await runner.dispose();
    }
  });

  it("a missing session file fails load fast (manager rebuilds)", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      await runner.close(s);
      // Delete the pi session file out from under the sidecar.
      const sidecar = JSON.parse(fs.readFileSync(path.join(sessionDir, "unvibe", `${s.id}.json`), "utf8")) as { sessionFile: string };
      fs.rmSync(sidecar.sessionFile, { force: true });
      await expect(runner.load(s.id)).rejects.toThrow(/gone|no record|unknown/i);
    } finally {
      await runner.dispose();
    }
  });

  it("dead post-restart MCP secrets fail load fast", async () => {
    const dead = await startStubMcp();
    const deadUrl = dead.url;
    await dead.close();
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) });
    try {
      // A sidecar pointing at a dead mount: load must throw, not run tool-less.
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: [{ name: "unvibe", url: stub!.url }] });
      await runner.dispose();
      const sidecarPath = path.join(sessionDir, "unvibe", `${s.id}.json`);
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8"));
      sidecar.mcpServers = [{ name: "unvibe", url: deadUrl }];
      fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
      const runner2 = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) });
      try {
        await expect(runner2.load(s.id)).rejects.toThrow(/MCP/i);
      } finally {
        await runner2.dispose();
      }
    } finally {
      await runner.dispose().catch(() => {});
    }
  });

  it("rejects unknown models and non-pi providers", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "openai-codex", id: "m1", name: "M1" }]) });
    try {
      await expect(runner.start({ provider: "pi", model: "nope", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() })).rejects.toThrow(/does not offer/);
      await expect(runner.start({ provider: "codex", model: "m1", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() })).rejects.toThrow(/serves provider "pi" only/);
    } finally {
      await runner.dispose();
    }
  });

  it("lists live models with a static fallback, and [] without a binary", async () => {
    const runner = makeRunner({
      UNVIBE_FAKE_PI_MODELS: JSON.stringify([
        { provider: "openai-codex", id: "live-a", name: "Live A" },
        { provider: "openai", id: "live-b", name: "Live B" },
        { provider: "other", id: "live-c" },
      ]),
    });
    try {
      expect(await runner.listModels("pi")).toEqual([
        { id: "live-a", name: "Live A" },
        { id: "live-b", name: "Live B" },
      ]);
      expect(await runner.listModels("codex")).toEqual([]);
    } finally {
      await runner.dispose();
    }
    const noBin = new PiAgentRunner({ binPath: path.join(dir, "no-such-pi"), sessionDir, env: { ...process.env } });
    expect(noBin.isAvailable()).toBe(false);
    expect(await noBin.listModels("pi")).toEqual([]);
    await noBin.dispose();
  });

  it("falls back to the static model list when the live listing is empty", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_MODELS: "[]" });
    try {
      const models = await runner.listModels("pi");
      expect(models.map((m) => m.id)).toEqual([
        "gpt-6.1-sol",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-6-astra",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
      ]);
    } finally {
      await runner.dispose();
    }
  });

  it("answers the effort levels pi offers", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_THINKING: JSON.stringify(["low", "high"]) });
    try {
      const thinking = await runner.listThinking("pi");
      expect(thinking).toEqual([{ configId: "thinking", current: "", options: [{ value: "low" }, { value: "high" }] }]);
      expect(await runner.listThinking("codex")).toEqual([]);
    } finally {
      await runner.dispose();
    }
  });

  it("reports pi login state through pi's own status command", async () => {
    const login = await probePiLogin(new RealCommandRunner(), FAKE_PI, 10000);
    expect(login.codex.ready).toBe(true);
  });

  it("reports a logged-out pi as not ready", async () => {
    process.env.UNVIBE_FAKE_PI_AUTH = "not_ready";
    try {
      const login = await probePiLogin(new RealCommandRunner(), FAKE_PI, 10000);
      expect(login.codex.ready).toBe(false);
      expect(login.codex.status).toBe("not_ready");
      expect(login.openai.ready).toBe(false);
    } finally {
      delete process.env.UNVIBE_FAKE_PI_AUTH;
    }
  });
});
