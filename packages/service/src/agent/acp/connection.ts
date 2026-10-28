/**
 * One adapter subprocess per provider, started lazily, multiplexing sessions.
 *
 * - The user's installed `claude`/`codex` CLIs are found on the PATH
 *   resolved from a login shell (`diagnostics/path-probe.ts`), never hard-coded
 *   install paths, and each adapter is pointed at them through the mechanism
 *   it really supports (see `exec/agent-bins.ts`): `CLAUDE_CODE_EXECUTABLE`
 *   for claude-agent-acp (→ SDK `pathToClaudeCodeExecutable`), `CODEX_PATH`
 *   for codex-acp (→ `codex app-server`). Explicit `UNVIBE_CLAUDE_BIN` /
 *   `UNVIBE_CODEX_BIN` (or pre-set adapter vars) override the PATH lookup
 *   for unusual installs. No bundled platform binary is ever used.
 * - Restart on crash with in-flight prompts failing as retryable errors.
 * - `session/update` notifications are demultiplexed per session so
 *   concurrent prompts on different sessions stream independently.
 * - Permission requests are answered by policy (see permissions.ts);
 *   terminal + client-fs requests are denied outright.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { probeEffectivePath } from "../../diagnostics/path-probe.js";
import { agentBinEnv, resolveAgentBin } from "../../exec/agent-bins.js";
import { miseIgnoreEnv } from "../../exec/shim-resolve.js";
import { loadConfig } from "../../config.js";
import { diagnoseTool, TOOL_SPECS } from "../../diagnostics/tools.js";
import { RealCommandRunner } from "../../exec/runner.js";
import {
  decidePermission,
  decisionToOutcome,
  type PermissionQuery,
} from "./permissions.js";
import type { ProviderId } from "./types.js";

export interface SessionPolicy {
  mcpServers: string[];
  readOnly: boolean;
}

export interface AgentCaller {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
}

type UpdateCallback = (update: unknown) => void;

const ADAPTER_PKG: Record<ProviderId, string> = {
  claude: "@agentclientprotocol/claude-agent-acp",
  codex: "@agentclientprotocol/codex-acp",
};

let cachedLoginPath: string | null = null;
async function loginPathEnv(): Promise<string> {
  if (cachedLoginPath === null) {
    try {
      const found = await probeEffectivePath();
      cachedLoginPath = found ? found.effectivePath : (process.env.PATH ?? "");
    } catch {
      cachedLoginPath = process.env.PATH ?? "";
    }
  }
  return cachedLoginPath;
}

export const ADAPTER_FILE: Record<ProviderId, string> = {
  claude: "claude.js",
  codex: "codex.js",
};

export function resolveAdapterEntry(provider: ProviderId): string {
  // Prefer the adapter bundle shipped next to the service bundle
  // (`dist/adapters/<provider>.js`, produced by `build:adapters` and shipped
  // in the release tree). The release install has no adapter packages in
  // node_modules at all. In a source checkout without a build, fall back to
  // resolving the adapter package from node_modules.
  try {
    const here = new URL(import.meta.url);
    if (here.protocol === "file:") {
      const bundled = join(dirname(fileURLToPath(here)), "adapters", ADAPTER_FILE[provider]);
      if (existsSync(bundled)) return bundled;
    }
  } catch {
    // fall through to node_modules resolution
  }
  const req = createRequire(import.meta.url);
  try {
    return req.resolve(`${ADAPTER_PKG[provider]}/dist/index.js`);
  } catch {
    // Fallback for packed layouts: node_modules relative to workspace root.
    return `${ADAPTER_PKG[provider]}/dist/index.js`;
  }
}

export interface Transport {
  caller: AgentCaller;
  /** Resolves when the underlying process/stream dies. */
  onDeath: Promise<void>;
  dispose: () => void;
  /**
   * The agent executable the adapter was pointed at
   * (`CLAUDE_CODE_EXECUTABLE` / `CODEX_PATH`), for error messages.
   */
  adapterBin?: string;
}

export type TransportFactory = (provider: ProviderId, readOnly: boolean) => Promise<Transport>;

