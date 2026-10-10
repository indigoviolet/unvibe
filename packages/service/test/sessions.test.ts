/**
 * Session-manager tests (PRD §9.2, §12) with a scripted stub runner —
 * never a real agent.
 */
import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentRunner, McpServerConfig, Session } from "@unvibe/shared";
import { ManualClock } from "../src/jobs/clock.js";
import { RetryableError } from "../src/jobs/errors.js";
import { baseKeyString, SessionManager, type BaseBuild, type BaseKey } from "../src/sessions/manager.js";
import { SessionStore } from "../src/sessions/store.js";
import { openDatabase } from "../src/store/db.js";

interface Script {
  match: string;
  events: AgentEvent[];
}

class StubRunner implements AgentRunner {
  private nextId = 1;
  readonly known = new Map<string, Session>();
  readonly prompts: { sessionId: string; text: string }[] = [];
  readonly starts: { provider: string; model: string; systemPrompt: string; mcpServers: McpServerConfig[] }[] = [];
  readonly forks: string[] = [];
  readonly loads: string[] = [];
  readonly closed: string[] = [];

  constructor(
    private scripts: Script[] = [],
    private opts: { fork?: boolean; failLoad?: boolean; failStart?: boolean } = {},
  ) {
    if (opts.fork === undefined) this.opts.fork = true;
    if (this.opts.fork) {
      this.fork = async (session: Session): Promise<Session> => {
        this.forks.push(session.id);
        return this.spawn(session.provider, session.model);
      };
    }
  }

  fork?: (session: Session, opts?: { atMessage?: string }) => Promise<Session>;

  private spawn(provider: string, model: string): Session {
    const s: Session = { id: `s${this.nextId++}`, provider, model };
    this.known.set(s.id, s);
    return s;
  }

  async start(o: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  }): Promise<Session> {
    if (this.opts.failStart) throw new Error("start failed");
    this.starts.push({ provider: o.provider, model: o.model, systemPrompt: o.systemPrompt, mcpServers: o.mcpServers });
    return this.spawn(o.provider, o.model);
  }

  async load(sessionId: string): Promise<Session> {
    this.loads.push(sessionId);
    if (this.opts.failLoad) throw new Error("load failed");
    const s = this.known.get(sessionId);
    if (!s) throw new Error(`unknown session ${sessionId}`);
    return s;
  }

  async *prompt(session: Session, text: string): AsyncIterable<AgentEvent> {
    this.prompts.push({ sessionId: session.id, text });
    const script = this.scripts.find((s) => text.includes(s.match));
    for (const e of script?.events ?? [{ type: "done", stopReason: "end_turn" } satisfies AgentEvent]) {
      yield e;
    }
  }

  async close(session: Session): Promise<void> {
    this.closed.push(session.id);
  }
}

const KEY: BaseKey = { reviewVersion: "r1@v1", guideRevision: "g1", provider: "claude", model: "m" };

function basePack(): string {
  return "L1+L1b+L2 BASE PACK";
}

