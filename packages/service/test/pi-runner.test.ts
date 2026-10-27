/**
 * Native pi runner tests (issue #279, route 2: `pi --mode rpc`).
 *
 * The runner drives a fake pi RPC process (`./fake-pi.mjs`, plain Node
 * speaking pi's JSONL protocol — no pi install, no login, no network
 * beyond loopback). The review tools are the real MCP mount
 * (`McpRegistry` + the service's streamable-HTTP route), so tools/list
 * and tools/call go through the exact SSE transport the live run uses
 * (issue #279 follow-up: a plain-JSON stub hid the SSE parse failure).
 *
 * Covered, mirroring the spike's offline checks:
 * - the runner streams a reply; per-request usages aggregate with the
 *   #125 cache split intact;
 * - provider errors surface as errors (never silent empty text), and a
 *   turn with no text deltas still yields the reply from message content
 *   (the live #279 symptom);
 * - scripted tool calls go through the runner's MCP env to the mount and
 *   stream tool start/end with the result;
 * - a fork passes the base's id as UNVIBE_PI_CACHE_KEY (the extension
 *   stamps it onto the provider payload; verified against real pi);
 * - resume after a restart keeps history; cancel settles as cancelled;
 * - read-only spawns `--tools read,ls,…`, full access the wider list;
 * - dead post-restart MCP secrets fail `load` fast (manager rebuilds).
 */
import Fastify from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "@unvibe/shared";
import { PiAgentRunner } from "../src/agent/pi/pi-runner.js";
import { McpRegistry, registerMcp, type McpReviewData } from "../src/mcp/index.js";
import { CompositeAgentRunner } from "../src/agent/pi/composite.js";
import type { AcpAgentRunner } from "../src/agent/acp/index.js";
import { probePiLogin } from "../src/readiness/checks.js";
import { FakeCommandRunner, RealCommandRunner } from "../src/exec/runner.js";
import { piCheck } from "../src/readiness/checks.js";

const FAKE_PI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fake-pi.mjs");

/** Review fixture served by the real MCP mount (mirrors mcp.test.ts). */
const REVIEW: McpReviewData = {
  reviewId: "r1",
  headSha: "abc123",
  hunks: [
    {
      fileKey: "conn",
      path: "src/conn.py",
      contentHash: "9f2c",
      header: "@@ -140,7 +147,7 @@",
      newStart: 147,
      newEnd: 149,
      text: " context foo\n-old line\n+new line",
    },
  ],
  cards: [{ id: "c-central", title: "Central change", text: "retries with backoff in src/conn.py" }],
  annotations: [{ id: "a1", type: "thread", anchorSummary: "src/conn.py:148", text: "why backoff?" }],
  contributions: [{ id: "k1", sourceSession: "s1", text: "fact: backoff is exponential" }],
  description: [{ id: "d1", text: "this PR adds backoff" }],
};

interface RealMcp {
  url: string;
  registry: McpRegistry;
  close(): Promise<void>;
}

/** The real MCP mount: a registry serving the fixture behind the service's
 * own streamable-HTTP route. tools/list and tools/call go through the
 * exact SSE transport the live run uses. */
async function startRealMcp(): Promise<RealMcp> {
  const registry = new McpRegistry({
    reader: {
      getReview: async (id) => (id === REVIEW.reviewId ? REVIEW : null),
      getWorktreePath: () => dir,
    },
    commands: new FakeCommandRunner(),
  });
  const app = Fastify({ logger: false });
  await registerMcp(app, registry);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const issued = registry.issueSession(REVIEW.reviewId, "sess-pi-test", "session");
  return {
    url: `http://127.0.0.1:${port}${issued.path}`,
    registry,
    close: async () => {
      app.server.closeAllConnections();
      await app.close();
    },
  };
}

let dir = "";
let sessionDir = "";
let logFile = "";
let mount: RealMcp | null = null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-pi-runner-"));
  sessionDir = path.join(dir, "sessions");
  logFile = path.join(dir, "spawns.log");
  mount = await startRealMcp();
});