/**
 * Provider authentication that must survive the full-access scrub
 * (issue #160 follow-up): dropping these would break agent logins that
 * use tokens instead of files. Exact names only — nothing pattern-based,
 * so an unknown provider variable is kept rather than dropped.
 *
 * - Claude Code / Anthropic API: `CLAUDE_CODE_OAUTH_TOKEN` (long-lived
 *   login from `claude setup-token`), `ANTHROPIC_API_KEY`,
 *   `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` (custom endpoint).
 * - Codex / OpenAI API: `OPENAI_API_KEY`, `OPENAI_BASE_URL`,
 *   `CODEX_API_KEY`.
 * - Bedrock: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 *   `AWS_SESSION_TOKEN`, `AWS_REGION`, `AWS_DEFAULT_REGION`,
 *   `AWS_BEARER_TOKEN_BEDROCK`.
 * - Vertex / Gemini: `GOOGLE_API_KEY`, `GEMINI_API_KEY`,
 *   `GOOGLE_APPLICATION_CREDENTIALS`, `GCLOUD_PROJECT`,
 *   `GOOGLE_CLOUD_PROJECT`, `GOOGLE_GENAI_USE_VERTEXAI`.
 */
export const FULL_ACCESS_AUTH_KEEP: ReadonlySet<string> = new Set([
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_BEARER_TOKEN_BEDROCK",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GCLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_GENAI_USE_VERTEXAI",
]);

/** Exact secret names removed from the full-access adapter environment. */
const FULL_ACCESS_DROP_EXACT: ReadonlySet<string> = new Set(["GITHUB_TOKEN", "GH_TOKEN"]);

/**
 * Issue #160: the environment an adapter subprocess inherits, by posture.
 *
 * - Lock-down (`readOnly: true`): the input env unchanged — exactly what
 *   the adapter got before this change. The default posture is
 *   byte-identical down to the spawn env.
 * - Full access: the named secrets an agent has no business with are
 *   removed — `GITHUB_TOKEN`/`GH_TOKEN` (so the agent's own `gh` uses the
 *   keyring login, PRD §15), every `UNVIBE_*` service variable, 1Password
 *   (`OP_*`, `*PASSWORD*`), and error-reporting DSNs (`*SENTRY*`) — while
 *   the provider-auth allowlist above is kept. Everything else passes
 *   through untouched.
 *
 * `UNVIBE_*` audit (follow-up): nothing in the child tree reads our
 * namespace — the adapter bundles contain no `UNVIBE_` reference, the
 * agent CLIs don't know it, and the service consumes its own overrides
 * (`UNVIBE_CLAUDE_BIN`/`UNVIBE_CODEX_BIN` → `CLAUDE_CODE_EXECUTABLE` /
 * `CODEX_PATH`, set explicitly below) before spawning. `UNVIBE_ACP_DEBUG`
 * is read in-process, never by the adapter.
 *
 * Name-based and not a sandbox: an unrestricted shell still reaches the
 * keyring, SSH keys and the data directory regardless. See
 * docs/acp-runner.md.
 */
export function adapterEnvFor(
  readOnly: boolean,
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!readOnly) {
      if (FULL_ACCESS_AUTH_KEEP.has(key)) {
        out[key] = value;
        continue;
      }
      if (FULL_ACCESS_DROP_EXACT.has(key)) continue;
      if (key.startsWith("UNVIBE_")) continue;
      if (key.startsWith("OP_") || /PASSWORD/i.test(key)) continue;
      if (/SENTRY/i.test(key)) continue;
    }
    out[key] = value;
  }
  return out;
}

export interface ClientMaps {
  policies: Map<string, SessionPolicy>;
  queues: Map<string, unknown[]>;
  subs: Map<string, Set<UpdateCallback>>;
}

/**
 * Attach our client (permission policy + update demux) to any ACP stream.
 * Used by the subprocess transport and by unit tests over in-memory streams.
 */
