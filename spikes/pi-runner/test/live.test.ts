/**
 * LIVE (spends subscription usage): the native Pi runner on the bundled demo
 * with a real ChatGPT login. Skipped unless UNVIBE_PI_LIVE=1.
 *
 *   UNVIBE_PI_LIVE=1 UNVIBE_PI_AGENT_DIR=<dir holding Pi's auth.json> \
 *   UNVIBE_PI_UPSTREAM=openai-codex|openai UNVIBE_PI_MODEL=<id> \
 *     vitest run --config spikes/pi-runner/vitest.config.ts test/live.test.ts
 *
 * Five model turns in total: the base pack, an Explain fork and an Ask fork
 * (sharing the base's cache key), one Explain fork with its own cache key,
 * and one more turn after a simulated restart. Results (timings, usage,
 * tool calls, the start of each answer) go to results/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent, Session } from "../../../packages/shared/src/agent.ts";
import { PiAgentRunner, PI_PROVIDER, type PiUpstream } from "../src/runner.ts";
import { startDemo, type Demo } from "./demo.ts";

const LIVE = process.env.UNVIBE_PI_LIVE === "1";
const AGENT_DIR = process.env.UNVIBE_PI_AGENT_DIR ?? "";
const UPSTREAM = (process.env.UNVIBE_PI_UPSTREAM ?? "openai-codex") as PiUpstream;
const MODEL = process.env.UNVIBE_PI_MODEL ?? "gpt-6.1-sol";

interface TurnResult {
  label: string;
  session: string;
  ms: number;
  firstTextMs: number | null;
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number; requests: number };
  tools: string[];
  stop: string;
  error?: string;
  answerStart: string;
}

const results: TurnResult[] = [];
let demo: Demo;
let dir: string;

async function turn(runner: PiAgentRunner, s: Session, label: string, text: string): Promise<TurnResult> {
  const t0 = performance.now();
  let first: number | null = null;
  const r: TurnResult = {
    label,
    session: s.id,
    ms: 0,
    firstTextMs: null,
    usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 },
    tools: [],
    stop: "",
    answerStart: "",
  };
  let answer = "";
  for await (const e of runner.prompt(s, text) as AsyncIterable<AgentEvent>) {
    if (e.type === "text") {
      first ??= performance.now() - t0;
      answer += e.delta;
    } else if (e.type === "tool" && e.status === "start") r.tools.push(e.name);
    else if (e.type === "usage") {
      r.usage.input += e.inputTokens;
      r.usage.cacheRead += e.cachedReadTokens;
      r.usage.cacheWrite += e.cachedWriteTokens;
      r.usage.output += e.outputTokens;
      r.usage.requests += 1;
    } else if (e.type === "done") r.stop = e.stopReason;
    else if (e.type === "error") r.error = e.message;
  }
  r.ms = Math.round(performance.now() - t0);
  r.firstTextMs = first === null ? null : Math.round(first);
  r.answerStart = answer.slice(0, 300);
  results.push(r);
  console.log(`[live] ${label}:`, { ...r, answerStart: r.answerStart.slice(0, 80) });
  return r;
}

describe.skipIf(!LIVE)("LIVE native Pi runner on the bundled demo", () => {
  beforeAll(async () => {
    if (!fs.existsSync(path.join(AGENT_DIR, "auth.json"))) throw new Error("UNVIBE_PI_AGENT_DIR has no auth.json");
    demo = await startDemo();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike-pi-live-"));
    fs.mkdirSync(path.join(dir, "worktree"));
  });

  afterAll(async () => {
    const out = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "results");
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, `live-${UPSTREAM}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify({ upstream: UPSTREAM, model: MODEL, toolCalls: demo?.toolCalls(), results }, null, 2));
    console.log("[live] wrote", file);
    await demo?.close();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("base, two forks on the shared cache key, one fork on its own key, one turn after restart", async () => {
    const make = (extra: Partial<ConstructorParameters<typeof PiAgentRunner>[0]> = {}) =>
      new PiAgentRunner({ agentDir: AGENT_DIR, sessionDir: path.join(dir, "sessions"), upstream: UPSTREAM, ...extra });
    let runner = make();
    console.log("[live] login:", await runner.loginStatus(), "models:", await runner.listModels());
    const base = await runner.start({
      provider: PI_PROVIDER,
      model: MODEL,
      cwd: path.join(dir, "worktree"),
      systemPrompt: demo.systemPrompt,
      mcpServers: demo.mcpFor("base"),
    });
    const b = await turn(runner, base, "base pack", demo.pack);
    expect(b.error).toBeUndefined();

    const explain = await turn(runner, await runner.fork!(base), "explain (fork, shared key)", demo.explain);
    const ask = await turn(runner, await runner.fork!(base), "ask (fork, shared key)", demo.ask);
    expect(ask.tools.length).toBeGreaterThan(0);

    const ownKey = make({ shareCacheKey: false });
    await turn(ownKey, await ownKey.fork!(base), "explain (fork, own key)", demo.explain);
    await ownKey.dispose();
    await runner.dispose();

    runner = make({ reissueMcp: () => demo.mcpFor("reloaded") });
    const forkId = results.find((r) => r.label.startsWith("explain (fork, shared"))!.session;
    await turn(runner, await runner.load(forkId), "follow-up after restart", "In one sentence: what does the regex match?");
    await runner.dispose();
    expect(explain.error).toBeUndefined();
  }, 600_000);
});
