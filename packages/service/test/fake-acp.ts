/**
 * Scripted in-process fake ACP agent speaking the real protocol over an
 * in-memory stream pair (TransformStream + ndJsonStream).
 *
 * The client side reuses the production `connectClient()` helper so
 * permission handling, update demux and streaming are the real code paths.
 * Only the agent side is faked.
 */
import * as acp from "@agentclientprotocol/sdk";
import { connectClient } from "../src/agent/acp/connection.js";
import type { TransportFactory } from "../src/agent/acp/connection.js";

export interface FakeChunk {
  text?: string;
  toolStart?: { id: string; title: string; name?: string };
  toolEnd?: { id: string; title: string };
}

export interface FakeTurn {
  /** Match prompts containing this substring; first match wins. */
  match: string;
  chunks?: FakeChunk[];
  usage?: {
    inputTokens: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
    outputTokens: number;
  };
  /** Extra per-model breakdown to verify background-call aggregation. */
  modelUsage?: Array<{
    model: string;
    inputTokens: number;
    cachedInputTokens?: number;
    cachedWriteTokens?: number;
    outputTokens: number;
  }>;
  stopReason?: string;
  /** Throw instead of answering (goes through as a prompt error). */
  error?: string;
  /** Artificial delay before answering (ms) — used for cancel tests. */
  delayMs?: number;
  /** Ask the client for permission mid-turn; records the outcome. */
  permissionProbe?: { title: string; name?: string };
  /**
   * Codex workspace-write style: emit a tool_call update with a title, then
   * request permission with an EMPTY toolCall. The client must correlate by
   * toolCallId to decide.
   */
  correlatedProbe?: { toolCallId: string; title: string; name?: string };
}

export interface FakeAgentState {
  turns: FakeTurn[];
  /** sessionId -> { cwd, resumed, closed, meta } */
  sessions: Map<string, { cwd: string; resumed: boolean; closed: boolean; forkedFrom?: string }>;
  permissionOutcomes: Array<{ title: string; outcome: string; optionId?: string }>;
  promptCalls: Array<{ sessionId: string; text: string }>;
  resumeCalls: string[];
  forkCalls: Array<{ from: string; atMessage?: string }>;
  setModelCalls: Array<{ sessionId: string; value: string }>;
  cancelled: Set<string>;
  nextId: number;
  /** When true, prompts on forked sessions fail until resume() is called. */
  forkNeedsResume: boolean;
  defaultUsage: NonNullable<FakeTurn["usage"]>;
}

export function createFakeState(turns: FakeTurn[] = []): FakeAgentState {
  return {
    turns,
    sessions: new Map(),
    permissionOutcomes: [],
    promptCalls: [],
    resumeCalls: [],
    forkCalls: [],
    setModelCalls: [],
    cancelled: new Set(),
    nextId: 1,
    forkNeedsResume: false,
    defaultUsage: { inputTokens: 5, cachedReadTokens: 100, cachedWriteTokens: 0, outputTokens: 10 },
  };
}