export function connectClient(stream: acp.Stream): {
  conn: acp.ClientConnection;
  caller: AgentCaller;
  maps: ClientMaps;
} {
  const policies = new Map<string, SessionPolicy>();
  const queues = new Map<string, unknown[]>();
  const subs = new Map<string, Set<UpdateCallback>>();
  /** toolCallId -> last seen {title, name} from tool_call updates. Codex
   *  workspace-write approvals arrive with an empty toolCall (no title);
   *  correlating by id recovers which tool is being approved. */
  const toolTitles = new Map<string, { title: string; name?: string }>();
  const push = (sessionId: string, update: unknown): void => {
    if (!queues.has(sessionId)) queues.set(sessionId, []);
    queues.get(sessionId)!.push(update);
    const u = update as {
      sessionUpdate?: string;
      toolCallId?: string;
      title?: string | null;
      name?: string | null;
    };
    if (
      (u?.sessionUpdate === "tool_call" || u?.sessionUpdate === "tool_call_update") &&
      typeof u.toolCallId === "string" &&
      u.toolCallId !== ""
    ) {
      const title = typeof u.title === "string" ? u.title : "";
      const name = typeof u.name === "string" ? u.name : undefined;
      if (title !== "" || name !== undefined) toolTitles.set(u.toolCallId, { title, name });
    }
    const set = subs.get(sessionId);
    if (set) for (const cb of [...set]) cb(update);
  };

  // Single fluent chain (untyped builder calls; wire shapes are covered by
  // unit tests over in-memory streams).
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const full = (acp.client({ name: "unvibe-service" }) as any)
    .onRequest("session/request_permission", async (ctx: any) => {
      const p = ctx.params as {
        sessionId: string;
        toolCall?: { toolCallId?: string; title?: string; name?: string };
        options?: Array<{ optionId: string; name: string; kind: string }>;
        _meta?: { is_mcp_tool_approval?: boolean };
      };
      // Codex may send an empty toolCall on approvals; recover the tool
      // identity from the correlated tool_call update when possible.
      const correlated = p.toolCall?.toolCallId ? toolTitles.get(p.toolCall.toolCallId) : undefined;
      const query: PermissionQuery = {
        sessionId: p.sessionId,
        toolCallId: p.toolCall?.toolCallId ?? "",
        title: p.toolCall?.title || correlated?.title || "",
        name: p.toolCall?.name ?? correlated?.name,
        options: (p.options ?? []).map((o) => ({
          optionId: o.optionId,
          name: o.name,
          kind: o.kind,
        })),
        mcpApproval: p._meta?.is_mcp_tool_approval === true,
      };
      const policy = policies.get(p.sessionId) ?? { mcpServers: [], readOnly: true };
      const decision = decidePermission(query, {
        mcpServers: policy.mcpServers,
        readOnly: policy.readOnly,
      });
      if (process.env.UNVIBE_ACP_DEBUG === "1") {
        process.stderr.write(
          `[acp-perm] title=${JSON.stringify(query.title)} name=${JSON.stringify(query.name)} ` +
            `options=${JSON.stringify(query.options.map((o) => o.kind))} servers=${JSON.stringify(policy.mcpServers)} ` +
            `decision=${JSON.stringify(decision)}\n`,
        );
      }
      if (process.env.UNVIBE_ACP_DEBUG === "2") {
        process.stderr.write(`[acp-perm-full] ${JSON.stringify(p).slice(0, 2000)}\n`);
      }
      return { outcome: decisionToOutcome(decision) };
    })
    .onNotification("session/update", async (ctx: any) => {
      const p = ctx.params as { sessionId: string; update: unknown };
      if (p?.sessionId) push(p.sessionId, p.update);
    })
    .onRequest("fs/write_text_file", async () => {
      throw new acp.RequestError(-32603, "fs/write_text_file denied by Unvibe policy");
    })
    .onRequest("fs/read_text_file", async () => {
      throw new acp.RequestError(-32603, "fs/read_text_file denied by Unvibe policy");
    })
    .onRequest("terminal/create", async () => {
      throw new acp.RequestError(-32603, "terminal/create denied by Unvibe policy");
    })
    .connect(stream) as acp.ClientConnection;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const caller: AgentCaller = {
    request: (method, params) => (full.agent.request as (m: string, p: unknown) => Promise<unknown>)(method, params),
    notify: (method, params) => (full.agent.notify as (m: string, p: unknown) => Promise<void>)(method, params),
  };
  return { conn: full, caller, maps: { policies, queues, subs } };
}

