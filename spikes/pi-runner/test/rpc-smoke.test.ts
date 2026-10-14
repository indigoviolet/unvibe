/**
 * Route 2b, RPC instead of SDK: the `pi` CLI in `--mode rpc` as a child
 * process, pointed at the fake ChatGPT backend. Checks what the RPC route
 * offers (system prompt and tool flags, events, usage, clone, abort) and
 * what one process costs (startup time, memory). One RPC process holds one
 * active session, so Unvibe would need a process per concurrent session.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fakeChatGptToken, startFakeCodex, type FakeCodex } from "./fake-codex.ts";

const PI_CLI = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "bundle",
  "cli.js",
);

let fake: FakeCodex;
let dir: string;

beforeAll(async () => {
  fake = await startFakeCodex();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike-pi-rpc-"));
  const agent = path.join(dir, "agent");
  fs.mkdirSync(agent);
  fs.mkdirSync(path.join(dir, "worktree"));
  fs.writeFileSync(path.join(dir, "worktree", "AGENTS.md"), "INJECTED-AGENTS-MARKER\n");
  fs.writeFileSync(
    path.join(agent, "auth.json"),
    JSON.stringify({ "openai-codex": { type: "oauth", access: fakeChatGptToken(), refresh: "r", expires: 4102444800000, accountId: "acct-fake" } }),
  );
  fs.writeFileSync(path.join(agent, "models.json"), JSON.stringify({ providers: { "openai-codex": { baseUrl: fake.baseUrl } } }));
  fs.writeFileSync(
    path.join(agent, "settings.json"),
    JSON.stringify({ transport: "sse", cacheWarming: "off", enableInstallTelemetry: false, retry: { enabled: false }, compaction: { enabled: false } }),
  );
});

afterAll(async () => {
  await fake.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

class Rpc {
  events: Record<string, unknown>[] = [];
  private buf = "";
  private waiters: (() => void)[] = [];
  private n = 0;
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (d: Buffer) => {
      this.buf += d.toString("utf8");
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).replace(/\r$/, "");
        this.buf = this.buf.slice(i + 1);
        if (line) this.events.push(JSON.parse(line) as Record<string, unknown>);
      }
      for (const w of this.waiters.splice(0)) w();
    });
  }
  async until(pred: (e: Record<string, unknown>) => boolean, from = 0): Promise<Record<string, unknown>> {
    for (;;) {
      const hit = this.events.slice(from).find(pred);
      if (hit) return hit;
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
  async call(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = `c${++this.n}`;
    const from = this.events.length;
    this.child.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
    return this.until((e) => e["id"] === id && e["type"] === "response", from);
  }
}

it("drives a Pi RPC process: prompt, usage, clone, abort", async () => {
  const t0 = Date.now();
  const child = spawn(
    process.execPath,
    [
      PI_CLI,
      "--mode", "rpc",
      "--model", "openai-codex/gpt-6.1-sol",
      "--system-prompt", "UNVIBE-L0",
      "--no-context-files", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes",
      "--tools", "read,ls",
      "--session-dir", path.join(dir, "sessions"),
      "--offline",
    ],
    {
      cwd: path.join(dir, "worktree"),
      env: { ...process.env, HOME: dir, PI_CODING_AGENT_DIR: path.join(dir, "agent"), PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0" },
    },
  );
  const stderr: string[] = [];
  child.stderr.on("data", (d: Buffer) => stderr.push(d.toString()));
  const rpc = new Rpc(child);
  try {
    const state = await rpc.call({ type: "get_state" });
    const startupMs = Date.now() - t0;
    expect(state["success"]).toBe(true);

    fake.script.push({ text: "ready", cached: 50 });
    const from = rpc.events.length;
    await rpc.call({ type: "prompt", message: "base pack" });
    await rpc.until((e) => e["type"] === "agent_settled", from);
    const req = fake.requests.at(-1)!.body;
    expect(req.instructions.startsWith("UNVIBE-L0")).toBe(true);
    expect(JSON.stringify(req)).not.toContain("INJECTED-AGENTS-MARKER");
    expect((req.tools ?? []).map((t) => t.name).sort()).toEqual(["ls", "read"]);
    const end = rpc.events
      .slice(from)
      .find((e) => e["type"] === "message_end" && (e["message"] as { role?: string }).role === "assistant") as
      | { message: { usage: { cacheRead: number; cacheWrite: number } } }
      | undefined;
    expect(end?.message.usage.cacheRead).toBe(50);

    const stats = await rpc.call({ type: "get_session_stats" });
    expect((stats["data"] as { tokens: { cacheRead: number } }).tokens.cacheRead).toBe(50);

    // `clone` replaces the process's active session with a copy (Pi's fork);
    // the old session is no longer the active one in this process.
    const before = (state["data"] as { sessionId: string }).sessionId;
    expect((await rpc.call({ type: "clone" }))["success"]).toBe(true);
    const after = ((await rpc.call({ type: "get_state" }))["data"] as { sessionId: string }).sessionId;
    expect(after).not.toBe(before);
    fake.script.push({ text: "from the clone" });
    const f2 = rpc.events.length;
    await rpc.call({ type: "prompt", message: "explain" });
    await rpc.until((e) => e["type"] === "agent_settled", f2);
    expect(fake.requests.at(-1)!.body.prompt_cache_key).toBe(after); // a fresh cache key, not the base's

    fake.script.push({ hangMs: 10_000 });
    const f3 = rpc.events.length;
    await rpc.call({ type: "prompt", message: "hang" });
    await rpc.until((e) => e["type"] === "message_update", f3);
    const ta = Date.now();
    await rpc.call({ type: "abort" });
    const settled = await rpc.until((e) => e["type"] === "agent_settled", f3);
    expect(settled["aborted"]).toBe(true);
    const abortMs = Date.now() - ta;

    const rssKb = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)]).toString().trim());
    console.log("[spike] rpc process:", { startupMs, abortMs, rssMb: Math.round(rssKb / 1024) });
  } finally {
    child.stdin.end();
    await new Promise((r) => child.once("exit", r));
    if (stderr.length) console.log("[spike] rpc stderr:", stderr.join("").slice(0, 400));
  }
});