function pickTurn(state: FakeAgentState, text: string): FakeTurn {
  return state.turns.find((t) => text.includes(t.match)) ?? { match: "" };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function readAirFork(message: unknown): string | undefined {
  const m = message as { jetbrains?: { air?: { fork?: { version?: number; messageId?: string } } } } | null;
  const fork = m?.jetbrains?.air?.fork;
  if (fork?.version === 1 && typeof fork.messageId === "string") return fork.messageId;
  return undefined;
}

export function buildFakeAgentApp(state: FakeAgentState): any {
  const app = (acp.agent({ name: "unvibe-fake-agent" }) as any)
    .onRequest("initialize", async () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { fork: {}, resume: {}, close: {}, load: {} },
        mcpCapabilities: { http: true },
      },
      authMethods: [],
    }))
    .onRequest("session/new", async (ctx: any) => {
      const id = `fake-${state.nextId++}`;
      state.sessions.set(id, { cwd: ctx.params.cwd, resumed: true, closed: false });
      return {
        sessionId: id,
        modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Manual" }] },
        configOptions: [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "default",
            options: [
              { value: "default", name: "Default" },
              { value: "opus", name: "Opus" },
              { value: "sonnet", name: "Sonnet" },
            ],
          },
          {
            id: "effort",
            name: "Effort",
            category: "thought_level",
            type: "select",
            currentValue: "high",
            options: [
              { value: "low", name: "Low" },
              { value: "high", name: "High" },
            ],
          },
        ],
      };
    })
    .onRequest("session/fork", async (ctx: any) => {
      const from: string = ctx.params.sessionId;
      const parent = state.sessions.get(from);
      if (!parent) throw new acp.RequestError(-32603, `Internal error :: ${JSON.stringify({ details: "Session not found" })}`);
      const atMessage = readAirFork(ctx.params._meta);
      state.forkCalls.push({ from, atMessage });
      const id = `fake-${state.nextId++}`;
      state.sessions.set(id, {
        cwd: ctx.params.cwd ?? parent.cwd,
        resumed: !state.forkNeedsResume,
        closed: false,
        forkedFrom: from,
      });
      return { sessionId: id };
    })
    .onRequest("session/resume", async (ctx: any) => {
      const id: string = ctx.params.sessionId;
      const s = state.sessions.get(id);
      if (!s) throw new acp.RequestError(-32603, "Session not found");
      s.resumed = true;
      state.resumeCalls.push(id);
      return {};
    })
    .onRequest("session/load", async (ctx: any) => {
      const id: string = ctx.params.sessionId;
      const s = state.sessions.get(id);
      if (!s) throw new acp.RequestError(-32603, "Session not found");
      s.closed = false;
      s.resumed = true;
      // Replay history as updates (runner must drain before next prompt).
      await ctx.client.notify("session/update", {
        sessionId: id,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "[replay]" },
        },
      });
      return {};
    })
    .onRequest("session/close", async (ctx: any) => {
      state.sessions.get(ctx.params.sessionId as string)!.closed = true;
      return {};
    })
    .onRequest("session/set_mode", async () => ({}))
    .onRequest("session/set_config_option", async (ctx: any) => {
      state.setModelCalls.push({ sessionId: ctx.params.sessionId, value: ctx.params.value });
      return {};
    })
    .onNotification("session/cancel", async (ctx: any) => {
      state.cancelled.add(ctx.params.sessionId as string);
    })
    .onRequest("session/prompt", async (ctx: any) => {
      const sessionId: string = ctx.params.sessionId;
      const blocks = ctx.params.prompt as Array<{ type: string; text?: string }>;
      const text = blocks.map((b) => b.text ?? "").join("\n");
      state.promptCalls.push({ sessionId, text });
      const s = state.sessions.get(sessionId);
      if (!s || s.closed) {
        throw new acp.RequestError(-32603, `Internal error :: ${JSON.stringify({ details: "Session not found" })}`);
      }
      if (state.forkNeedsResume && s.forkedFrom && !s.resumed) {
        throw new acp.RequestError(-32603, `Internal error :: ${JSON.stringify({ details: "Session not found" })}`);
      }
      const turn = pickTurn(state, text);
      if (turn.error) throw new acp.RequestError(-32603, turn.error);
      if (turn.permissionProbe) {
        const resp = await ctx.client.request("session/request_permission", {
          sessionId,
          toolCall: {
            toolCallId: "tc-1",
            title: turn.permissionProbe.title,
            name: turn.permissionProbe.name,
          },
          options: [
            { optionId: "allow-once", name: "Yes", kind: "allow_once" },
            { optionId: "reject", name: "No", kind: "reject_once" },
          ],
        });
        const outcome = (resp as any)?.outcome;
        state.permissionOutcomes.push({
          title: turn.permissionProbe.title,
          outcome: outcome?.outcome ?? "?",
          optionId: outcome?.optionId,
        });
      }
      if (turn.correlatedProbe) {
        const cp = turn.correlatedProbe;
        await ctx.client.notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: cp.toolCallId,
            title: cp.title,
            name: cp.name,
            status: "pending",
          },
        });
        const resp = await ctx.client.request("session/request_permission", {
          sessionId,
          toolCall: { toolCallId: cp.toolCallId },
          options: [
            { optionId: "allow-once", name: "Yes", kind: "allow_once" },
            { optionId: "reject", name: "No", kind: "reject_once" },
          ],
          _meta: { is_mcp_tool_approval: true },
        });
        const outcome = (resp as any)?.outcome;
        state.permissionOutcomes.push({
          title: cp.title,
          outcome: outcome?.outcome ?? "?",
          optionId: outcome?.optionId,
        });
      }
      const delay = turn.delayMs ?? 0;
      const step = 20;
      for (let waited = 0; waited < delay; waited += step) {
        await new Promise((r) => setTimeout(r, Math.min(step, delay - waited)));
        if (state.cancelled.has(sessionId)) {
          state.cancelled.delete(sessionId);
          return { stopReason: "cancelled" };
        }
        if (ctx.signal?.aborted) return { stopReason: "cancelled" };
      }
      if (state.cancelled.has(sessionId)) {
        state.cancelled.delete(sessionId);
        return { stopReason: "cancelled" };
      }
      for (const c of turn.chunks ?? []) {
        if (c.text) {
          await ctx.client.notify("session/update", {
            sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: c.text } },
          });
        }
        if (c.toolStart) {
          await ctx.client.notify("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: c.toolStart.id,
              title: c.toolStart.title,
              name: c.toolStart.name,
              status: "pending",
            },
          });
        }
        if (c.toolEnd) {
          await ctx.client.notify("session/update", {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: c.toolEnd.id,
              title: c.toolEnd.title,
              status: "completed",
            },
          });
        }
      }
      const u = turn.usage ?? state.defaultUsage;
      const total =
        u.inputTokens + (u.cachedReadTokens ?? 0) + (u.cachedWriteTokens ?? 0) + u.outputTokens;
      const usage: Record<string, unknown> = {
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        totalTokens: total,
      };
      if (u.cachedReadTokens !== undefined) usage.cachedReadTokens = u.cachedReadTokens;
      if (u.cachedWriteTokens !== undefined) usage.cachedWriteTokens = u.cachedWriteTokens;
      let meta: Record<string, unknown> | undefined;
      if (turn.modelUsage) {
        meta = {
          quota: {
            token_count: {
              totalTokens: total,
              inputTokens: u.inputTokens,
              cachedInputTokens: u.cachedReadTokens ?? 0,
              cachedWriteTokens: u.cachedWriteTokens ?? 0,
              outputTokens: u.outputTokens,
            },
            model_usage: turn.modelUsage.map((m) => ({
              model: m.model,
              token_count: {
                totalTokens:
                  m.inputTokens + (m.cachedInputTokens ?? 0) + (m.cachedWriteTokens ?? 0) + m.outputTokens,
                inputTokens: m.inputTokens,
                cachedInputTokens: m.cachedInputTokens ?? 0,
                cachedWriteTokens: m.cachedWriteTokens ?? 0,
                outputTokens: m.outputTokens,
              },
            })),
          },
        };
      }
      return { stopReason: turn.stopReason ?? "end_turn", usage, ...(meta ? { _meta: meta } : {}) };
    });
  return app;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** TransportFactory speaking the real protocol to the fake agent. */
export function fakeTransportFactory(state: FakeAgentState): TransportFactory {
  return async () => {
    const clientToAgent = new TransformStream();
    const agentToClient = new TransformStream();
    const clientStream = acp.ndJsonStream(
      clientToAgent.writable as unknown as WritableStream<Uint8Array>,
      agentToClient.readable as unknown as ReadableStream<Uint8Array>,
    );
    const agentStream = acp.ndJsonStream(
      agentToClient.writable as unknown as WritableStream<Uint8Array>,
      clientToAgent.readable as unknown as ReadableStream<Uint8Array>,
    );
    const agentApp = buildFakeAgentApp(state);
    const agentConn = agentApp.connect(agentStream);
    const { conn, caller, maps } = connectClient(clientStream);
    await caller.request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
    let deathResolve!: () => void;
    const onDeath = new Promise<void>((resolve) => {
      deathResolve = resolve;
    });
    return {
      caller,
      onDeath,
      dispose: () => {
        try {
          conn.close();
        } catch {
          // ignore
        }
        try {
          agentConn.close();
        } catch {
          // ignore
        }
        deathResolve();
      },
      policies: maps.policies,
      queues: maps.queues,
      subs: maps.subs,
    };
  };
}