/** Production transport: spawn the adapter over stdio. */
export async function spawnAdapterTransport(
  provider: ProviderId,
  opts?: { env?: Record<string, string>; onStderr?: (s: string) => void; readOnly?: boolean; dataDir?: string },
): Promise<Transport> {
  const loginPath = await loginPathEnv();
  const basePath = process.env.PATH ?? "";
  // Login-shell PATH first (macOS Finder apps miss it), then current PATH,
  // deduplicated. Never hard-code install paths.
  const seen = new Set<string>();
  const merged = [...loginPath.split(":"), ...basePath.split(":")].filter((p) => {
    if (!p || seen.has(p)) return false;
    seen.add(p);
    return true;
  });
  const entry = resolveAdapterEntry(provider);
  // Point each adapter at the user's installed CLI (see exec/agent-bins.ts
  // for the per-adapter mechanism). Explicit test env (`opts.env`) wins;
  // otherwise the adapter-native vars are respected when pre-set, else the
  // login-shell PATH lookup decides. When neither adapter var is set and no
  // user binary is found, surface the install hint instead of letting the
  // adapter fall back to a bundled binary (Unvibe ships none).
  const mergedPath = merged.join(":");
  // Shared diagnostics choice: first candidate that runs (skip broken shims),
  // version only from success — so a broken mise shim is skipped, not used.
  let claudeBin = resolveAgentBin("claude", { pathValue: mergedPath });
  let codexBin = resolveAgentBin("codex", { pathValue: mergedPath });
  try {
    const runner = new RealCommandRunner();
    for (const p of ["claude", "codex"] as const) {
      const spec = TOOL_SPECS.find((s) => s.tool === p);
      if (!spec) continue;
      try {
        const diag = await diagnoseTool(spec, {
          pathValue: mergedPath,
          env: process.env,
          runner,
          timeoutMs: 8000,
          ...(opts?.dataDir ? { dataDir: opts.dataDir } : {}),
        });
        if (diag.chosen) {
          const chosen = { path: diag.chosen, source: diag.candidates.find((c) => c.path === diag.chosen)?.source ?? "login-shell PATH" };
          if (p === "claude") claudeBin = chosen;
          else codexBin = chosen;
        } else if (diag.candidates.length > 0) {
          // All candidates broken: keep null so the specific error below names them.
          if (p === "claude") claudeBin = null;
          else codexBin = null;
        }
      } catch {
        // Fall back to first-on-PATH (diagnostics best-effort here).
      }
    }
  } catch {
    // ignore: fall back to first-on-PATH
  }
  const AutoBins = agentBinEnv({ claude: claudeBin, codex: codexBin }).env;
  const wanted = provider === "claude" ? claudeBin : codexBin;
  const adapterVar = provider === "claude" ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH";
  if (!process.env[adapterVar] && !(opts?.env ?? {})[adapterVar] && !AutoBins[adapterVar]) {
    const cli = provider === "claude" ? "claude" : "codex";
    const hint =
      provider === "claude"
        ? "Install Claude Code (https://code.claude.com/docs/setup) and ensure `claude` is on your login-shell PATH; Unvibe does not install it for you."
        : "Install the Codex CLI (https://developers.openai.com/codex/cli/) and ensure `codex` is on your login-shell PATH; Unvibe does not install it for you.";
    // Specific diagnostic: name the broken candidates when we saw them.
    let tried = "";
    try {
      const spec = TOOL_SPECS.find((s) => s.tool === provider);
      if (spec) {
        const diag = await diagnoseTool(spec, {
          pathValue: mergedPath,
          env: process.env,
          runner: new RealCommandRunner(),
          timeoutMs: 5000,
          ...(opts?.dataDir ? { dataDir: opts.dataDir } : {}),
        });
        if (diag.candidates.length > 0) {
          const first = diag.candidates[0];
          tried = `Tried ${first.path} (via ${first.source}, ${first.kind}): exit ${first.exitCode ?? "?"}${first.stderr ? ` — ${first.stderr.slice(0, 1000)}` : first.stdout ? ` — ${first.stdout.slice(0, 1000)}` : ""}. `;
        }
      }
    } catch {
      // ignore
    }
    throw new Error(
      `${tried}${cli} CLI not usable on your login-shell PATH. ${hint} ` +
        `Unusual install? Set ${provider === "claude" ? "UNVIBE_CLAUDE_BIN or CLAUDE_CODE_EXECUTABLE" : "UNVIBE_CODEX_BIN or CODEX_PATH"} to the executable path. ` +
        `See the Doctor page (/doctor) for every candidate and full error text.`,
    );
  }
  void wanted;
  // Second layer (issue #105): a stray version-manager invocation inside
  // the session must ignore the review copies' configs. `mise` reads
  // MISE_IGNORED_CONFIG_PATHS before any config file, so pointing it at
  // our own worktrees directory keeps the shim working from a global
  // default there without ever trusting the review copy.
  //
  // Third layer (issue #160, follow-up): the full-access adapter
  // inherits a scrubbed environment (named secrets removed, provider
  // auth kept — see `adapterEnvFor`). The lock-down adapter inherits
  // the base env unchanged. Either way this stops casual leakage
  // through the environment — it does NOT sandbox: an unrestricted
  // shell can still read the keyring-backed `gh` login, SSH keys, and
  // the data directory. See docs/acp-runner.md.
  const spawnEnv = adapterEnvFor(opts?.readOnly ?? true, {
    ...process.env,
    ...AutoBins,
    ...(opts?.env ?? {}),
  });
  let worktreesIgnore: Record<string, string> = {};
  try {
    worktreesIgnore = miseIgnoreEnv(loadConfig().dataDir, spawnEnv);
  } catch {
    // best-effort: the session still runs without it
  }
  const adapterBin = spawnEnv[adapterVar];
  const proc: ChildProcess = spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...spawnEnv,
      ...worktreesIgnore,
      PATH: mergedPath,
      NO_BROWSER: "1",
    },
  });
  if (!proc.stdin || !proc.stdout) {
    proc.kill();
    throw new Error(`the ${provider} CLI failed to start`);
  }
  proc.stderr?.on("data", (d) => opts?.onStderr?.(d.toString()));

  const input = Writable.toWeb(proc.stdin as unknown as import("node:stream").Writable) as unknown as WritableStream<Uint8Array>;
  const output = Readable.toWeb(proc.stdout as unknown as import("node:stream").Readable) as unknown as ReadableStream<Uint8Array>;
  // ndJsonStream(writable, readable): first arg is where WE write.
  const stream = acp.ndJsonStream(input, output);

  const { conn, caller, maps } = connectClient(stream);

  let deathResolve!: () => void;
  const onDeath = new Promise<void>((resolve) => {
    deathResolve = resolve;
  });
  proc.on("exit", () => deathResolve());
  proc.on("error", () => deathResolve());

  // Negotiate protocol. Failure here means the adapter is unusable.
  try {
    await (conn.agent.request as (m: string, p: unknown) => Promise<unknown>)("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });
  } catch (e) {
    proc.kill();
    throw e;
  }

  // Share policy/queue maps with the runner via the transport handle.
  const transport: Transport & {
    policies: Map<string, SessionPolicy>;
    queues: Map<string, unknown[]>;
    subs: Map<string, Set<UpdateCallback>>;
  } = {
    caller,
    onDeath,
    ...(adapterBin ? { adapterBin } : {}),
    dispose: () => {
      try {
        conn.close();
      } catch {
        // ignore
      }
      proc.kill();
    },
    policies: maps.policies,
    queues: maps.queues,
    subs: maps.subs,
  };
  return transport;
}

