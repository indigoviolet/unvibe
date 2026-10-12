/**
 * ACP-backed AgentRunner over `@agentclientprotocol/sdk`.
 *
 * - One adapter subprocess per provider, started lazily, multiplexing
 *   sessions; restart on crash with in-flight prompts failing as retryable
 *   errors; clean shutdown via dispose().
 * - `start`: cwd, system prompt, MCP servers (HTTP), model. Codex gets its
 *   instructions via `_meta.jetbrains.air.customInstructions`
 *   (developer/base instructions); `_meta.systemPrompt` is silently ignored
 *   by codex-acp, so we never rely on it there. The string is passed
 *   byte-stable across sessions so prefix caching works.
 * - `fork` (+ `atMessage` via AIR fork meta where supported), with the
 *   Claude quirk that a forked session needs `session/resume` before its
 *   first prompt.
 */
import { tmpdir } from "node:os";
import type {
  AgentEvent,
  AgentRunner,
  McpServerConfig,
  Session,
} from "@unvibe/shared";
import {
  ProviderConnection,
  type SessionPolicy,
  type TransportFactory,
} from "./connection.js";
import { friendlySessionStartError } from "../../exec/shim-resolve.js";
import { toAcpMcpServers } from "./mcp.js";
import { aggregateTurnUsage, deltaTurnUsage, type TurnUsage } from "./usage.js";
import { errorMessage, isCancelError, isRetryableError } from "./errors.js";
import {
  normalizeProvider,
  type AcpSessionRecord,
  type AcpStartOptions,
  type ModelInfo,
  type ProviderId,
  type ThinkingInfo,
} from "./types.js";

export interface AcpRunnerOptions {
  transportFactory?: TransportFactory;
  /** Override per-provider transports (tests). */
  factories?: Partial<Record<ProviderId, TransportFactory>>;
}

interface PendingPrompt {
  sessionAcpId: string;
  settled: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function flattenSelectOptions(opt: unknown): Array<{ value: string; name?: string; description?: string }> {
  const o = opt as {
    options?: Array<
      | { value: string; name: string; description?: string | null }
      | { group: string; name: string; options: Array<{ value: string; name: string; description?: string | null }> }
    >;
  };
  const out: Array<{ value: string; name?: string; description?: string }> = [];
  for (const e of o.options ?? []) {
    if ("value" in e) {
      out.push({ value: e.value, name: e.name, description: e.description ?? undefined });
    } else if ("options" in e && Array.isArray(e.options)) {
      for (const sub of e.options) {
        out.push({ value: sub.value, name: sub.name, description: sub.description ?? undefined });
      }
    }
  }
  return out;
}

export class AcpAgentRunner implements AgentRunner {
  private conns = new Map<ProviderId, ProviderConnection>();
  /** Live sessions (close removes). */
  private live = new Map<string, AcpSessionRecord>();
  /** Known sessions for load-after-close (survives close, cleared on dispose). */
  private known = new Map<string, AcpSessionRecord>();
  /** Canonical policies per provider, reapplied after restarts. */
  private policies = new Map<ProviderId, Map<string, SessionPolicy>>();
  /** Last reported cumulative usage per session (Claude counters grow across
   *  turns; per-turn usage is the delta — see usage.ts). */
  private usageBaseline = new Map<string, TurnUsage>();
  private modelCache = new Map<ProviderId, { at: number; models: ModelInfo[]; defaultId?: string | null }>();
  private opts: AcpRunnerOptions;

  constructor(opts: AcpRunnerOptions = {}) {
    this.opts = opts;
  }

  private conn(provider: ProviderId): ProviderConnection {
    let c = this.conns.get(provider);
    if (!c) {
      const factory = this.opts.factories?.[provider] ?? this.opts.transportFactory;
      c = new ProviderConnection(provider, factory);
      this.conns.set(provider, c);
    }
    return c;
  }

  private policyFor(rec: AcpSessionRecord): SessionPolicy {
    return {
      mcpServers: rec.mcpServers.map((s) => s.name),
      readOnly: rec.readOnly,
    };
  }