function build(runnerScripts: Script[] = [], over: Partial<BaseBuild> = {}): { mgr: SessionManager; runner: StubRunner; opts: BaseBuild } {
  const runner = new StubRunner(runnerScripts.length > 0 ? runnerScripts : [
    { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end" }] },
    { match: "hello", events: [{ type: "text", delta: "hi there" }, { type: "done", stopReason: "end" }] },
  ]);
  const mgr = new SessionManager({ runner, clock: new ManualClock(1000) });
  const opts: BaseBuild = {
    key: KEY,
    cwd: "/repo",
    systemPrompt: "sys",
    mcpServers: [{ name: "unvibe", url: "http://127.0.0.1:1/api/mcp/abc" }],
    pack: basePack(),
    ...over,
  };
  return { mgr, runner, opts };
}

describe("getBase", () => {
  it("builds once under concurrent demand", async () => {
    const { mgr, runner, opts } = build();
    const [a, b] = await Promise.all([mgr.getBase(opts), mgr.getBase(opts)]);
    expect(runner.starts).toHaveLength(1);
    expect(a.session.id).toBe(b.session.id);
    expect(a.fresh).toBe(true);
    expect(b.fresh).toBe(false);
    // Base pack sent, "ready" awaited.
    expect(runner.prompts).toHaveLength(1);
    expect(runner.prompts[0].text).toBe(basePack());
    const again = await mgr.getBase(opts);
    expect(again.fresh).toBe(false);
    expect(runner.starts).toHaveLength(1);
  });

  it("one base per model", async () => {
    const { mgr, runner, opts } = build();
    await mgr.getBase(opts);
    await mgr.getBase({ ...opts, key: { ...KEY, model: "m2" } });
    expect(runner.starts).toHaveLength(2);
  });

  it("throws when the base never says ready", async () => {
    const runner = new StubRunner([
      { match: "BASE", events: [{ type: "text", delta: "hmm" }, { type: "done", stopReason: "end" }] },
    ]);
    const mgr = new SessionManager({ runner });
    await expect(
      mgr.getBase({ key: KEY, cwd: "/", systemPrompt: "s", mcpServers: [], pack: "BASE" }),
    ).rejects.toThrow(/ready/);
  });

  it("maps retryable agent errors to RetryableError", async () => {
    const runner = new StubRunner([
      { match: "BASE", events: [{ type: "error", message: "slow", retryable: true }] },
    ]);
    const mgr = new SessionManager({ runner });
    await expect(
      mgr.getBase({ key: KEY, cwd: "/", systemPrompt: "s", mcpServers: [], pack: "BASE" }),
    ).rejects.toBeInstanceOf(RetryableError);
  });
});

describe("fork vs fallback equivalence", () => {
  it("fork path uses runner.fork and sends only the conversation", async () => {
    const { mgr, runner, opts } = build();
    const base = await mgr.getBase(opts);
    const forked = await mgr.forkConversation(base.key, "hello-directions");
    expect(forked.viaFork).toBe(true);
    expect(runner.forks).toEqual([base.session.id]);
    const onFork = runner.prompts.filter((p) => p.sessionId === forked.session.id);
    expect(onFork.map((p) => p.text)).toEqual(["hello-directions"]);
    expect(forked.text).toBe("hi there");
  });

  it("fallback sends a byte-identical base pack first, then the message", async () => {
    const runner = new StubRunner(
      [
        { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end" }] },
        { match: "hello", events: [{ type: "text", delta: "hi there" }, { type: "done", stopReason: "end" }] },
      ],
      { fork: false },
    );
    expect(runner.fork).toBeUndefined();
    const mgr = new SessionManager({ runner });
    const opts: BaseBuild = { key: KEY, cwd: "/r", systemPrompt: "sys", mcpServers: [], pack: basePack() };
    const base = await mgr.getBase(opts);
    const conv = await mgr.forkConversation(base.key, "hello-directions");
    expect(conv.viaFork).toBe(false);
    const onConv = runner.prompts.filter((p) => p.sessionId === conv.session.id);
    expect(onConv).toHaveLength(2);
    expect(onConv[0].text).toBe(basePack()); // byte-identical to the base pack
    expect(onConv[1].text).toBe("hello-directions");
    expect(conv.text).toBe("hi there"); // same reply shape as the fork path
  });

  it("fan-out warms the base once, then forks in parallel", async () => {
    const { mgr, runner, opts } = build();
    const results = await mgr.fanOut(opts, ["hello-1", "hello-2", "hello-3"]);
    expect(runner.starts).toHaveLength(1);
    expect(runner.forks).toHaveLength(3);
    expect(results).toHaveLength(3);
    expect(new Set(results.map((r) => r.session.id)).size).toBe(3);
  });
});

describe("log batches and last-seen", () => {
  it("appends batches as new turns and tracks per-session seq", async () => {
    const { mgr, runner, opts } = build();
    const base = await mgr.getBase(opts);
    const packPrompts = runner.prompts.length;
    await mgr.appendLogBatch(base.key, { seq: 7, text: "LOG BATCH" });
    await mgr.appendLogBatch(base.key, { seq: 9, text: "LOG BATCH 2" });
    expect(runner.prompts.length).toBe(packPrompts + 2);
    const conv = await mgr.forkConversation(base.key, "hello");
    expect(mgr.lastSeen(conv.session.id)).toBe(9);
    mgr.markSeen(conv.session.id, 12);
    expect(mgr.lastSeen(conv.session.id)).toBe(12);
    mgr.markSeen(conv.session.id, 11); // never moves backwards
    expect(mgr.lastSeen(conv.session.id)).toBe(12);
  });
});

describe("idle close and reopen", () => {
  it("sweepIdle closes idle sessions; ensureConversation reopens with load", async () => {
    const clock = new ManualClock(0);
    const runner = new StubRunner([
      { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end" }] },
      { match: "hello", events: [{ type: "text", delta: "hi" }, { type: "done", stopReason: "end" }] },
    ]);
    const mgr = new SessionManager({ runner, clock });
    const opts: BaseBuild = { key: KEY, cwd: "/r", systemPrompt: "s", mcpServers: [], pack: basePack() };
    const base = await mgr.getBase(opts);
    const conv = await mgr.forkConversation(base.key, "hello");
    await clock.advance(10 * 60 * 1000);
    const { closed } = await mgr.sweepIdle(clock.now(), 5 * 60 * 1000);
    expect(new Set(closed)).toEqual(new Set([base.session.id, conv.session.id]));
    const reopened = await mgr.ensureConversation(conv.session.id);
    expect(reopened.id).toBe(conv.session.id);
    expect(runner.loads).toEqual([conv.session.id]);
    expect(runner.starts).toHaveLength(1); // no rebuild needed
  });

  it("a failed load rebuilds from the base", async () => {
    const clock = new ManualClock(0);
    const runner = new StubRunner(
      [
        { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end" }] },
        { match: "hello", events: [{ type: "text", delta: "hi" }, { type: "done", stopReason: "end" }] },
      ],
      { failLoad: true },
    );
    const mgr = new SessionManager({ runner, clock });
    const opts: BaseBuild = { key: KEY, cwd: "/r", systemPrompt: "s", mcpServers: [], pack: basePack() };
    const base = await mgr.getBase(opts);
    const conv = await mgr.forkConversation(base.key, "hello");
    await clock.advance(10 * 60 * 1000);
    await mgr.sweepIdle(clock.now(), 5 * 60 * 1000);
    const rebuilt = await mgr.ensureConversation(conv.session.id);
    expect(rebuilt.id).not.toBe(conv.session.id);
    // Both the conversation and its closed base go through load first…
    expect(runner.loads).toEqual([conv.session.id, base.session.id]);
    // …then the base is rebuilt and the conversation re-forked from it.
    expect(runner.starts.length).toBeGreaterThan(1);
    expect(runner.forks).toEqual([base.session.id, expect.any(String)]);
  });
});

describe("invalidate and restore", () => {
  it("invalidateBase closes and drops the base; pruneBases keeps the set", async () => {
    const { mgr, runner, opts } = build();
    const base = await mgr.getBase(opts);
    await mgr.invalidateBase(base.key);
    expect(runner.closed).toContain(base.session.id);
    const rebuilt = await mgr.getBase(opts);
    expect(rebuilt.session.id).not.toBe(base.session.id);

    const other: BaseKey = { ...KEY, guideRevision: "g2" };
    await mgr.getBase({ ...opts, key: other });
    await mgr.pruneBases(new Set([baseKeyString(other)]));
    await expect(mgr.forkConversation(base.key, "hello")).rejects.toThrow(/unknown base/);
  });

  it("restores closed sessions after a restart and reopens lazily", async () => {
    const db = openDatabase(":memory:");
    const store = new SessionStore(db);
    const runner = new StubRunner([
      { match: "BASE PACK", events: [{ type: "text", delta: "ready" }, { type: "done", stopReason: "end" }] },
      { match: "hello", events: [{ type: "text", delta: "hi" }, { type: "done", stopReason: "end" }] },
    ]);
    const mgr1 = new SessionManager({ runner, store });
    const opts: BaseBuild = { key: KEY, cwd: "/r", systemPrompt: "s", mcpServers: [], pack: basePack() };
    const base = await mgr1.getBase(opts);
    const conv = await mgr1.forkConversation(base.key, "hello");

    // New process, same store + same (reconnected) runner.
    const mgr2 = new SessionManager({ runner, store });
    mgr2.restore();
    const startsBefore = runner.starts.length;
    const again = await mgr2.getBase(opts);
    expect(again.session.id).toBe(base.session.id);
    expect(runner.starts.length).toBe(startsBefore); // reopened via load
    expect(runner.loads).toContain(base.session.id);
    const convAgain = await mgr2.ensureConversation(conv.session.id);
    expect(convAgain.id).toBe(conv.session.id);
  });
});