/**
 * Managed connection for one provider with lazy start + crash restart.
 * In-flight callers see the transport die and fail retryably; the next
 * `ensure()` starts a fresh subprocess.
 */
export class ProviderConnection {
  private transport: (Transport & {
    policies: Map<string, SessionPolicy>;
    queues: Map<string, unknown[]>;
    subs: Map<string, Set<UpdateCallback>>;
  }) | null = null;
  private starting: Promise<void> | null = null;
  private disposed = false;
  private stderrTail = "";

  /**
   * Managed connection for one (provider, posture) pair — issue #160
   * follow-up. `readOnly` selects the spawn env (lock-down: base env
   * unchanged; full access: scrubbed); sessions of one posture never
   * share a subprocess with the other.
   */
  constructor(
    readonly provider: ProviderId,
    readonly readOnly: boolean = true,
    private factory: TransportFactory = (p, ro) =>
      spawnAdapterTransport(p, {
        onStderr: (s) => {
          this.stderrTail = (this.stderrTail + s).slice(-4000);
        },
        readOnly: ro,
        ...(this.dataDir ? { dataDir: this.dataDir } : {}),
      }),
    private dataDir?: string,
  ) {}

  /** The posture this connection spawns for ("lockdown" or "full"). */
  get posture(): string {
    return this.readOnly ? "lockdown" : "full";
  }