  private remember(rec: AcpSessionRecord): void {
    this.live.set(rec.acpSessionId, rec);
    this.known.set(rec.acpSessionId, rec);
    if (!this.policies.has(rec.provider)) this.policies.set(rec.provider, new Map());
    this.policies.get(rec.provider)!.set(rec.acpSessionId, this.policyFor(rec));
    // Push to the live transport when present (no-op before first ensure).
    try {
      this.conns.get(rec.provider)?.setPolicy(rec.acpSessionId, this.policyFor(rec));
    } catch {
      // ignore: reapplied on next ensure()
    }
  }

  private async ensureCaller(provider: ProviderId): Promise<{ request: (m: string, p: unknown) => Promise<unknown>; notify: (m: string, p: unknown) => Promise<void> }> {
    const c = this.conn(provider);
    const caller = await c.ensure();
    // Reapply canonical policies: a restart drops the per-transport map.
    const all = this.policies.get(provider);
    if (all) c.reapply(all);
    // Re-set this session's policy in case the transport is fresh.
    return caller;
  }

  private newSessionMeta(provider: ProviderId, systemPrompt: string, readOnly: boolean): Record<string, unknown> {
    if (provider === "claude") {
      const meta: Record<string, unknown> = { systemPrompt };
      if (readOnly) {
        // Tightest lockdown verified by live tests (see docs/acp-runner.md):
        // built-ins reduced to file readers; everything else denied by the
        // permission handler. MCP tools are unaffected (separate channel).
        (meta as Record<string, unknown>).claudeCode = {
          options: {
            tools: ["Read", "Glob", "Grep"],
            disallowedTools: [
              "Bash",
              "Edit",
              "Write",
              "NotebookEdit",
              "WebFetch",
              "WebSearch",
              "Task",
              "TodoWrite",
              "BashOutput",
              "KillShell",
            ],
          },
        };
      }
      return meta;
    }
    // Codex: `_meta.systemPrompt` is silently ignored (spike 1a FAIL).
    // Developer/base instructions travel as AIR customInstructions, which
    // codex-acp forwards as `developerInstructions` on threadStart. The
    // string is stored verbatim so the prefix is byte-stable across sessions.
    return {
      jetbrains: { air: { version: 1, customInstructions: systemPrompt } },
    };
  }

