/**
 * Spike #171: a native Pi `AgentRunner`, embedding Pi's SDK in the service
 * process. No ACP anywhere (nothing here imports `@agentclientprotocol/*`).
 *
 * What it does differently from the ACP runner:
 * - Unvibe owns the whole tool list: guarded `read` + `ls` (paths must stay
 *   inside the session's cwd) plus the review tools bridged from the
 *   session's MCP servers (`mcp-bridge.ts`). No bash, edit, write, grep or
 *   find exist in the session, so there is nothing to deny at call time.
 * - Unvibe owns the whole system prompt: a full-control `ResourceLoader`
 *   loads no AGENTS.md / CLAUDE.md from the reviewed repo, no skills, no
 *   extensions, no prompt templates.
 * - Fork = copy the base's session file (`SessionManager.forkFrom`) and
 *   rebuild the session with the same system prompt and tools; the fork
 *   reuses the base's provider cache key (`agent.sessionId`), so the
 *   request prefix and the routing key both match the base.
 * - Sessions persist as Pi JSONL files under `sessionDir`, plus a small
 *   sidecar with what Pi does not store (system prompt, MCP servers, cache
 *   key), so `load()` works after a service restart.
 */
import fs from "node:fs";
import path from "node:path";
import {
  createAgentSession,
  createExtensionRuntime,
  createLsToolDefinition,
  createReadToolDefinition,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ResourceLoader,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AgentRunner,
  McpServerConfig,
  Session,
} from "../../../packages/shared/src/agent.ts";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { bridgeMcpServers, type BridgedTools } from "./mcp-bridge.ts";

// Pi loads OAuth flows through a variable import specifier that a bundler
// cannot follow; register them statically so an esbuild bundle (how the
// service ships its adapters) can refresh the ChatGPT token.
registerBunOAuthFlows();

/** Unvibe provider id for "ChatGPT subscription through Pi". */
export const PI_PROVIDER = "pi";
/**
 * Pi's two ways onto a ChatGPT subscription:
 * - "openai-codex": the Codex backend (chatgpt.com/backend-api) with the
 *   Codex CLI's OAuth client; Pi calls it legacy.
 * - "openai": "Sign in with ChatGPT" on the OpenAI Responses API
 *   (api.openai.com), a registered agent client.
 */
export type PiUpstream = "openai-codex" | "openai";

export interface PiRunnerOptions {
  /** Which subscription route (default "openai-codex"). */
  upstream?: PiUpstream;
  /** Pi agent dir: holds `auth.json` (the ChatGPT OAuth token). Unvibe-owned, never ~/.pi. */
  agentDir: string;
  /** Where the ChatGPT OAuth credential lives (default `<agentDir>/auth.json`). */
  authPath?: string;
  /** Where session JSONL files and sidecars live. */
  sessionDir: string;
  /** Test hook: rewrite the model (e.g. point baseUrl at a fake backend). */
  mapModel?: (model: NonNullable<ReturnType<ModelRuntime["getModel"]>>) => typeof model;
  /** "auto" (WebSocket, SSE fallback) in production; "sse" for the fake backend. */
  transport?: "auto" | "sse";
  /** Forks reuse the base's provider cache key (default true). */
  shareCacheKey?: boolean;
  /**
   * MCP secrets live in the service's memory, so after a restart the stored
   * URLs are dead. The service hands out fresh ones for a reloaded session.
   */
  reissueMcp?: (sessionId: string, old: McpServerConfig[]) => McpServerConfig[];
}

interface Sidecar {
  id: string;
  file: string;
  cwd: string;
  model: string;
  systemPrompt: string;
  mcpServers: McpServerConfig[];
  cacheKey: string;
}

interface Live {
  meta: Sidecar;
  session: AgentSession;
  bridgeKey: string;
}

/**
 * One MCP connection per issued server set, shared by the base and its
 * forks. The service's MCP mount accepts one `initialize` per secret, so a
 * fork must not open a second connection to the base's URL.
 */
interface SharedBridge {
  bridged: Promise<BridgedTools>;
  refs: number;
}

export class PiAgentRunner implements AgentRunner {
  private runtime?: Promise<ModelRuntime>;
  private readonly live = new Map<string, Live>();
  private readonly bridges = new Map<string, SharedBridge>();
  private readonly upstream: PiUpstream;

  constructor(private readonly opts: PiRunnerOptions) {
    this.upstream = opts.upstream ?? "openai-codex";
    fs.mkdirSync(path.join(opts.sessionDir, "unvibe"), { recursive: true });
  }

