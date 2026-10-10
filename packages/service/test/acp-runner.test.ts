import { describe, expect, it } from "vitest";
import { AcpAgentRunner } from "../src/agent/acp/runner.js";
import type { AgentEvent } from "@unvibe/shared";
import { createFakeState, fakeTransportFactory } from "./fake-acp.js";

async function collect(runner: AcpAgentRunner, session: { id: string; provider: string; model: string }, text: string, signal?: AbortSignal): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of runner.prompt(session, text, signal)) out.push(e);
  return out;
}

describe("AcpAgentRunner over fake ACP agent", () => {
  it("maps text, tools, usage and done", async () => {
    const state = createFakeState([
      {
        match: "hello",
        chunks: [
          { text: "hi " },
          { toolStart: { id: "t1", title: "mcp__test__get_hunk" } },
          { text: "there" },
          { toolEnd: { id: "t1", title: "mcp__test__get_hunk" } },
        ],
        usage: { inputTokens: 4, cachedReadTokens: 100, cachedWriteTokens: 10, outputTokens: 8 },
        stopReason: "end_turn",
      },
    ]);
    const runner = new AcpAgentRunner({
      factories: { claude: fakeTransportFactory(state), codex: fakeTransportFactory(state) },
    });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "sys", mcpServers: [] });
    const events = await collect(runner, s, "say hello");
    expect(events[0]).toEqual({ type: "text", delta: "hi " });
    expect(events).toContainEqual({ type: "tool", name: "mcp__test__get_hunk", status: "start" });
    expect(events).toContainEqual({ type: "text", delta: "there" });
    expect(events).toContainEqual({ type: "tool", name: "mcp__test__get_hunk", status: "end" });
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toEqual({ type: "usage", inputTokens: 4, cachedTokens: 110, outputTokens: 8 });
    expect(events[events.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    await runner.dispose();
  });

  it("aggregates background model_usage (titling) into usage", async () => {
    const state = createFakeState([
      {
        match: "bg",
        chunks: [{ text: "ok" }],
        usage: { inputTokens: 4, cachedReadTokens: 100, outputTokens: 8 },
        modelUsage: [
          { model: "main-model", inputTokens: 4, cachedInputTokens: 100, outputTokens: 8 },
          { model: "titling-model", inputTokens: 61600, cachedInputTokens: 0, outputTokens: 19 },
        ],
      },
    ]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const events = await collect(runner, s, "bg please");
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toEqual({ type: "usage", inputTokens: 61604, cachedTokens: 100, outputTokens: 27 });
    await runner.dispose();
  });

  it("fork resumes (Claude quirk) and supports atMessage", async () => {
    const state = createFakeState([{ match: "q", chunks: [{ text: "ans" }] }]);
    state.forkNeedsResume = true;
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const base = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    await collect(runner, base, "q base");
    const fork = await runner.fork(base, { atMessage: "msg-123" });
    expect(fork.id).not.toBe(base.id);
    // fork() auto-resumed so the first prompt works
    expect(state.resumeCalls).toContain(fork.id);
    expect(state.forkCalls[0]).toMatchObject({ from: base.id, atMessage: "msg-123" });
    const events = await collect(runner, fork, "q forked");
    expect(events[events.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    // Concurrent forks answer independently
    const fork2 = await runner.fork(base);
    const [r1, r2] = await Promise.all([collect(runner, fork, "q one"), collect(runner, fork2, "q two")]);
    expect(r1[r1.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    expect(r2[r2.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    await runner.dispose();
  });

  it("prompt on a stale fork surfaces retryable resume error, then succeeds", async () => {
    const state = createFakeState([{ match: "q", chunks: [{ text: "ans" }] }]);
    state.forkNeedsResume = true;
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const base = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const fork = await runner.fork(base);
    // Simulate a stale fork that missed its resume.
    state.sessions.get(fork.id)!.resumed = false;
    const first = await collect(runner, fork, "q attempt");
    const err = first.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { retryable: boolean }).retryable).toBe(true);
    const second = await collect(runner, fork, "q retry");
    expect(second[second.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    await runner.dispose();
  });

  it("load after close drains replay history", async () => {
    const state = createFakeState([{ match: "q", chunks: [{ text: "fresh" }] }]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    await runner.close(s);
    const loaded = await runner.load(s.id);
    expect(loaded.id).toBe(s.id);
    const events = await collect(runner, loaded, "q again");
    const texts = events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta);
    expect(texts).not.toContain("[replay]");
    expect(texts).toContain("fresh");
    await runner.dispose();
  });

  it("cancel via AbortSignal ends with cancelled", async () => {
    const state = createFakeState([{ match: "long", chunks: [{ text: "never" }], delayMs: 2000 }]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const ctl = new AbortController();
    const seen: AgentEvent[] = [];
    const p = (async (): Promise<void> => {
      for await (const e of runner.prompt(s, "long story", ctl.signal)) seen.push(e);
    })();
    await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    await p;
    expect(seen[seen.length - 1]).toEqual({ type: "done", stopReason: "cancelled" });
    expect(state.cancelled.has(s.id) || state.promptCalls.length > 0).toBe(true);
    await runner.dispose();
  });

  it("permission policy allows MCP + reads, denies shell/edits", async () => {
    const state = createFakeState([
      { match: "mcp-probe", permissionProbe: { title: "mcp__test__get_hunk" }, chunks: [{ text: "mcp ok" }] },
      { match: "read-probe", permissionProbe: { title: "Read" }, chunks: [{ text: "read ok" }] },
      { match: "shell-probe", permissionProbe: { title: "Bash" }, chunks: [{ text: "denied" }] },
      { match: "edit-probe", permissionProbe: { title: "Edit" }, chunks: [{ text: "denied" }] },
    ]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({
      provider: "claude",
      model: "default",
      cwd: "/tmp",
      systemPrompt: "s",
      mcpServers: [{ name: "test", url: "http://127.0.0.1:9/mcp" }],
    });
    await collect(runner, s, "mcp-probe");
    await collect(runner, s, "read-probe");
    await collect(runner, s, "shell-probe");
    await collect(runner, s, "edit-probe");
    // Codex dotted spelling resolves to the same server.
    const { isOurMcpTool } = await import("../src/agent/acp/permissions.js");
    expect(isOurMcpTool("mcp.test.get_hunk", undefined, ["test"])).toBe(true);
    expect(isOurMcpTool("mcp__test__get_hunk", undefined, ["test"])).toBe(true);
    expect(isOurMcpTool("mcp.other.get_hunk", undefined, ["test"])).toBe(false);
    const byTitle = new Map(state.permissionOutcomes.map((o) => [o.title, o]));
    expect(byTitle.get("mcp__test__get_hunk")?.outcome).toBe("selected");
    expect(byTitle.get("mcp__test__get_hunk")?.optionId).toBe("allow-once");
    expect(byTitle.get("Read")?.outcome).toBe("selected");
    expect(byTitle.get("Bash")?.outcome).toBe("selected");
    expect(byTitle.get("Bash")?.optionId).toBe("reject");
    expect(byTitle.get("Edit")?.optionId).toBe("reject");
    await runner.dispose();
  });

  it("correlates empty-title approvals by toolCallId (Codex workspace-write)", async () => {
    const state = createFakeState([
      {
        match: "ww-mcp",
        correlatedProbe: { toolCallId: "exec-1", title: "mcp.test.get_hunk" },
        chunks: [{ text: "ok" }],
      },
      {
        match: "ww-evil",
        correlatedProbe: { toolCallId: "exec-2", title: "Edit files" },
        chunks: [{ text: "no" }],
      },
    ]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({
      provider: "claude",
      model: "default",
      cwd: "/tmp",
      systemPrompt: "s",
      mcpServers: [{ name: "test", url: "http://127.0.0.1:9/mcp" }],
    });
    await collect(runner, s, "ww-mcp probe");
    await collect(runner, s, "ww-evil probe");
    const byTitle = new Map(state.permissionOutcomes.map((o) => [o.title, o]));
    expect(byTitle.get("mcp.test.get_hunk")?.optionId).toBe("allow-once");
    expect(byTitle.get("Edit files")?.optionId).toBe("reject");
    await runner.dispose();
  });

  it("classifies adapter errors as retryable or not", async () => {
    const state = createFakeState([
      { match: "limited", error: "rate limit exceeded, retry later" },
      { match: "authfail", error: "auth required: login expired" },
    ]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const r1 = await collect(runner, s, "limited please");
    expect(r1.find((e) => e.type === "error")).toMatchObject({ retryable: true });
    const r2 = await collect(runner, s, "authfail please");
    expect(r2.find((e) => e.type === "error")).toMatchObject({ retryable: false });
    await runner.dispose();
  });

  it("crash drops the transport and the next use restarts (sessions survive)", async () => {
    const state = createFakeState([{ match: "q", chunks: [{ text: "alive" }] }]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    runner.simulateCrash("claude");
    // Next use restarts transparently against the same (persistent) store.
    const events = await collect(runner, s, "q after crash");
    expect(events[events.length - 1]).toEqual({ type: "done", stopReason: "end_turn" });
    await runner.dispose();
  });

  it("in-flight prompt fails retryably when the transport dies", async () => {
    const state = createFakeState([{ match: "long", chunks: [{ text: "x" }], delayMs: 2000 }]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const seen: AgentEvent[] = [];
    const p = (async (): Promise<void> => {
      for await (const e of runner.prompt(s, "long please")) seen.push(e);
    })();
    await new Promise((r) => setTimeout(r, 100));
    runner.simulateCrash("claude");
    await p;
    const err = seen.find((e) => e.type === "error");
    expect(err).toBeDefined();
    expect((err as { retryable: boolean }).retryable).toBe(true);
    await runner.dispose();
  });

  it("listModels returns the adapter catalog", async () => {
    const state = createFakeState([]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const models = await runner.listModels("claude");
    expect(models.map((m) => m.id)).toEqual(["default", "opus", "sonnet"]);
    await runner.dispose();
  });

  it("delta-izes session-cumulative Claude counters across turns", async () => {
    const state = createFakeState([
      {
        match: "turn-one",
        chunks: [{ text: "one" }],
        usage: { inputTokens: 2, cachedReadTokens: 10000, cachedWriteTokens: 8000, outputTokens: 4 },
      },
      {
        match: "turn-two",
        chunks: [{ text: "two" }],
        usage: { inputTokens: 2, cachedReadTokens: 10633, cachedWriteTokens: 9352, outputTokens: 14 },
      },
    ]);
    const runner = new AcpAgentRunner({ factories: { claude: fakeTransportFactory(state) } });
    const s = await runner.start({ provider: "claude", model: "default", cwd: "/tmp", systemPrompt: "s", mcpServers: [] });
    const first = await collect(runner, s, "turn-one please");
    expect(first.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      inputTokens: 2,
      cachedTokens: 18000,
      outputTokens: 4,
    });
    const second = await collect(runner, s, "turn-two please");
    // Per-turn delta, not the cumulative counter.
    expect(second.find((e) => e.type === "usage")).toEqual({
      type: "usage",
      inputTokens: 0,
      cachedTokens: 633 + 1352,
      outputTokens: 10,
    });
    await runner.dispose();
  });
});