  async start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  } & { readOnly?: boolean }): Promise<Session> {
    const provider = normalizeProvider(opts.provider);
    const readOnly = (opts as AcpStartOptions).readOnly ?? true;
    const caller = await this.ensureCaller(provider);
    const mcpServers = toAcpMcpServers(opts.mcpServers);
    const meta = this.newSessionMeta(provider, opts.systemPrompt, readOnly);
    let res: unknown;
    try {
      res = await caller.request("session/new", {
        cwd: opts.cwd,
        mcpServers,
        _meta: meta,
      });
    } catch (e) {
      // A version manager refusing the review copy (issue #105) reads as
      // raw adapter JSON; say in plain words which command failed and what
      // to do (the real path is named when the transport knows it).
      throw new Error(friendlySessionStartError(provider, errorMessage(e), this.conn(provider).adapterBin), {
        cause: e,
      });
    }
    const r = res as {
      sessionId: string;
      modes?: { currentModeId: string };
      configOptions?: unknown[];
    };
    if (!r?.sessionId) throw new Error(`${provider} did not start a session`);
    const rec: AcpSessionRecord = {
      acpSessionId: r.sessionId,
      provider,
      model: opts.model || "default",
      cwd: opts.cwd,
      mcpServers: opts.mcpServers,
      systemPrompt: opts.systemPrompt,
      readOnly,
      createdAt: Date.now(),
    };
    this.remember(rec);

    // Model selection at start (both adapters expose config id "model").
    if (opts.model && opts.model !== "") {
      try {
        await this.setConfigOption(rec, "model", opts.model);
        rec.model = opts.model;
      } catch (e) {
        // Unknown model: surface non-retryably; the session is still usable.
        throw new Error(`couldn't select the ${provider} model ${JSON.stringify(opts.model)}: ${errorMessage(e)}`, {
          cause: e,
        });
      }
    }
    // Restricted posture for Codex is a session mode, applied after creation
    // (INITIAL_AGENT_MODE is process-wide and cannot multiplex). See
    // applyCodexRestricted() for why this is workspace-write, not read-only.
    if (provider === "codex" && readOnly) {
      await this.applyCodexRestricted(rec);
    }
    return { id: rec.acpSessionId, provider, model: rec.model };
  }

  /**
   * Tightest Codex configuration that still serves Unvibe sessions (verified
   * by live tests; see docs/acp-runner.md):
   * - `read-only` mode is unusable: the model refuses MCP tool calls there,
   *   and Unvibe sessions must call our MCP tools.
   * - `agent` mode is unsafe: edits and shell run with no permission
   *   round-trip (Guardian auto-approves), so the deny-by-default handler
   *   never sees them.
   * - `workspace-write` prompts on every edit/shell/network action, which
   *   the deny-by-default handler rejects; MCP approvals correlate by
   *   toolCallId and our servers are allowed. The sandbox stays at its
   *   defaults (workspace-bounded writes, no network).
   */
  private async applyCodexRestricted(rec: AcpSessionRecord): Promise<void> {
    await this.setMode({ id: rec.acpSessionId, provider: rec.provider, model: rec.model }, "workspace-write");
  }

  private async setConfigOption(rec: AcpSessionRecord, configId: string, value: string): Promise<void> {
    const caller = await this.ensureCaller(rec.provider);
    await caller.request("session/set_config_option", {
      sessionId: rec.acpSessionId,
      configId,
      value,
    });
  }

  /** Set session mode (e.g. Codex read-only / workspace-write / agent). */
  async setMode(session: Session, modeId: string): Promise<void> {
    const rec = this.requireLive(session);
    const caller = await this.ensureCaller(rec.provider);
    try {
      await caller.request("session/set_mode", { sessionId: rec.acpSessionId, modeId });
      return;
    } catch {
      // fall back to the config-option spelling
    }
    await caller.request("session/set_config_option", {
      sessionId: rec.acpSessionId,
      configId: "mode",
      value: modeId,
    });
  }

  /** Set model on a live session (config id "model" on both adapters). */
  async setModel(session: Session, model: string): Promise<void> {
    const rec = this.requireLive(session);
    await this.setConfigOption(rec, "model", model);
    rec.model = model;
  }

  /** Thinking/effort selector where the adapter exposes one. */
  async setThinking(session: Session, value: string): Promise<void> {
    const rec = this.requireLive(session);
    const provider = rec.provider;
    const candidates = provider === "claude" ? ["effort"] : ["reasoning_effort", "effort"];
    let lastErr: unknown = null;
    for (const id of candidates) {
      try {
        await this.setConfigOption(rec, id, value);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`no thinking option accepted ${JSON.stringify(value)}: ${errorMessage(lastErr)}`);
  }

  async fork(session: Session, opts?: { atMessage?: string }): Promise<Session> {
    const parent = this.requireLive(session);
    const caller = await this.ensureCaller(parent.provider);
    const params: Record<string, unknown> = {
      sessionId: parent.acpSessionId,
      cwd: parent.cwd,
    };
    if (opts?.atMessage) {
      // AIR fork point (v1) where supported; plain latest-state fork otherwise.
      // Both adapters read `_meta.jetbrains.air.fork`; without it they fork
      // latest state (the PRD's only requirement).
      params._meta = {
        jetbrains: {
          air: {
            version: 1,
            fork: { version: 1, messageId: opts.atMessage },
          },
        },
      };
    }
    let res: unknown;
    try {
      res = await caller.request("session/fork", params);
    } catch (e) {
      throw new Error(`couldn't continue the ${parent.provider} session: ${errorMessage(e)}`, { cause: e });
    }
    const r = res as { sessionId: string };
    if (!r?.sessionId) throw new Error(`${parent.provider} did not continue the session`);
    const rec: AcpSessionRecord = {
      acpSessionId: r.sessionId,
      provider: parent.provider,
      model: parent.model,
      cwd: parent.cwd,
      mcpServers: parent.mcpServers,
      systemPrompt: parent.systemPrompt,
      readOnly: parent.readOnly,
      createdAt: Date.now(),
    };
    this.remember(rec);
    if (parent.provider === "claude") {
      // 0.89.0 does not register a live session for the fork: prompting the
      // fork fails with `Session not found` until `session/resume` runs on
      // the forked id. Best-effort here; prompt() retries resume on that
      // exact error so a failed resume is not fatal.
      try {
        await caller.request("session/resume", {
          sessionId: rec.acpSessionId,
          cwd: rec.cwd,
          mcpServers: toAcpMcpServers(rec.mcpServers),
        });
      } catch {
        // ignored: prompt() will resume on demand
      }
      // Re-apply model selection: forks inherit, but be explicit when the
      // parent had a non-default model.
      if (parent.model && parent.model !== "default" && parent.model !== "") {
        try {
          await this.setConfigOption(rec, "model", parent.model);
        } catch {
          // inherit is fine
        }
      }
    }
    if (parent.provider === "codex" && rec.readOnly) {
      await this.applyCodexRestricted(rec);
    }
    return { id: rec.acpSessionId, provider: rec.provider, model: rec.model };
  }

  /** Whether fork is available (both adapters advertise sessionCapabilities.fork). */
  forkAvailable(): boolean {
    return true;
  }

  async load(sessionId: string): Promise<Session> {
    const known = this.known.get(sessionId);
    if (!known) throw new Error(`unknown acp session ${JSON.stringify(sessionId)} (no record; cannot load)`);
    const caller = await this.ensureCaller(known.provider);
    try {
      await caller.request("session/load", {
        sessionId: known.acpSessionId,
        cwd: known.cwd,
        mcpServers: toAcpMcpServers(known.mcpServers),
      });
    } catch (e) {
      throw new Error(`couldn't reopen the ${known.provider} session: ${errorMessage(e)}`, { cause: e });
    }
    // Load replays history as `session/update` notifications; drain the
    // replay before the next prompt so stale chunks never leak into it.
    const c = this.conn(known.provider);
    c.drain(known.acpSessionId);
    await sleep(300);
    c.drain(known.acpSessionId);
    const rec: AcpSessionRecord = { ...known };
    this.live.set(rec.acpSessionId, rec);
    return { id: rec.acpSessionId, provider: rec.provider, model: rec.model };
  }

  async close(session: Session): Promise<void> {
    const rec = this.live.get(session.id) ?? this.known.get(session.id);
    if (!rec) return;
    this.live.delete(rec.acpSessionId);
    try {
      const caller = await this.ensureCaller(rec.provider);
      await caller.request("session/close", { sessionId: rec.acpSessionId });
    } catch {
      // close is best-effort (idle sessions may already be gone)
    }
    this.conn(rec.provider).dropPolicy(rec.acpSessionId);
  }

  async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const rec = this.requireLive(session);
    const c = this.conn(rec.provider);
    let caller: { request: (m: string, p: unknown) => Promise<unknown>; notify: (m: string, p: unknown) => Promise<void> };
    try {
      caller = await this.ensureCaller(rec.provider);
    } catch (e) {
      yield { type: "error", message: `${rec.provider} is not connected: ${errorMessage(e)}`, retryable: true };
      return;
    }

    // Live streaming: subscribe before sending so early chunks are not lost.
    const pending: unknown[] = [];
    const waker: { fn: (() => void) | null } = { fn: null };
    const onUpdate = (u: unknown): void => {
      pending.push(u);
      waker.fn?.();
    };
    const unsub = c.subscribe(rec.acpSessionId, onUpdate);
    // Drop stale replay/history queued before this turn.
    c.drain(rec.acpSessionId);

    const aborted = { current: false };
    const onAbort = (): void => {
      aborted.current = true;
      // session/cancel is a notification (no response).
      void caller.notify("session/cancel", { sessionId: rec.acpSessionId }).catch(() => {});
      waker.fn?.();
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });

    const seenTools = new Set<string>();
    const flush = function* (): Generator<AgentEvent> {
      while (pending.length > 0) {
        const u = pending.shift() as {
          sessionUpdate?: string;
          content?: { type?: string; text?: string };
          toolCallId?: string;
          title?: string | null;
          name?: string | null;
          status?: string | null;
        };
        const kind = u?.sessionUpdate;
        if (kind === "agent_message_chunk" && u?.content?.type === "text" && typeof u.content.text === "string" && u.content.text !== "") {
          yield { type: "text", delta: u.content.text };
        } else if (kind === "tool_call") {
          const name = u.title || u.name || u.toolCallId || "tool";
          if (u.toolCallId) seenTools.add(u.toolCallId);
          yield { type: "tool", name, status: "start" };
        } else if (kind === "tool_call_update") {
          const status = (u.status ?? "") as string;
          const name = u.title || u.name || u.toolCallId || "tool";
          if (status === "completed" || status === "failed") {
            yield { type: "tool", name, status: "end" };
            if (u.toolCallId) seenTools.delete(u.toolCallId);
          } else if (u.toolCallId && !seenTools.has(u.toolCallId)) {
            seenTools.add(u.toolCallId);
            yield { type: "tool", name, status: "start" };
          }
        } else {
          // usage_update, plan, notices, etc.: not streamed; the final
          // PromptResponse carries authoritative usage.
        }
      }
    };

    let responseP: Promise<unknown>;
    try {
      responseP = caller.request("session/prompt", {
        sessionId: rec.acpSessionId,
        prompt: [{ type: "text", text }],
      });
    } catch (e) {
      unsub();
      signal?.removeEventListener("abort", onAbort);
      yield { type: "error", message: errorMessage(e), retryable: isRetryableError(e) };
      return;
    }

    // Pump live updates while the turn runs.
    let response: unknown = null;
    let failed: unknown = null;
    let done = false;
    const waiter = (async (): Promise<void> => {
      try {
        response = await responseP;
      } catch (e) {
        failed = e;
      } finally {
        done = true;
        const fn = waker.fn;
        fn?.();
      }
    })();
    void waiter;

    while (!done) {
      for (const e of flush()) yield e;
      if (done) break;
      await new Promise<void>((resolve) => {
        waker.fn = resolve;
        setTimeout(resolve, 50);
      });
      waker.fn = null;
    }
    for (const e of flush()) yield e;
    // Grace period for straggler notifications flushed before the response.
    await sleep(300);
    for (const e of flush()) yield e;
    unsub();
    signal?.removeEventListener("abort", onAbort);

    if (failed !== null) {
      const msg = errorMessage(failed);
      // Claude fork-before-resume ordering: resume once, then surface the
      // original failure non-retryably if it persists (caller retries the
      // prompt itself after a successful resume).
      if (/session not found/i.test(msg) && rec.provider === "claude") {
        try {
          await caller.request("session/resume", {
            sessionId: rec.acpSessionId,
            cwd: rec.cwd,
            mcpServers: toAcpMcpServers(rec.mcpServers),
          });
          yield { type: "error", message: `forked session needed resume; retry the prompt: ${msg}`, retryable: true };
          return;
        } catch {
          // fall through to generic error
        }
      }
      if (isCancelError(failed) || aborted.current) {
        yield { type: "done", stopReason: "cancelled" };
        return;
      }
      yield { type: "error", message: msg, retryable: isRetryableError(failed) };
      // A dead transport restarts lazily on next use.
      return;
    }

    const r = response as { stopReason?: string; usage?: unknown; _meta?: unknown };
    const stopReason = typeof r?.stopReason === "string" ? r.stopReason : "end_turn";
    if (aborted.current && stopReason !== "cancelled") {
      yield { type: "done", stopReason: "cancelled" };
      return;
    }
    const tu = aggregateTurnUsage({ usage: r?.usage, _meta: r?._meta });
    // Claude reports session-cumulative counters; Codex reports per-turn.
    // Consumers sum per-turn usage, so delta-ize Claude against the session
    // baseline (see usage.ts for the evidence).
    let report = tu;
    if (rec.provider === "claude") {
      report = deltaTurnUsage(this.usageBaseline.get(rec.acpSessionId) ?? null, tu);
      this.usageBaseline.set(rec.acpSessionId, tu);
    }
    yield {
      type: "usage",
      inputTokens: report.inputTokens,
      cachedTokens: report.cachedReadTokens + report.cachedWriteTokens,
      outputTokens: report.outputTokens,
    };
    yield { type: "done", stopReason };
  }

  /** Models the adapter offers (from session/new configOptions). */
  async listModels(provider: string): Promise<ModelInfo[]> {
    return (await this.listModelsWithDefault(provider)).models;
  }

  /**
   * Models plus the adapter's current (default) model id, from the same
   * session/new probe. Settings uses the default to pick the
   * second-opinion model (PRD §12: a different provider's default).
   */
  async listModelsWithDefault(provider: string): Promise<{ models: ModelInfo[]; defaultId: string | null }> {
    const p = normalizeProvider(provider);
    const cached = this.modelCache.get(p);
    if (cached && Date.now() - cached.at < 5 * 60_000)
      return { models: cached.models, defaultId: cached.defaultId ?? null };
    const caller = await this.ensureCaller(p);
    const res = (await caller.request("session/new", {
      cwd: tmpdir(),
      mcpServers: [],
      _meta: p === "claude" ? {} : { jetbrains: { air: { version: 1 } } },
    })) as { sessionId: string; configOptions?: unknown[] };
    try {
      const { models, defaultId } = extractModels(res.configOptions);
      this.modelCache.set(p, { at: Date.now(), models, defaultId });
      return { models, defaultId };
    } finally {
      try {
        await caller.request("session/close", { sessionId: res.sessionId });
      } catch {
        // ignore
      }
    }
  }

  /** Thinking/effort selectors the adapter exposes (Claude `effort`, Codex `reasoning_effort`). */
  async listThinking(provider: string): Promise<ThinkingInfo[]> {
    const p = normalizeProvider(provider);
    const caller = await this.ensureCaller(p);
    const res = (await caller.request("session/new", {
      cwd: tmpdir(),
      mcpServers: [],
      _meta: p === "claude" ? {} : { jetbrains: { air: { version: 1 } } },
    })) as { sessionId: string; configOptions?: unknown[] };
    try {
      const out: ThinkingInfo[] = [];
      for (const o of res.configOptions ?? []) {
        const opt = o as { id: string; category?: string; type?: string; currentValue?: string };
        if (opt.type !== "select") continue;
        const id = opt.id;
        if (id === "effort" || id === "reasoning_effort" || opt.category === "thought_level") {
          out.push({
            configId: id,
            current: typeof opt.currentValue === "string" ? opt.currentValue : "",
            options: flattenSelectOptions(o),
          });
        }
      }
      return out;
    } finally {
      try {
        await caller.request("session/close", { sessionId: res.sessionId });
      } catch {
        // ignore
      }
    }
  }

  private requireLive(session: Session): AcpSessionRecord {
    const rec = this.live.get(session.id);
    if (!rec) {
      const known = this.known.get(session.id);
      throw new Error(
        known
          ? `session ${session.id} is closed; call load(${JSON.stringify(session.id)}) to reopen`
          : `unknown session ${JSON.stringify(session.id)}`,
      );
    }
    return rec;
  }

  /** For tests: how many live sessions are tracked. */
  sessionCount(): number {
    return this.live.size;
  }

  /** For tests: force the provider connection to drop (simulates a crash). */
  simulateCrash(provider: string): void {
    this.conn(normalizeProvider(provider)).noteDeath();
  }

  /** Clear the 5-min model listing cache (Reload everything re-probes). */
  clearModelCache(): void {
    this.modelCache.clear();
  }

  /**
   * Restart adapter subprocesses without killing in-flight jobs silently
   * (Reload everything, issue #20).
   *
   * Drops each provider transport; the next `ensure()` starts a fresh
   * subprocess. In-flight `prompt()` calls see the transport die and fail
   * as retryable errors with a clear message (existing crash-restart
   * semantics), so jobs back off and retry rather than vanishing. Sessions
   * and policies are kept (reapplied on restart).
   */
  restartTransports(reason = "reload"): void {
    for (const [provider, conn] of this.conns) {
      try {
        // noteDeath drops the transport but keeps the connection restartable
        // (unlike dispose, which is terminal).
        conn.noteDeath();
      } catch {
        // best-effort
      }
      void provider;
    }
    this.clearModelCache();
    void reason;
  }

  async dispose(): Promise<void> {
    for (const c of this.conns.values()) c.dispose();
    this.conns.clear();
    this.live.clear();
    // keep `known` so load() errors stay descriptive after dispose? No:
    // dispose is terminal; clear everything.
    this.known.clear();
    this.policies.clear();
    this.usageBaseline.clear();
  }
}

function extractModels(configOptions: unknown[] | undefined): { models: ModelInfo[]; defaultId: string | null } {
  if (!configOptions) return { models: [], defaultId: null };
  for (const o of configOptions) {
    const opt = o as { id?: string; category?: string; options?: unknown; currentValue?: unknown };
    if (opt.id === "model" || opt.category === "model") {
      return {
        models: flattenSelectOptions(o).map((e) => ({
          id: e.value,
          name: e.name,
          description: e.description,
        })),
        defaultId: typeof opt.currentValue === "string" && opt.currentValue ? opt.currentValue : null,
      };
    }
  }
  return { models: [], defaultId: null };
}

export type { PendingPrompt };
