/**
 * Minimal raw ACP client wrapper for the M0 spike.
 *
 * Uses @agentclientprotocol/sdk's fluent `client()` API with raw
 * request/notification method strings so we can capture everything:
 * permission requests, session updates (incl. usage_update), prompt
 * responses (incl. unstable `usage` + `_meta` passthrough).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Writable, Readable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface PermissionRequest {
  sessionId: string;
  toolCallId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
}

export interface CollectedUpdate {
  sessionUpdate: string;
  text?: string;
  title?: string;
  status?: string;
  toolName?: string;
  raw: unknown;
}

export interface TurnResult {
  text: string;
  toolCalls: Array<{ id: string; name?: string; title: string; status?: string }>;
  usageUpdates: unknown[];
  permissionRequests: PermissionRequest[];
  updates: CollectedUpdate[];
  response: {
    stopReason: string;
    usage?: unknown;
    _meta?: unknown;
  };
  elapsedMs: number;
}

export type PermissionPolicy = (
  req: PermissionRequest,
) => Promise<{ optionId?: string; cancelled?: boolean }>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class SpikeClient {
  proc: ChildProcess | null = null;
  /** all session/update notifications, keyed by session id */
  private queues = new Map<string, unknown[]>();
  private waiters = new Map<string, Array<() => void>>();
  permissionRequests: PermissionRequest[] = [];
  policy: PermissionPolicy;
  rawLog: Array<{ dir: string; method: string; at: number }> = [];

  constructor(policy?: PermissionPolicy) {
    // Default: deny everything. Prefer an explicit reject option; else cancel.
    this.policy =
      policy ??
      (async (req) => {
        const rejectOpt = req.options.find((o) =>
          /reject|deny/i.test(o.kind + " " + o.name),
        );
        if (rejectOpt) return { optionId: rejectOpt.optionId };
        return { cancelled: true };
      });
  }

  private push(sessionId: string, update: unknown): void {
    if (!this.queues.has(sessionId)) this.queues.set(sessionId, []);
    this.queues.get(sessionId)!.push(update);
    const ws = this.waiters.get(sessionId);
    if (ws) {
      this.waiters.delete(sessionId);
      for (const w of ws) w();
    }
  }

  /** Drain queued updates for a session (non-blocking). */
  drain(sessionId: string): unknown[] {
    const q = this.queues.get(sessionId) ?? [];
    this.queues.set(sessionId, []);
    return q;
  }

  private async waitFor(sessionId: string, timeoutMs: number): Promise<void> {
    const q = this.queues.get(sessionId);
    if (q && q.length > 0) return;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("update wait timeout")), timeoutMs);
      const w = () => {
        clearTimeout(t);
        resolve();
      };
      if (!this.waiters.has(sessionId)) this.waiters.set(sessionId, []);
      this.waiters.get(sessionId)!.push(w);
    });
  }

  /**
   * Spawn the adapter and run `op` with a connected ClientContext.
   * Keeps the process alive until `op` resolves.
   */
  async run<T>(
    cmd: string,
    args: string[],
    env: Record<string, string | undefined>,
    op: (ctx: any) => Promise<T>,
  ): Promise<T> {
    this.proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    const stderr: string[] = [];
    this.proc.stderr?.on("data", (d) => stderr.push(d.toString()));
    this.proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[adapter stderr tail]\n${stderr.join("").slice(-3000)}`);
      }
    });
    if (!this.proc.stdin || !this.proc.stdout) {
      throw new Error("failed to get stdio pipes");
    }
    const input = Writable.toWeb(this.proc.stdin as any) as WritableStream;
    const output = Readable.toWeb(this.proc.stdout as any) as ReadableStream;
    const stream = acp.ndJsonStream(input, output);
    const self = this;
    try {
      return await acp
        .client({ name: "unvibe-m0-spike" })
        .onRequest(
          (acp as any).CLIENT_METHODS?.session_request_permission ??
            "session/request_permission",
          async (ctx: any) => {
            const p = ctx.params as any;
            const req: PermissionRequest = {
              sessionId: p.sessionId,
              toolCallId: p.toolCall?.toolCallId ?? "",
              title: p.toolCall?.title ?? "",
              options: (p.options ?? []).map((o: any) => ({
                optionId: o.optionId,
                name: o.name,
                kind: o.kind,
              })),
            };
            self.permissionRequests.push(req);
            const decision = await self.policy(req);
            if (decision.cancelled || !decision.optionId) {
              return { outcome: { outcome: "cancelled" } };
            }
            return {
              outcome: { outcome: "selected", optionId: decision.optionId },
            };
          },
        )
        .onNotification(
          (acp as any).CLIENT_METHODS?.session_update ?? "session/update",
          async (ctx: any) => {
            const p = ctx.params as any;
            self.push(p.sessionId, p.update);
          },
        )
        .connectWith(stream, op);
    } finally {
      this.proc.kill();
      this.proc = null;
    }
  }

  /** Send session/prompt and collect text + updates + the final response. */
  async prompt(
    ctx: any,
    sessionId: string,
    text: string,
    opts?: { timeoutMs?: number },
  ): Promise<TurnResult> {
    const timeoutMs = opts?.timeoutMs ?? 600_000;
    this.drain(sessionId);
    const permsBefore = this.permissionRequests.length;
    const t0 = Date.now();
    const responseP = ctx.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    // Wait for the turn to finish; keep the queue draining via timeout loop
    // so a stuck turn still surfaces partial output (we don't consume here,
    // just bound the wait — updates accumulate in the queue).
    const response = (await withTimeout(responseP, timeoutMs)) as any;
    // Grace period for straggler notifications flushed before the response.
    await sleep(500);
    const rawUpdates = this.drain(sessionId) as any[];
    const elapsedMs = Date.now() - t0;

    let text_out = "";
    const toolCalls: TurnResult["toolCalls"] = [];
    const usageUpdates: unknown[] = [];
    const updates: CollectedUpdate[] = [];
    for (const u of rawUpdates) {
      const kind = (u as any)?.sessionUpdate as string;
      if (kind === "agent_message_chunk" && (u as any)?.content?.type === "text") {
        text_out += (u as any).content.text;
        updates.push({ sessionUpdate: kind, text: (u as any).content.text, raw: u });
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        toolCalls.push({
          id: (u as any).toolCallId ?? "",
          name: (u as any).name ?? (u as any).toolCall?.name,
          title: (u as any).title ?? "",
          status: (u as any).status ?? "",
        });
        updates.push({
          sessionUpdate: kind,
          title: (u as any).title,
          status: (u as any).status,
          toolName: (u as any).name,
          raw: u,
        });
      } else if (kind === "usage_update") {
        usageUpdates.push(u);
        updates.push({ sessionUpdate: kind, raw: u });
      } else {
        updates.push({ sessionUpdate: kind ?? "?", raw: u });
      }
    }
    return {
      text: text_out,
      toolCalls,
      usageUpdates,
      permissionRequests: this.permissionRequests.slice(permsBefore),
      updates,
      response: {
        stopReason: response.stopReason,
        usage: response.usage,
        _meta: response._meta,
      },
      elapsedMs,
    };
  }

  async cancel(ctx: any, sessionId: string): Promise<void> {
    await ctx.notify("session/cancel", { sessionId });
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(t!);
  }
}

/** Human-readable one-line summary of a usage object. */
export function fmtUsage(u: any): string {
  if (!u) return "none";
  const parts = [
    `total=${u.totalTokens}`,
    `in=${u.inputTokens}`,
    `out=${u.outputTokens}`,
  ];
  if (u.cachedReadTokens != null) parts.push(`cachedRead=${u.cachedReadTokens}`);
  if (u.cachedWriteTokens != null) parts.push(`cachedWrite=${u.cachedWriteTokens}`);
  if (u.thoughtTokens != null) parts.push(`thought=${u.thoughtTokens}`);
  const extra = Object.keys(u).filter(
    (k) =>
      ![
        "totalTokens",
        "inputTokens",
        "outputTokens",
        "cachedReadTokens",
        "cachedWriteTokens",
        "thoughtTokens",
        "_meta",
      ].includes(k),
  );
  for (const k of extra) parts.push(`${k}=${JSON.stringify((u as any)[k])}`);
  return parts.join(" ");
}

/** Cache-read share of input, when the adapter reports it. */
export function cacheShare(u: any): string {
  if (!u || u.cachedReadTokens == null || u.inputTokens == null) return "n/a";
  const denom = u.inputTokens + (u.cachedReadTokens ?? 0);
  if (!denom) return "n/a";
  return `${((100 * u.cachedReadTokens) / denom).toFixed(1)}%`;
}
