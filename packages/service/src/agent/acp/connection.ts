/**
 * One adapter subprocess per provider, started lazily, multiplexing sessions.
 *
 * - The `claude`/`codex` CLIs are found on the PATH resolved from a
 *   login shell (`exec/shell-path.ts`), never hard-coded install paths.
 * - Restart on crash with in-flight prompts failing as retryable errors.
 * - `session/update` notifications are demultiplexed per session so
 *   concurrent prompts on different sessions stream independently.
 * - Permission requests are answered by policy (see permissions.ts);
 *   terminal + client-fs requests are denied outright.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { createRequire } from "node:module";
import * as acp from "@agentclientprotocol/sdk";
import { resolvePathFromLoginShell } from "../../exec/shell-path.js";
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
      cachedLoginPath = await resolvePathFromLoginShell();
    } catch {
      cachedLoginPath = process.env.PATH ?? "";
    }
  }
  return cachedLoginPath;
}

export function resolveAdapterEntry(provider: ProviderId): string {
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
}

export type TransportFactory = (provider: ProviderId) => Promise<Transport>;

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
  opts?: { env?: Record<string, string>; onStderr?: (s: string) => void },
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
  const proc: ChildProcess = spawn(process.execPath, [entry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(opts?.env ?? {}),
      PATH: merged.join(":"),
      NO_BROWSER: "1",
    },
  });
  if (!proc.stdin || !proc.stdout) {
    proc.kill();
    throw new Error(`${provider} adapter failed to open stdio pipes`);
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

  constructor(
    readonly provider: ProviderId,
    private factory: TransportFactory = (p) =>
      spawnAdapterTransport(p, {
        onStderr: (s) => {
          this.stderrTail = (this.stderrTail + s).slice(-4000);
        },
      }),
  ) {}

  get stderr(): string {
    return this.stderrTail;
  }

  get alive(): boolean {
    return this.transport !== null;
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
    if (!ready) throw new Error(`${this.provider} adapter failed to start`);
    return ready.caller;
  }

  private async start(): Promise<void> {
    const t = (await this.factory(this.provider)) as Transport & {
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