  private modelRuntime(): Promise<ModelRuntime> {
    this.runtime ??= ModelRuntime.create({
      authPath: this.opts.authPath ?? path.join(this.opts.agentDir, "auth.json"),
      modelsPath: path.join(this.opts.agentDir, "models.json"),
    });
    return this.runtime;
  }

  /** Doctor/readiness: is a ChatGPT login stored for Pi? */
  async loginStatus(): Promise<{ configured: boolean; oauth: boolean }> {
    const rt = await this.modelRuntime();
    return { configured: rt.hasConfiguredAuth(this.upstream), oauth: rt.isUsingOAuth(this.upstream) };
  }

  async listModels(): Promise<string[]> {
    const rt = await this.modelRuntime();
    return rt.getModels(this.upstream).map((m) => m.id);
  }

  async start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  }): Promise<Session> {
    if (opts.provider !== PI_PROVIDER) throw new Error(`PiAgentRunner serves provider "${PI_PROVIDER}" only`);
    const manager = SessionManager.create(opts.cwd, this.opts.sessionDir);
    const id = manager.getSessionId();
    const meta: Sidecar = {
      id,
      file: manager.getSessionFile() ?? "",
      cwd: opts.cwd,
      model: opts.model,
      systemPrompt: opts.systemPrompt,
      mcpServers: opts.mcpServers,
      cacheKey: id,
    };
    return this.open(meta, manager);
  }

  async fork(base: Session): Promise<Session> {
    const parent = this.live.get(base.id) ?? (await this.loadLive(base.id));
    const file = parent.session.sessionFile;
    if (!file) throw new Error("base session is not persisted");
    const manager = SessionManager.forkFrom(file, parent.meta.cwd, this.opts.sessionDir);
    const id = manager.getSessionId();
    const meta: Sidecar = {
      ...parent.meta,
      id,
      file: manager.getSessionFile() ?? "",
      cacheKey: this.opts.shareCacheKey === false ? id : parent.meta.cacheKey,
    };
    return this.open(meta, manager);
  }

  async load(sessionId: string): Promise<Session> {
    const l = await this.loadLive(sessionId);
    return { id: l.meta.id, provider: PI_PROVIDER, model: l.meta.model };
  }

  private async loadLive(sessionId: string): Promise<Live> {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const meta = JSON.parse(fs.readFileSync(this.sidecarPath(sessionId), "utf8")) as Sidecar;
    if (this.opts.reissueMcp) meta.mcpServers = this.opts.reissueMcp(sessionId, meta.mcpServers);
    await this.open(meta, SessionManager.open(meta.file, this.opts.sessionDir, meta.cwd));
    return this.live.get(sessionId)!;
  }

  private sidecarPath(id: string): string {
    return path.join(this.opts.sessionDir, "unvibe", `${id}.json`);
  }

  private async open(meta: Sidecar, manager: SessionManager): Promise<Session> {
    const rt = await this.modelRuntime();
    let model = rt.getModel(this.upstream, meta.model);
    if (!model) throw new Error(`unknown ${this.upstream} model ${meta.model}`);
    if (this.opts.mapModel) model = this.opts.mapModel(model);

    const bridgeKey = JSON.stringify(meta.mcpServers);
    let shared = this.bridges.get(bridgeKey);
    if (!shared) {
      shared = { bridged: bridgeMcpServers(meta.mcpServers), refs: 0 };
      this.bridges.set(bridgeKey, shared);
    }
    shared.refs += 1;
    const bridged = await shared.bridged;
    const customTools: ToolDefinition[] = [
      createReadToolDefinition(meta.cwd, { operations: guardedReadOps(meta.cwd) }) as ToolDefinition,
      createLsToolDefinition(meta.cwd, { operations: guardedLsOps(meta.cwd) }) as ToolDefinition,
      ...bridged.tools,
    ];

    const { session } = await createAgentSession({
      cwd: meta.cwd,
      agentDir: this.opts.agentDir,
      modelRuntime: rt,
      model,
      resourceLoader: fixedPrompt(meta.systemPrompt),
      noTools: "builtin",
      customTools,
      sessionManager: manager,
      settingsManager: SettingsManager.inMemory({
        compaction: { enabled: false },
        // Unvibe's job queue owns retries and back-off.
        retry: { enabled: false },
        transport: this.opts.transport ?? "auto",
        cacheWarming: "off",
        enableInstallTelemetry: false,
      }),
    });
    session.agent.sessionId = meta.cacheKey;

    meta.file = session.sessionFile ?? meta.file;
    fs.writeFileSync(this.sidecarPath(meta.id), JSON.stringify(meta, null, 2));
    this.live.set(meta.id, { meta, session, bridgeKey });
    return { id: meta.id, provider: PI_PROVIDER, model: meta.model };
  }

  async *prompt(s: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const l = this.live.get(s.id) ?? (await this.loadLive(s.id));
    const { session } = l;
    const queue: AgentEvent[] = [];
    let wake: (() => void) | undefined;
    let finished = false;
    const push = (e: AgentEvent) => {
      queue.push(e);
      wake?.();
    };
    let lastStop = "end_turn";

    const unsubscribe = session.subscribe((ev: AgentSessionEvent) => {
      switch (ev.type) {
        case "message_update":
          if (ev.assistantMessageEvent.type === "text_delta") push({ type: "text", delta: ev.assistantMessageEvent.delta });
          break;
        case "tool_execution_start":
          push({ type: "tool", name: ev.toolName, status: "start" });
          break;
        case "tool_execution_end":
          push({ type: "tool", name: ev.toolName, status: "end" });
          break;
        case "message_end": {
          const m = ev.message as { role?: string; usage?: PiUsage; stopReason?: string; errorMessage?: string };
          if (m.role !== "assistant") break;
          // Pi reports usage per provider request (one per model turn), with
          // cache reads and writes already split out of `input`.
          if (m.usage) {
            push({
              type: "usage",
              inputTokens: m.usage.input,
              cachedReadTokens: m.usage.cacheRead,
              cachedWriteTokens: m.usage.cacheWrite,
              outputTokens: m.usage.output,
            });
          }
          if (m.stopReason === "error") {
            push({ type: "error", message: m.errorMessage ?? "provider error", retryable: isRetryable(m.errorMessage) });
          }
          lastStop = mapStop(m.stopReason);
          break;
        }
        case "agent_settled":
          push({ type: "done", stopReason: ev.aborted ? "cancelled" : lastStop });
          finished = true;
          break;
      }
    });

    const onAbort = () => void session.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const run = session.prompt(text).catch((err: unknown) => {
      push({ type: "error", message: err instanceof Error ? err.message : String(err), retryable: false });
      finished = true;
      wake?.();
    });
    try {
      while (true) {
        if (queue.length === 0) {
          if (finished) break;
          await new Promise<void>((r) => (wake = r));
          wake = undefined;
          continue;
        }
        const e = queue.shift()!;
        yield e;
        if (e.type === "done") break;
      }
      await run;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
    }
  }

  async close(s: Session): Promise<void> {
    const l = this.live.get(s.id);
    if (!l) return;
    this.live.delete(s.id);
    l.session.dispose();
    const shared = this.bridges.get(l.bridgeKey);
    if (shared && --shared.refs === 0) {
      this.bridges.delete(l.bridgeKey);
      await (await shared.bridged).close();
    }
  }

  async dispose(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.close({ id, provider: PI_PROVIDER, model: "" });
  }
}

interface PiUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

function mapStop(reason: string | undefined): string {
  switch (reason) {
    case "length":
      return "max_tokens";
    case "aborted":
      return "cancelled";
    default:
      return "end_turn";
  }
}

function isRetryable(message: string | undefined): boolean {
  return /rate.?limit|429|5\d\d|overloaded|timeout|ECONNRESET|fetch failed|usage limit/i.test(message ?? "");
}

/** Unvibe's system prompt and nothing else: no repo context files, skills or extensions. */
function fixedPrompt(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/** Resolve symlinks and refuse anything outside `root`. */
function inside(root: string, p: string): string {
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(p);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new Error(`path is outside the review worktree: ${p}`);
  }
  return real;
}

function guardedReadOps(root: string) {
  return {
    readFile: async (p: string) => fs.promises.readFile(inside(root, p)),
    access: async (p: string) => fs.promises.access(inside(root, p), fs.constants.R_OK),
  };
}

function guardedLsOps(root: string) {
  return {
    exists: (p: string) => {
      try {
        inside(root, p);
        return true;
      } catch {
        return false;
      }
    },
    stat: (p: string) => fs.statSync(inside(root, p)),
    readdir: (p: string) => fs.readdirSync(inside(root, p)),
  };
}