  get stderr(): string {
    return this.stderrTail;
  }

  get alive(): boolean {
    return this.transport !== null;
  }

  /** The agent executable the live adapter was pointed at, if known. */
  get adapterBin(): string | null {
    const t = this.transport as { adapterBin?: string } | null;
    return t?.adapterBin ?? null;
  }

  async ensure(): Promise<AgentCaller> {
    if (this.disposed) throw new Error(`${this.provider} connection disposed`);
    const existing = this.transport as { caller: AgentCaller } | null;
    if (existing) return existing.caller;
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
    await this.starting;
    const ready = this.transport as { caller: AgentCaller } | null;
    if (!ready) throw new Error(`the ${this.provider} CLI failed to start`);
    return ready.caller;
  }

  private async start(): Promise<void> {
    const t = (await this.factory(this.provider, this.readOnly)) as Transport & {
      policies: Map<string, SessionPolicy>;
      queues: Map<string, unknown[]>;
      subs: Map<string, Set<UpdateCallback>>;
    };
    if (this.disposed) {
      t.dispose();
      return;
    }
    this.transport = t;
    // On death, drop the transport so the next ensure() restarts. In-flight
    // `request()` promises reject via the SDK when the stream closes; the
    // runner maps those to retryable errors.
    void t.onDeath.then(() => {
      if (this.transport === t) this.transport = null;
    });
  }

  /** Crash the connection (tests) or observe a real exit: drop transport. */
  noteDeath(): void {
    if (this.transport) {
      try {
        this.transport.dispose();
      } catch {
        // ignore
      }
      this.transport = null;
    }
  }

  setPolicy(sessionId: string, policy: SessionPolicy): void {
    this.transport?.policies.set(sessionId, policy);
  }

  dropPolicy(sessionId: string): void {
    this.transport?.policies.delete(sessionId);
    this.transport?.queues.delete(sessionId);
  }

  subscribe(sessionId: string, cb: UpdateCallback): () => void {
    const t = this.transport;
    if (!t) return () => {};
    if (!t.subs.has(sessionId)) t.subs.set(sessionId, new Set());
    t.subs.get(sessionId)!.add(cb);
    return () => {
      t.subs.get(sessionId)?.delete(cb);
    };
  }

  drain(sessionId: string): unknown[] {
    const q = this.transport?.queues.get(sessionId) ?? [];
    this.transport?.queues.set(sessionId, []);
    return q;
  }

  /** Re-ensure policy maps exist after a restart (policies are per-transport). */
  reapply(policies: ReadonlyMap<string, SessionPolicy>): void {
    const t = this.transport;
    if (!t) return;
    for (const [id, p] of policies) t.policies.set(id, p);
  }

  dispose(): void {
    this.disposed = true;
    this.transport?.dispose();
    this.transport = null;
  }
}