afterEach(async () => {
  await mount?.close();
  mount = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeRunner(extraEnv: Record<string, string> = {}): PiAgentRunner {
  return new PiAgentRunner({
    binPath: FAKE_PI,
    sessionDir,
    // The fake reports its version from UNVIBE_FAKE_PI_VERSION (default
    // 0.0.0-fake, i.e. too old on purpose): tests that need a supported
    // pi opt into a new one here; the too-old tests use the default.
    env: { ...process.env, UNVIBE_FAKE_PI_LOG: logFile, UNVIBE_FAKE_PI_VERSION: "9.9.9-fake", ...extraEnv },
  });
}

function mcpServers() {
  return [{ name: "unvibe", url: mount!.url }];
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
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ call: "get_hunk", args: { id: "h:conn:9f2c" } }, { text: "done" }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const evs = await collect(runner.prompt(s, "show it"));
      const tools = evs.filter((e) => e.type === "tool");
      // The result text comes from the real mount (registry dispatch),
      // through the real SSE transport, not a canned stub reply.
      // toolCallIds mirror real pi 1.4.0 (`call_1|fc_1`); the end event
      // carries no args, like the real `tool_execution_end`.
      const hunkText = "h:conn:9f2c\nfile: src/conn.py\n@@ -140,7 +147,7 @@\n147:  context foo\n148: -old line\n149: +new line";
      expect(tools).toEqual([
        { type: "tool", name: "get_hunk", status: "start", id: "call_1|fc_1", detail: '{"id":"h:conn:9f2c"}' },
        { type: "tool", name: "get_hunk", status: "end", id: "call_1|fc_1", result: hunkText },
      ]);
      expect(textOf(evs)).toBe("done");
      // Two provider requests (tool call + text) aggregate into one usage.
      const usages = evs.filter((e) => e.type === "usage");
      expect(usages).toHaveLength(1);
      expect(usages[0]).toMatchObject({ type: "usage", cachedReadTokens: 5 });
    } finally {
      await runner.dispose();
    }
  });

  it("surfaces a provider error event as an error, not empty text", async () => {
    // Real pi reports provider failures as assistant message_start/end +
    // turn_end with stopReason "error" (captured offline against pi 1.4.0).
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ error: "Could not parse your authentication token. Please try signing in again." }]) });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const evs = await collect(runner.prompt(s, "pack"));
      expect(textOf(evs)).toBe("");
      const err = evs.find((e) => e.type === "error");
      expect(err).toMatchObject({ type: "error", message: expect.stringMatching(/authentication token/i) });
      // Auth failures are not retryable (same rule as the ACP adapters).
      expect(err?.type === "error" && err.retryable).toBe(false);
      expect(evs.at(-1)?.type).toBe("error");
    } finally {
      await runner.dispose();
    }
  });

  it("recovers text from message content when no deltas stream", async () => {
    // The live #279 symptom: a successful turn that settles with no text
    // deltas must still yield the reply from the authoritative content.
    const raw: unknown[] = [];
    const runner = new PiAgentRunner({
      binPath: FAKE_PI,
      sessionDir,
      env: { ...process.env, UNVIBE_FAKE_PI_LOG: logFile, UNVIBE_FAKE_PI_VERSION: "9.9.9-fake", UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "silent reply", noDeltas: true }]) },
      onRpcEvent: (e) => raw.push(e),
    });
    try {
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const evs = await collect(runner.prompt(s, "pack"));
      expect(textOf(evs)).toBe("silent reply");
      expect(evs.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
      // The tap saw the real-shaped stream (framing, deltas absent here,
      // content-bearing end, turn_end, full agent_end, settled).
      const types = raw.map((e) => (e as { type: string }).type);
      expect(types).toContain("message_start");
      expect(types).toContain("message_end");
      expect(types).toContain("turn_end");
      expect(types).toContain("agent_settled");
      expect(types.filter((t) => t === "message_update").length).toBe(0);
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
    // adapters), so the fake's own version/mode vars are gone here: the
    // wrapper re-exports the version a new pi would report on its own.
    const wrapper = path.join(dir, "pi-wrapper.sh");
    fs.writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logFile}.argv"\nUNVIBE_FAKE_PI_VERSION=9.9.9-fake exec "${process.execPath}" "${FAKE_PI}" "$@"\n`, { mode: 0o755 });
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
    const dead = await startRealMcp();
    const deadUrl = dead.url;
    await dead.close();
    const runner = makeRunner({ UNVIBE_FAKE_PI_SCRIPT: JSON.stringify([{ text: "ok" }]) });
    try {
      // A sidecar pointing at a dead mount: load must throw, not run tool-less.
      const s = await runner.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: [{ name: "unvibe", url: mount!.url }] });
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

  it("an older pi is not offered: listModels is empty and start refuses", async () => {
    // Default fake version (0.0.0-fake) is older than PI_MIN_VERSION.
    const old = new PiAgentRunner({ binPath: FAKE_PI, sessionDir, env: { ...process.env, UNVIBE_FAKE_PI_LOG: logFile } });
    try {
      expect(await old.isSupported()).toBe(false);
      expect(await old.listModels("pi")).toEqual([]);
      expect(await old.listThinking("pi")).toEqual([]);
      await expect(
        old.start({ provider: "pi", model: "fake-model", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() }),
      ).rejects.toThrow(/needs pi ≥ 1\.4\.0/);
    } finally {
      await old.dispose();
    }
  });

  it("composite providers() hides pi when its version is too old", async () => {
    const acp = {} as unknown as AcpAgentRunner;
    const withNew = new CompositeAgentRunner(
      acp,
      new PiAgentRunner({ binPath: FAKE_PI, sessionDir, env: { ...process.env, UNVIBE_FAKE_PI_VERSION: "1.4.0" } }),
    );
    const withOld = new CompositeAgentRunner(acp, new PiAgentRunner({ binPath: FAKE_PI, sessionDir, env: { ...process.env } }));
    try {
      expect(await withNew.providers()).toContain("pi");
      expect(await withOld.providers()).toEqual(["claude", "codex"]);
    } finally {
      await withNew.dispose();
      await withOld.dispose();
    }
  });

  it("piCheck reports an installed-but-too-old pi with the upgrade", async () => {
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-pi-tool-"));
    const toolBin = path.join(toolDir, "pi");
    fs.writeFileSync(toolBin, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: toolBin, args: ["--version"], stdout: "pi 1.2.0\n", stderr: "", code: 0 });
    try {
      const check = await piCheck({ pathValue: toolDir, runner });
      expect(check.status).toBe("warning");
      expect(check.summary).toContain("1.2.0");
      expect(check.summary).toContain("too old");
      expect(check.fix).toContain("Upgrade pi to 1.4.0 or later");
    } finally {
      fs.rmSync(toolDir, { recursive: true, force: true });
    }
  });

  it("piCheck reports a current logged-in pi as ready", async () => {
    const toolDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-pi-tool-"));
    const toolBin = path.join(toolDir, "pi");
    fs.writeFileSync(toolBin, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const runner = new FakeCommandRunner();
    runner.enqueue({ cmd: toolBin, args: ["--version"], stdout: "pi 1.4.0\n", stderr: "", code: 0 });
    runner.enqueue({
      cmd: toolBin,
      args: ["auth", "check", "--provider", "openai-codex", "--json"],
      stdout: JSON.stringify({ status: "ready", provider: "openai-codex" }),
      stderr: "",
      code: 0,
    });
    runner.enqueue({
      cmd: toolBin,
      args: ["auth", "check", "--provider", "openai", "--json"],
      stdout: JSON.stringify({ status: "not_ready", provider: "openai", reason: "credentials_not_configured" }),
      stderr: "",
      code: 0,
    });
    try {
      const check = await piCheck({ pathValue: toolDir, runner });
      expect(check.status).toBe("ok");
      expect(check.summary).toContain("logged in (openai-codex)");
    } finally {
      fs.rmSync(toolDir, { recursive: true, force: true });
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

  it("starts a static-list model on the provider the live listing names", async () => {
    // pi offers gpt-6.1-sol under "openai" on an API-key login; the static
    // list's "openai-codex" must not win (live #279 run: "No API key found").
    const runner = makeRunner({ UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "openai", id: "gpt-6.1-sol", name: "Sol" }]) });
    try {
      await runner.start({ provider: "pi", model: "gpt-6.1-sol", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const line = spawnLines().find((l) => l.includes("--system-prompt"))!;
      const argv = JSON.parse(line.split("argv=")[1].split(" cachekey=")[0]) as string[];
      expect(argv[argv.indexOf("--provider") + 1]).toBe("openai");
    } finally {
      await runner.dispose();
    }
  });

  it("starts a non-OpenAI model on the provider pi names for it", async () => {
    const runner = makeRunner({ UNVIBE_FAKE_PI_MODELS: JSON.stringify([{ provider: "meta", id: "muse-x", name: "Muse X" }]) });
    try {
      await runner.start({ provider: "pi", model: "muse-x", cwd: dir, systemPrompt: "SYS", mcpServers: mcpServers() });
      const line = spawnLines().find((l) => l.includes("--system-prompt"))!;
      const argv = JSON.parse(line.split("argv=")[1].split(" cachekey=")[0]) as string[];
      expect(argv[argv.indexOf("--provider") + 1]).toBe("meta");
    } finally {
      await runner.dispose();
    }
  });

  it("lists live models with a static fallback, and [] without a binary", async () => {
    const runner = makeRunner({
      UNVIBE_FAKE_PI_MODELS: JSON.stringify([
        { provider: "openai-codex", id: "live-a", name: "Live A" },
        { provider: "openai", id: "live-b", name: "Live B" },
        { provider: "meta", id: "live-c" },
        { provider: "openai", id: "live-a", name: "Live A" },
      ]),
    });
    try {
      // Every provider pi offers is listed; a shared id appears once.
      expect(await runner.listModels("pi")).toEqual([
        { id: "live-a", name: "Live A" },
        { id: "live-b", name: "Live B" },
        { id: "live-c" },
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
