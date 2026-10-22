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
 * - `fork` (+ `atMessage` via AIR fork meta where supported) carries the
 *   same `mcpServers` + `_meta` as new/resume/load (#124: a Codex fork sent
 *   without them may lack the review tools), with the Claude quirk that a
 *   forked session needs `session/resume` before its first prompt.
 * - Thinking level (#172): `start` applies the role's effort via
 *   `setThinking` (Default means the adapter's own setting stands); forks
 *   inherit the parent's value and re-apply it explicitly, and `load`
 *   re-applies it after reopening, so new, fork, resume and load all carry
 *   the setting.
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
import { assertLiveAgentAllowed } from "../live-guard.js";
import { friendlySessionStartError } from "../../exec/shim-resolve.js";
import { toAcpMcpServers } from "./mcp.js";
import { aggregateTurnUsage, type TurnUsage } from "./usage.js";
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
  /** Env for the live-agent guard (#188); defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /**
   * Ceiling for notification-settling waits after every prompt and in
   * load() (ms; default 300). The waits end early once notifications are
   * quiet for 20 ms; the ceiling only bounds a chatty adapter. Tests pass
   * 0: the fake transports deliver synchronously, so no wait is needed.
   */
  settleMs?: number;
}

/**
 * #122.3: quiet window proving no more notifications are in flight. Both
 * settling waits (post-turn stragglers, load replay drain) end after one
 * quiet window instead of a fixed sleep, bounded by the ceiling above.
 */
const SETTLE_QUIET_MS = 20;

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

/**
 * First turn of every small one-shot Claude session (hunk pass,
 * summarize, runSmall — the `systemPrompt: ""` starts). Live payload
 * captures (#177, found via the #160 investigation) show the CLI places
 * its dynamic environment block (environment, agent types, skills)
 * AFTER the first user message, with the last cache breakpoint at its
 * end. When the first message is the per-job prompt, that block can
 * never be shared and is re-written on every job (~7k tokens per job,
 * even warm; more with a wider tool set). A byte-identical first turn moves the
 * per-job prompt after every shared block, so all of it cache-reads
 * from the second job on. Mirrors the base pack's "ready" pattern in
 * SessionManager.
 */
export const SHARED_CACHE_FIRST_TURN =
  "Reply with exactly `ready` and nothing else. The task for this session arrives in the next message.";

export class AcpAgentRunner implements AgentRunner {
  /**
   * One adapter subprocess per (provider, posture) — issue #160
   * follow-up. The lock-down transport spawns with exactly the base env,
   * so the default posture is unchanged down to the spawn env; the
   * full-access transport spawns scrubbed. Sessions always prompt, fork
   * and load through the transport matching their own `readOnly`, so the
   * two postures never share a process. Lazy like before: a posture's
   * subprocess starts on its first use.
   */
  private conns = new Map<string, ProviderConnection>();
  /** Live sessions (close removes). */
  private live = new Map<string, AcpSessionRecord>();
  /** Known sessions for load-after-close (survives close, cleared on dispose). */
  private known = new Map<string, AcpSessionRecord>();
  /** Canonical policies per transport, reapplied after restarts. */
  private policies = new Map<string, Map<string, SessionPolicy>>();
  /** Usage of the shared first (warm-up) turn, consumed once via
   *  takeSessionStartUsage so the pipeline attributes it to the job's
   *  "session start" turn (see start()). */
  private firstTurnUsage = new Map<string, TurnUsage>();
  private modelCache = new Map<ProviderId, { at: number; models: ModelInfo[]; defaultId?: string | null }>();
  private opts: AcpRunnerOptions;

  constructor(opts: AcpRunnerOptions = {}) {
    this.opts = opts;
    // Direct construction with no fake transport would spawn real CLIs
    // (#188): require the live flag eagerly. Fake-injected runners pass.
    const hasFake = Boolean(opts.transportFactory) || Boolean(opts.factories && Object.keys(opts.factories).length > 0);
    if (!hasFake) assertLiveAgentAllowed(opts.env ?? process.env);
  }

  private connKey(provider: ProviderId, readOnly: boolean): string {
    return `${provider}:${readOnly ? "ro" : "full"}`;
  }

  private conn(provider: ProviderId, readOnly: boolean): ProviderConnection {
    const key = this.connKey(provider, readOnly);
    let c = this.conns.get(key);
    if (!c) {
      const factory = this.opts.factories?.[provider] ?? this.opts.transportFactory;
      // Partial-fake guard (#188): a provider with no injected fake would
      // spawn the real adapter for that provider.
      if (!factory) assertLiveAgentAllowed(this.opts.env ?? process.env);
      c = new ProviderConnection(provider, readOnly, factory);
      this.conns.set(key, c);
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
    const key = this.connKey(rec.provider, rec.readOnly);
    if (!this.policies.has(key)) this.policies.set(key, new Map());
    this.policies.get(key)!.set(rec.acpSessionId, this.policyFor(rec));
    // Push to the live transport when present (no-op before first ensure).
    try {
      this.conns.get(key)?.setPolicy(rec.acpSessionId, this.policyFor(rec));
    } catch {
      // ignore: reapplied on next ensure()
    }
  }

  private async ensureCaller(provider: ProviderId, readOnly: boolean): Promise<{ request: (m: string, p: unknown) => Promise<unknown>; notify: (m: string, p: unknown) => Promise<void> }> {
    const c = this.conn(provider, readOnly);
    const caller = await c.ensure();
    // Reapply canonical policies: a restart drops the per-transport map.
    const all = this.policies.get(this.connKey(provider, readOnly));
    if (all) c.reapply(all);
    // Re-set this session's policy in case the transport is fresh.
    return caller;
  }

  /**
   * #121: one place that builds the session-defining `_meta` (system prompt
   * + tool lockdown for Claude, custom instructions for Codex). `session/new`,
   * `session/resume` and `session/load` must all carry the same value so a
   * new session, a resume and a load cannot drift apart again.
   */
  private sessionMeta(rec: Pick<AcpSessionRecord, "provider" | "systemPrompt" | "readOnly">): Record<string, unknown> {
    return this.newSessionMeta(rec.provider, rec.systemPrompt, rec.readOnly);
  }

  private newSessionMeta(provider: ProviderId, systemPrompt: string, readOnly: boolean): Record<string, unknown> {
    if (provider === "claude") {
      // Issue #209 (owner decision: option (a)): Unvibe sessions load
      // only Unvibe's own MCP servers (passed via `mcpServers`), never
      // the user's or the repository's. Without `strictMcpConfig`, every
      // configured MCP server's tools load eagerly into the first turn
      // (~0.9k tokens each — ~790k for ~880 tools, plus ~28 s connecting
      // them), instead of staying deferred as in interactive sessions.
      const options: Record<string, unknown> = { strictMcpConfig: true };
      if (readOnly) {
        // Tightest lockdown verified by live tests (see docs/acp-runner.md):
        // built-ins reduced to file readers; everything else denied by the
        // permission handler. MCP tools are unaffected (separate channel).
        options["tools"] = ["Read", "Glob", "Grep"];
        options["disallowedTools"] = [
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
        ];
      }
      // Full access (issue #160): no tool reduction — the adapter defaults
      // (the agent's full tool set) apply, and the permission handler
      // approves. The limits live only in the system prompt.
      return { systemPrompt, claudeCode: { options } };
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
  } & { readOnly?: boolean; effort?: string }): Promise<Session> {
    const provider = normalizeProvider(opts.provider);
    const readOnly = (opts as AcpStartOptions).readOnly ?? true;
    const effort = (opts as AcpStartOptions).effort ?? "";
    const caller = await this.ensureCaller(provider, readOnly);
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
      throw new Error(friendlySessionStartError(provider, errorMessage(e), this.conn(provider, readOnly).adapterBin), {
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
      effort,
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
    // Thinking level at start (#172): the adapter's own setting stands
    // when effort is Default (""). Applied before any prompt (including
    // the shared-cache warm turn below) so every turn runs at the level.
    if (effort !== "") {
      try {
        await this.setThinking({ id: rec.acpSessionId, provider, model: rec.model }, effort);
      } catch (e) {
        throw new Error(`couldn't select the ${provider} effort ${JSON.stringify(effort)}: ${errorMessage(e)}`, {
          cause: e,
        });
      }
    }
    // Small one-shot Claude sessions get a shared first turn so the
    // per-job prompt lands after every cache-shared block (see
    // SHARED_CACHE_FIRST_TURN). Best-effort: a failed first turn must
    // not fail the job — the real prompt surfaces any real error. Its
    // usage is recorded here and consumed once via takeSessionStartUsage,
    // so the pipeline can attribute it to the job's "session start" turn
    // instead of the first real prompt; its notifications are drained by
    // prompt() before that turn.
    if (provider === "claude" && opts.systemPrompt === "") {
      try {
        const warm = await caller.request("session/prompt", {
          sessionId: rec.acpSessionId,
          prompt: [{ type: "text", text: SHARED_CACHE_FIRST_TURN }],
        });
        const tu = aggregateTurnUsage(warm as { usage?: unknown; _meta?: unknown });
        this.firstTurnUsage.set(rec.acpSessionId, tu);
      } catch {
        // ignore: caching optimisation only
      }
    }
    // Restricted posture for Codex is a session mode, applied after creation
    // (INITIAL_AGENT_MODE is process-wide and cannot multiplex). See
    // applyCodexRestricted() for why this is workspace-write, not read-only.
    // Full access (issue #160) uses the adapter's `agent-full-access`
    // mode: unrestricted shell/network/files with no permission round-trip
    // (approval "never", dangerFullAccess sandbox — verified in the
    // adapter sources). The review MCP tools run without prompts there.
    if (provider === "codex") {
      if (readOnly) await this.applyCodexRestricted(rec);
      else await this.applyCodexFullAccess(rec);
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

  /**
   * Issue #160: the adapter's `agent-full-access` mode ("Unrestricted
   * access to the internet and any file on your computer"). Shell, network
   * and file tools run with no permission round-trip; our review MCP tools
   * run the same way. Nothing about this mode is enforced least-privilege:
   * the limits are prompt instructions only.
   */
  private async applyCodexFullAccess(rec: AcpSessionRecord): Promise<void> {
    await this.setMode({ id: rec.acpSessionId, provider: rec.provider, model: rec.model }, "agent-full-access");
  }

  private async setConfigOption(rec: AcpSessionRecord, configId: string, value: string): Promise<void> {
    const caller = await this.ensureCaller(rec.provider, rec.readOnly);
    await caller.request("session/set_config_option", {
      sessionId: rec.acpSessionId,
      configId,
      value,
    });
  }

  /** Set session mode (e.g. Codex read-only / workspace-write / agent). */
  async setMode(session: Session, modeId: string): Promise<void> {
    const rec = this.requireLive(session);
    const caller = await this.ensureCaller(rec.provider, rec.readOnly);
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
    const caller = await this.ensureCaller(parent.provider, parent.readOnly);
    // #124: a fork carries the same session-defining fields as new/resume/
    // load (one builder, `sessionMeta`). codex-acp builds the fork's config
    // from `request.mcpServers ?? []`, so a fork sent without them may come
    // up with no review tools at all (the probable #51 cause); the prompt
    // cache is a prefix match, so the fields keep the fork on the base's
    // prefix too.
    const params: Record<string, unknown> = {
      sessionId: parent.acpSessionId,
      cwd: parent.cwd,
      mcpServers: toAcpMcpServers(parent.mcpServers),
      _meta: this.sessionMeta(parent),
    };
    if (opts?.atMessage) {
      // AIR fork point (v1) where supported; plain latest-state fork otherwise.
      // Both adapters read `_meta.jetbrains.air.fork`; without it they fork
      // latest state (the PRD's only requirement). Merged into the session
      // meta above (Codex instructions live under the same `air` key).
      const meta = params._meta as Record<string, unknown>;
      const jetbrains = { ...((meta.jetbrains as Record<string, unknown> | undefined) ?? {}) };
      const air = { ...((jetbrains.air as Record<string, unknown> | undefined) ?? {}), version: 1 };
      (air as Record<string, unknown>).fork = { version: 1, messageId: opts.atMessage };
      jetbrains.air = air;
      meta.jetbrains = jetbrains;
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
      effort: parent.effort,
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
          _meta: this.sessionMeta(rec),
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
    // Re-apply the thinking level for the same reason (#172): forks
    // inherit, but be explicit. Runs for both providers so the setting is
    // sent on every fork.
    if (parent.effort !== "") {
      try {
        await this.setThinking({ id: rec.acpSessionId, provider: rec.provider, model: rec.model }, parent.effort);
      } catch {
        // inherit is fine
      }
    }
    if (parent.provider === "codex") {
      if (rec.readOnly) await this.applyCodexRestricted(rec);
      else await this.applyCodexFullAccess(rec);
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
    const caller = await this.ensureCaller(known.provider, known.readOnly);
    try {
      await caller.request("session/load", {
        sessionId: known.acpSessionId,
        cwd: known.cwd,
        mcpServers: toAcpMcpServers(known.mcpServers),
        _meta: this.sessionMeta(known),
      });
    } catch (e) {
      throw new Error(`couldn't reopen the ${known.provider} session: ${errorMessage(e)}`, { cause: e });
    }
    // Load replays history as `session/update` notifications; drain the
    // replay before the next prompt so stale chunks never leak into it.
    // #122.3: drain until quiet (one 20 ms window with nothing new) instead
    // of a fixed sleep, bounded by the ceiling.
    const c = this.conn(known.provider, known.readOnly);
    const ceiling = this.opts.settleMs ?? 300;
    const t0 = Date.now();
    c.drain(known.acpSessionId);
    for (;;) {
      const elapsed = Date.now() - t0;
      if (elapsed >= ceiling) break;
      await sleep(Math.min(SETTLE_QUIET_MS, ceiling - elapsed));
      if (c.drain(known.acpSessionId).length === 0) break;
    }
    const rec: AcpSessionRecord = { ...known };
    this.live.set(rec.acpSessionId, rec);
    // A reopened session keeps the adapter's persisted settings, but be
    // explicit about the thinking level (#172: load must carry it).
    if (rec.effort !== "") {
      try {
        await this.setThinking({ id: rec.acpSessionId, provider: rec.provider, model: rec.model }, rec.effort);
      } catch {
        // persisted value stands
      }
    }
    if (rec.provider === "codex") {
      if (rec.readOnly) await this.applyCodexRestricted(rec);
      else await this.applyCodexFullAccess(rec);
    }
    return { id: rec.acpSessionId, provider: rec.provider, model: rec.model };
  }

  async close(session: Session): Promise<void> {
    const rec = this.live.get(session.id) ?? this.known.get(session.id);
    if (!rec) return;
    this.live.delete(rec.acpSessionId);
    try {
      const caller = await this.ensureCaller(rec.provider, rec.readOnly);
      await caller.request("session/close", { sessionId: rec.acpSessionId });
    } catch {
      // close is best-effort (idle sessions may already be gone)
    }
    this.conn(rec.provider, rec.readOnly).dropPolicy(rec.acpSessionId);
  }

  async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const rec = this.requireLive(session);
    const c = this.conn(rec.provider, rec.readOnly);
    let caller: { request: (m: string, p: unknown) => Promise<unknown>; notify: (m: string, p: unknown) => Promise<void> };
    try {
      caller = await this.ensureCaller(rec.provider, rec.readOnly);
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
    // Adapters stream arguments: the opening `tool_call` carries `{}`
    // and the real `rawInput` arrives on intermediate updates, while the
    // terminal update often carries none. Remember the latest detail per
    // call so the `end` event can carry it to the job record.
    const toolDetails = new Map<string, string>();
    const flush = function* (): Generator<AgentEvent> {
      while (pending.length > 0) {
        const u = pending.shift() as {
          sessionUpdate?: string;
          content?: { type?: string; text?: string };
          toolCallId?: string;
          title?: string | null;
          name?: string | null;
          status?: string | null;
          /** Adapter-sent tool arguments (shape varies by adapter). */
          rawInput?: unknown;
          input?: unknown;
        };
        const kind = u?.sessionUpdate;
        if (process.env.UNVIBE_ACP_DEBUG === "2" && (kind === "tool_call" || kind === "tool_call_update")) {
          try {
            process.stderr.write(`[acp-tool] ${JSON.stringify(u).slice(0, 1500)}\n`);
          } catch { /* debug only */ }
        }
        if (kind === "agent_message_chunk" && u?.content?.type === "text" && typeof u.content.text === "string" && u.content.text !== "") {
          yield { type: "text", delta: u.content.text };
        } else if (kind === "tool_call") {
          const name = u.title || u.name || u.toolCallId || "tool";
          if (u.toolCallId) seenTools.add(u.toolCallId);
          // Issue #160: keep a best-effort record of what the agent ran
          // (shell command, URL, …) when the adapter sends arguments with
          // the call. Adapters that send none record the name only.
          const detail = formatToolDetail(u.rawInput ?? u.input);
          if (detail !== undefined && u.toolCallId) toolDetails.set(u.toolCallId, detail);
          const result = formatToolResult((u as { content?: unknown }).content);
          yield {
            type: "tool",
            name,
            status: "start",
            ...(u.toolCallId ? { id: u.toolCallId } : {}),
            ...(detail !== undefined ? { detail } : {}),
            ...(result !== undefined ? { result } : {}),
          };
        } else if (kind === "tool_call_update") {
          const status = (u.status ?? "") as string;
          const name = u.title || u.name || u.toolCallId || "tool";
          const result = formatToolResult((u as { content?: unknown }).content);
          const streamed = formatToolDetail(u.rawInput ?? u.input);
          if (streamed !== undefined && u.toolCallId) toolDetails.set(u.toolCallId, streamed);
          const detail = streamed ?? (u.toolCallId ? toolDetails.get(u.toolCallId) : undefined);
          if (status === "completed" || status === "failed") {
            yield {
              type: "tool",
              name,
              status: "end",
              ...(u.toolCallId ? { id: u.toolCallId } : {}),
              ...(detail !== undefined ? { detail } : {}),
              ...(result !== undefined ? { result } : {}),
            };
            if (u.toolCallId) {
              seenTools.delete(u.toolCallId);
              toolDetails.delete(u.toolCallId);
            }
          } else if (u.toolCallId && !seenTools.has(u.toolCallId)) {
            seenTools.add(u.toolCallId);
            yield {
              type: "tool",
              name,
              status: "start",
              id: u.toolCallId,
              ...(detail !== undefined ? { detail } : {}),
              ...(result !== undefined ? { result } : {}),
            };
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
    // #122.3: straggler notifications flushed by the adapter just before
    // the response may still be in flight. Wait until quiet (one 20 ms
    // window with nothing new) instead of a fixed sleep, bounded by the
    // ceiling.
    {
      const ceiling = this.opts.settleMs ?? 300;
      const t0 = Date.now();
      for (;;) {
        for (const e of flush()) yield e;
        const elapsed = Date.now() - t0;
        if (elapsed >= ceiling) break;
        if (pending.length === 0) {
          await sleep(Math.min(SETTLE_QUIET_MS, ceiling - elapsed));
          if (pending.length === 0) break;
        }
      }
    }
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
            _meta: this.sessionMeta(rec),
          });
          if (rec.effort !== "") {
            try {
              await this.setThinking(
                { id: rec.acpSessionId, provider: rec.provider, model: rec.model },
                rec.effort,
              );
            } catch {
              // persisted value stands
            }
          }
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
    // Both adapters report per-turn figures (#209; see usage.ts), so the
    // aggregate IS this turn's usage — for Claude and Codex alike. Never
    // diff it against an earlier turn of the session. The shared first
    // (warm-up) turn's usage is NOT folded in here: the caller attributes
    // it to the job's "session start" turn via takeSessionStartUsage, so
    // the first real turn's usage is that turn alone.
    const report = tu;
    yield {
      type: "usage",
      inputTokens: report.inputTokens,
      cachedReadTokens: report.cachedReadTokens,
      cachedWriteTokens: report.cachedWriteTokens,
      outputTokens: report.outputTokens,
      // Issue #207: the adapter's payload verbatim (`usage` + `_meta`,
      // quota figures included), for the Debug page's raw view. The
      // derived counts above may be aggregated; this is not.
      raw: { usage: r?.usage ?? null, _meta: r?._meta ?? null },
    };
    yield { type: "done", stopReason };
  }

  /**
   * Issue #209: consume the shared first (warm-up) turn's usage for a
   * session started with an empty system prompt, if one was recorded.
   * The pipeline reports it on the job's "session start" turn record
   * (which also carries the 28 s-class start wall time), separately from
   * the first real turn. Exact adapter-reported figures, not computed.
   */
  takeSessionStartUsage(sessionId: string): TurnUsage | undefined {
    const rec = this.known.get(sessionId);
    if (!rec) return undefined;
    const first = this.firstTurnUsage.get(rec.acpSessionId);
    if (!first) return undefined;
    this.firstTurnUsage.delete(rec.acpSessionId);
    return first;
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
    // Throwaway probe sessions run on the lock-down transport (base env).
    const caller = await this.ensureCaller(p, true);
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
    // Throwaway probe sessions run on the lock-down transport (base env).
    const caller = await this.ensureCaller(p, true);
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

  /**
   * For tests: force the provider connections to drop (simulates a
   * crash). Drops both postures: the next use restarts fresh.
   */
  simulateCrash(provider: string): void {
    const p = normalizeProvider(provider);
    for (const [key, conn] of this.conns) {
      if (key === this.connKey(p, true) || key === this.connKey(p, false)) conn.noteDeath();
    }
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
    this.firstTurnUsage.clear();
  }
}

/**
 * Issue #160: best-effort tool-argument text for the job record. Strings
 * pass through; objects stringify; anything else records nothing.
 * Truncated: the job record names the tool, it is not a transcript.
 */
/**
 * Issue #207: a tool call's result text from its `content` collection.
 * Text blocks pass through; diffs contribute their new text; anything
 * else contributes a short marker. Untruncated here — the job record
 * truncates with the original length.
 */
export function formatToolResult(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    const single = content as { type?: string; text?: string } | null;
    if (single?.type === "text" && typeof single.text === "string") return single.text;
    return undefined;
  }
  const parts: string[] = [];
  for (const item of content as Array<Record<string, unknown>>) {
    if (item.type === "content") {
      const inner = item.content as { type?: string; text?: string } | undefined;
      if (inner?.type === "text" && typeof inner.text === "string") parts.push(inner.text);
      else if (inner) parts.push(`[${inner.type ?? "content"}]`);
    } else if (item.type === "diff") {
      const path = typeof item.path === "string" ? item.path : "file";
      const newText = typeof item.newText === "string" ? item.newText : "";
      parts.push(newText ? `diff ${path}:\n${newText}` : `diff ${path}`);
    } else if (item.type === "terminal") {
      parts.push(`[terminal ${typeof item.terminalId === "string" ? item.terminalId : ""}]`);
    } else if (typeof item.type === "string") {
      parts.push(`[${item.type}]`);
    }
  }
  if (parts.length === 0) return undefined;
  return parts.join("\n");
}

export function formatToolDetail(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const text = typeof input === "string" ? input : safeJson(input);
  if (!text || text.trim() === "") return undefined;
  // Adapters stream tool calls: the first `tool_call` often carries an
  // empty placeholder (`{}`) before the real arguments arrive on a later
  // update. Treat empty containers as "no detail yet" so the later,
  // real arguments can fill the record instead of sticking as `{}`.
  const trimmed = text.trim();
  if (trimmed === "{}" || trimmed === "[]") return undefined;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function safeJson(input: unknown): string | undefined {
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
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
