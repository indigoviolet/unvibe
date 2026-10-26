/**
 * Native pi `AgentRunner` over `pi --mode rpc` (issue #279, route 2).
 *
 * One pi child process per Unvibe session (pi's RPC mode holds one active
 * session per process):
 * - `start`: spawn `pi --mode rpc` with Unvibe's system prompt, the
 *   read-only (or full-access) `--tools` list, `--no-*` resource flags and
 *   `-e` pointing at the bundled Unvibe extension
 *   (`./extension.js`, written to the data dir at runtime), then `get_state`
 *   for the session id + file. A sidecar next to pi's session files maps
 *   the Unvibe session id back to its file, servers and posture for `load`.
 * - `fork`: spawn with `--fork <base session file>` plus
 *   `UNVIBE_PI_CACHE_KEY=<base id>` so the fork reuses the base's
 *   `prompt_cache_key` (verified: 91% cached vs 0% on its own key).
 * - `load`: spawn with `--session <file>` (full path — a bare id does not
 *   resolve); the MCP probe fails fast on dead post-restart secrets so the
 *   manager rebuilds the base instead of running tool-less.
 * - `prompt`: one prompt at a time per session (chained), streaming
 *   text/tool/usage events; per-turn usage aggregates the provider-request
 *   usages (#125 split kept: input net of cache, cacheRead, cacheWrite,
 *   output); `abort` cancels through the `abort` command.
 * - `close`/`dispose`: end stdin (orderly pi shutdown), SIGTERM/SIGKILL
 *   fallback.
 *
 * Nothing here imports `@agentclientprotocol/*` (nothing outside
 * `agent/acp/` may). The only new subprocess is the user's own `pi`
 * (see `./detect.js`); the service process itself still contacts nothing
 * but loopback. MCP bridging runs inside the pi child over loopback.
 *
 * Read-only vs full access (issue #160) on this route:
 * - Read-only (default): `--tools read,ls` + the review tools, where the
 *   extension's guarded `read`/`ls` replacements refuse anything outside
 *   the review worktree (symlinks resolved). No shell, edit, write, grep
 *   or find exists in the session, so there is nothing to approve or deny.
 * - Full access: `--tools read,bash,edit,write,grep,find,ls` + the review
 *   tools. Pi has no sandbox and no per-call approval (its own docs say
 *   tools run with the user's permissions and never ask), so the limits
 *   live only in the system prompt — exactly like Codex's agent-full-access
 *   mode. It stays sandboxable because pi is a separate child process:
 *   it spawns with a scrubbed environment (same denylist as the ACP
 *   adapters: no `GITHUB_TOKEN`/`GH_TOKEN`, no `UNVIBE_*`, no `OP_*` or
 *   `*PASSWORD*`, no Sentry DSNs; provider-auth variables are kept so the
 *   user's pi login keeps working), and the boundary is a process that a
 *   future change can wrap without touching the service.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, AgentRunner, McpServerConfig, ModelInfo, Session } from "@unvibe/shared";
import { isPiAvailable, PI_PROVIDER, piTooOldMessage, piVersionMeetsMin, resolvePiBin } from "./detect.js";
import { PI_EXTENSION_SOURCE } from "./extension.js";
import { assertLiveAgentAllowed } from "../live-guard.js";
import { loadConfig } from "../../config.js";
import { parseVersion } from "../../exec/agent-bins.js";

/** Review tool names Unvibe's MCP mount offers (tools.ts). Named in `--tools`
 * so the allowlist keeps the extension-registered bridge tools; pi ignores
 * names that never register (e.g. `pin_context` on non-reader sessions). */
export const PI_REVIEW_TOOLS = ["get_hunk", "get_code", "search_review", "resolve", "pin_context"] as const;

/** Built-ins for the default read-only posture. */
const PI_READONLY_TOOLS = ["read", "ls"] as const;

/** Built-ins for the full-access opt-in (issue #160): pi's own file/shell
 * tools unrestricted, review tools alongside. No sandbox (see above). */
const PI_FULL_ACCESS_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

export interface PiRunnerOptions {
  env?: NodeJS.ProcessEnv;
  /** pi session files (default `<dataDir>/pi-sessions`). */
  sessionDir?: string;
  /** Exact pi binary (tests point at the fake). */
  binPath?: string;
  /** Extension source override (tests). Defaults to PI_EXTENSION_SOURCE. */
  extensionSource?: string;
  /** Model/thinking catalog cache (default 5 min, like the ACP runner). */
  modelCacheMs?: number;
}

interface PiSessionRecord {
  id: string;
  sessionFile: string;
  cwd: string;
  model: string;
  piProvider: string;
  mcpServers: McpServerConfig[];
  readOnly: boolean;
  effort: string;
  cacheKey: string;
  child: RpcProcess;
}

interface Sidecar {
  id: string;
  sessionFile: string;
  cwd: string;
  model: string;
  piProvider: string;
  mcpServers: McpServerConfig[];
  readOnly: boolean;
  effort: string;
  cacheKey: string;
}

/** Minimal MCP client shape the runner probes with (initialize + delete). */
async function probeMcpUrl(url: string, timeoutMs: number): Promise<void> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = await globalThis.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "unvibe-probe",
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unvibe-pi-probe", version: "0.0.0" } },
      }),
      signal: ctrl.signal,
    });
    if (init.status === 404) {
      throw new Error(
        `pi MCP mount is gone (HTTP 404 at ${url}): the session was issued before a restart. ` +
          `The session rebuilds from the base with fresh servers.`,
      );
    }
    if (!init.ok) throw new Error(`pi MCP probe got HTTP ${init.status} at ${url}`);
    const sid = init.headers.get("mcp-session-id");
    // Best-effort close of the probe connection (the registry drops it on DELETE).
    try {
      if (sid) {
        await globalThis.fetch(url, {
          method: "DELETE",
          headers: { "mcp-session-id": sid },
          signal: AbortSignal.timeout(3000),
        });
      }
    } catch {
      // ignore: a leaked probe connection is inert (no SSE stream was opened).
    }
  } catch (e) {
    if (e instanceof Error && /gone \(HTTP 404/.test(e.message)) throw e;
    throw new Error(`pi cannot reach its MCP tools at ${url}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Issue #160 follow-up: the environment a pi child inherits, by posture.
 * Mirrors `adapterEnvFor` in `agent/acp/connection.ts` (same denylist, same
 * kept provider-auth allowlist): lock-down passes the env through unchanged;
 * full access drops service secrets while keeping the login working.
 */
const PI_FULL_ACCESS_AUTH_KEEP: ReadonlySet<string> = new Set([
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

export function piEnvFor(readOnly: boolean, env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (!readOnly) {
      if (PI_FULL_ACCESS_AUTH_KEEP.has(key)) {
        out[key] = value;
        continue;
      }
      if (key === "GITHUB_TOKEN" || key === "GH_TOKEN") continue;
      if (key.startsWith("UNVIBE_")) continue;
      if (key.startsWith("OP_") || /PASSWORD/i.test(key)) continue;
      if (/SENTRY/i.test(key)) continue;
    }
    out[key] = value;
  }
  return out;
}

function isRetryablePiError(message: string): boolean {
  const m = message.toLowerCase();
  if (/auth|login|unauthenticated|unauthorized|not logged|sign in|oauth|token|credential|forbidden|401|403/.test(m)) return false;
  return true;
}

type RpcEvent = Record<string, unknown>;

/**
 * One `pi --mode rpc` child: JSONL in, JSONL out (split on LF only —
 * Unicode line separators are valid inside JSON strings).
 */
class RpcProcess {
  private buf = "";
  private readonly waiters: (() => void)[] = [];
  private readonly events: RpcEvent[] = [];
  private cmdSeq = 0;
  private exited: { code: number | null } | null = null;
  private readonly exitWaiters: ((code: number | null) => void)[] = [];
  readonly stderr: string[] = [];

  constructor(readonly child: ChildProcess) {
    child.stdout?.on("data", (d: Buffer) => this.onData(d.toString("utf8")));
    child.stderr?.on("data", (d: Buffer) => {
      this.stderr.push(d.toString("utf8"));
      if (this.stderr.length > 20) this.stderr.shift();
    });
    child.once("exit", (code) => {
      this.exited = { code };
      for (const w of this.exitWaiters.splice(0)) w(code);
      for (const w of this.waiters.splice(0)) w();
    });
    child.once("error", () => {
      if (!this.exited) {
        this.exited = { code: null };
        for (const w of this.exitWaiters.splice(0)) w(null);
        for (const w of this.waiters.splice(0)) w();
      }
    });
  }

  private onData(text: string): void {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      try {
        this.events.push(JSON.parse(line) as RpcEvent);
      } catch {
        this.events.push({ type: "parse-error", line: line.slice(0, 500) });
      }
    }
    for (const w of this.waiters.splice(0)) w();
  }

  /** Events appended since `from` (live view; do not mutate). */
  since(from: number): RpcEvent[] {
    return this.events.slice(from);
  }

  get eventCount(): number {
    return this.events.length;
  }

  /** Waits until at least `target` events have been seen. */
  waitForCount(target: number, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.exited) {
        reject(new Error(`pi exited (code ${this.exited.code}) while waiting; stderr: ${this.stderr.join("").slice(0, 500)}`));
        return;
      }
      if (this.events.length >= target) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        if (this.exited) {
          reject(new Error(`pi exited (code ${this.exited.code}) while waiting; stderr: ${this.stderr.join("").slice(0, 500)}`));
        } else {
          reject(new Error(`timed out waiting for pi (${timeoutMs}ms)`));
        }
      }, timeoutMs);
      if (typeof (timer as unknown as { unref?: unknown }).unref === "function") {
        (timer as unknown as { unref: () => void }).unref();
      }
      const cleanup = (): void => {
        clearTimeout(timer);
        const i = this.waiters.indexOf(wake);
        if (i >= 0) this.waiters.splice(i, 1);
      };
      const wake = (): void => {
        if (this.exited || this.events.length >= target) {
          cleanup();
          if (this.exited) {
            reject(new Error(`pi exited (code ${this.exited.code}) while waiting; stderr: ${this.stderr.join("").slice(0, 500)}`));
          } else {
            resolve();
          }
          return;
        }
        this.waiters.push(wake);
      };
      this.waiters.push(wake);
    });
  }

  async call(cmd: Record<string, unknown>, timeoutMs = 60000): Promise<RpcEvent> {
    if (this.exited) throw new Error(`pi is not running (exited with code ${this.exited.code})`);
    const id = `unvibe-${++this.cmdSeq}`;
    const from = this.events.length;
    this.child.stdin?.write(JSON.stringify({ ...cmd, id }) + "\n");
    for (;;) {
      await this.waitForCount(this.events.length + 1, timeoutMs);
      const hit = this.events.slice(from).find((e) => e["id"] === id && e["type"] === "response");
      if (hit) {
        if (hit["success"] !== true) {
          throw new Error(`pi ${String(cmd["type"])} failed: ${String(hit["error"] ?? "unknown error")}`);
        }
        return hit;
      }
      // Another event arrived first (session events interleave); keep waiting.
    }
  }

  async kill(): Promise<void> {
    if (this.exited) return;
    try {
      this.child.stdin?.end();
    } catch {
      // ignore
    }
    const exited = await Promise.race([
      new Promise<true>((resolve) => this.exitWaiters.push(() => resolve(true))),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000)),
    ]);
    if (!exited) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // ignore
      }
      const termed = await Promise.race([
        new Promise<true>((resolve) => this.exitWaiters.push(() => resolve(true))),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (!termed) {
        try {
          this.child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
  }
}

export class PiAgentRunner implements AgentRunner {
  private readonly env: NodeJS.ProcessEnv;
  private readonly sessionDir: string;
  private readonly binPath?: string;
  private readonly extensionSource: string;
  private readonly modelCacheMs: number;
  private readonly live = new Map<string, PiSessionRecord>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private extensionPath: string | null = null;
  private modelsCache: { at: number; models: ModelInfo[]; providers: Map<string, string> } | null = null;
  private thinkingCache: { at: number; options: { value: string; name?: string; description?: string }[] } | null = null;
  private versionCache: { at: number; version: string | null } | null = null;

  constructor(opts: PiRunnerOptions = {}) {
    this.env = opts.env ?? process.env;
    this.sessionDir =
      opts.sessionDir ?? path.join(loadConfig(this.env).dataDir, "pi-sessions");
    this.binPath = opts.binPath;
    this.extensionSource = opts.extensionSource ?? PI_EXTENSION_SOURCE;
    this.modelCacheMs = opts.modelCacheMs ?? 5 * 60_000;
    // Direct construction with no fake binary would spawn the user's real
    // pi and spend subscription usage (#188): require the live flag eagerly.
    if (!this.binPath) assertLiveAgentAllowed(this.env);
  }

  /** pi binary for this runner (override or PATH lookup). */
  private piBin(): string {
    if (this.binPath) return this.binPath;
    const resolved = resolvePiBin({ env: this.env });
    if (!resolved || resolved.source.endsWith("(missing)") || !isPiAvailable({ env: this.env })) {
      throw new Error(
        "pi is not installed (not on PATH). Install Pi (https://pi.dev) and ensure `pi` is on your login-shell PATH; Unvibe does not install it for you.",
      );
    }
    return resolved.path;
  }

  private sidecarPath(id: string): string {
    return path.join(this.sessionDir, "unvibe", `${id}.json`);
  }

  private writeSidecar(rec: Pick<Sidecar, "id" | "sessionFile" | "cwd" | "model" | "piProvider" | "mcpServers" | "readOnly" | "effort" | "cacheKey">): void {
    fs.mkdirSync(path.join(this.sessionDir, "unvibe"), { recursive: true });
    fs.writeFileSync(this.sidecarPath(rec.id), JSON.stringify(rec, null, 2));
  }

  private readSidecar(id: string): Sidecar {
    let raw: string;
    try {
      raw = fs.readFileSync(this.sidecarPath(id), "utf8");
    } catch {
      throw new Error(`unknown pi session ${JSON.stringify(id)} (no record; cannot load)`);
    }
    return JSON.parse(raw) as Sidecar;
  }

  private ensureExtension(): string {
    if (this.extensionPath && fs.existsSync(this.extensionPath)) return this.extensionPath;
    const dir = path.join(this.sessionDir, "unvibe-extension");
    fs.mkdirSync(dir, { recursive: true });
    // Plain JS (see extension.ts): no build step, no compiler on load.
    const file = path.join(dir, "unvibe-pi.js");
    const prev = (() => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    })();
    if (prev !== this.extensionSource) fs.writeFileSync(file, this.extensionSource);
    this.extensionPath = file;
    return file;
  }

  private async spawnPi(opts: {
    cwd: string;
    piProvider: string;
    model: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
    readOnly: boolean;
    effort: string;
    cacheKey?: string;
    forkFrom?: string;
    resumeFile?: string;
  }): Promise<{ proc: RpcProcess; sessionId: string; sessionFile: string }> {
    const bin = this.piBin();
    for (const s of opts.mcpServers) {
      if (!s.url) {
        throw new Error(`pi can only bridge HTTP MCP servers (got stdio server ${JSON.stringify(s.name)})`);
      }
    }
    // Fail fast on dead post-restart secrets: the extension would otherwise
    // come up without tools and the turn would fail later, mid-pipeline.
    // Fresh secrets (start) always pass; this only trips after a restart,
    // where the manager rebuilds from the base with fresh servers.
    await Promise.all(opts.mcpServers.map((s) => probeMcpUrl(s.url!, 8000)));

    const tools = [...(opts.readOnly ? PI_READONLY_TOOLS : PI_FULL_ACCESS_TOOLS), ...PI_REVIEW_TOOLS];
    const baseEnv = piEnvFor(opts.readOnly, this.env);
    // The system prompt rides in argv (verified with multi-KB prompts).
    // When empty (small one-shot sessions, and fork/load which inherit the
    // session file's prompt), the flag is omitted: pi keeps the prompt the
    // session file already carries, so base and fork prefixes stay identical.
    const child = spawn(
      bin,
      [
        "--mode",
        "rpc",
        "--provider",
        opts.piProvider,
        "--model",
        opts.model,
        ...(opts.effort ? ["--thinking", opts.effort] : []),
        ...(opts.systemPrompt ? ["--system-prompt", opts.systemPrompt] : []),
        "--no-context-files",
        "--no-extensions",
        "--no-mcp",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--tools",
        tools.join(","),
        "--session-dir",
        this.sessionDir,
        "--offline",
        "-e",
        this.ensureExtension(),
        ...(opts.forkFrom ? ["--fork", opts.forkFrom] : []),
        ...(opts.resumeFile ? ["--session", opts.resumeFile] : []),
      ],
      {
        cwd: opts.cwd,
        env: {
          ...baseEnv,
          PI_SKIP_VERSION_CHECK: "1",
          PI_TELEMETRY: "0",
          ...(opts.readOnly ? { PI_OFFLINE: "1" } : {}),
          UNVIBE_PI_MCP_SERVERS: JSON.stringify(opts.mcpServers.map((s) => ({ name: s.name, url: s.url }))),
          ...(opts.cacheKey ? { UNVIBE_PI_CACHE_KEY: opts.cacheKey } : {}),
          UNVIBE_PI_READONLY: opts.readOnly ? "1" : "0",
          UNVIBE_PI_CWD: opts.cwd,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const proc = new RpcProcess(child);
    try {
      const state = await proc.call({ type: "get_state" }, 60000);
      const data = state["data"] as { sessionId?: string; sessionFile?: string } | undefined;
      const sessionId = typeof data?.sessionId === "string" ? data.sessionId : "";
      const sessionFile = typeof data?.sessionFile === "string" ? data.sessionFile : "";
      if (!sessionId) throw new Error("pi did not report a session id");
      return { proc, sessionId, sessionFile };
    } catch (e) {
      await proc.kill();
      throw e;
    }
  }

  private remember(rec: PiSessionRecord): Session {
    // Forks keep the base's process alive: one pi child per Unvibe session.
    this.live.set(rec.id, rec);
    this.writeSidecar(rec);
    return { id: rec.id, provider: PI_PROVIDER, model: rec.model };
  }

  private requireLive(session: Session): PiSessionRecord {
    const rec = this.live.get(session.id);
    if (!rec) {
      const sidecar = (() => {
        try {
          return this.readSidecar(session.id);
        } catch {
          return null;
        }
      })();
      throw new Error(
        sidecar
          ? `pi session ${session.id} is closed; call load(${JSON.stringify(session.id)}) to reopen`
          : `unknown pi session ${JSON.stringify(session.id)}`,
      );
    }
    return rec;
  }

  async start(opts: {
    provider: string;
    model: string;
    cwd: string;
    systemPrompt: string;
    mcpServers: McpServerConfig[];
  } & { readOnly?: boolean; effort?: string }): Promise<Session> {
    if (opts.provider !== PI_PROVIDER) throw new Error(`PiAgentRunner serves provider "pi" only`);
    if (!(await this.isSupported())) {
      const version = await this.piVersion();
      throw new Error(
        version ? piTooOldMessage(version) : "pi is not installed (not on PATH). Install Pi (https://pi.dev) and ensure `pi` is on your login-shell PATH; Unvibe does not install it for you.",
      );
    }
    const readOnly = opts.readOnly ?? true;
    const effort = opts.effort ?? "";
    const resolved = await this.resolveModel(opts.model);
    // No cache-key override on a fresh base: pi already keys the base's own
    // requests by this session's id; the id is learned from get_state below.
    const { proc, sessionId, sessionFile } = await this.spawnPi({
      cwd: opts.cwd,
      piProvider: resolved.provider,
      model: resolved.id,
      systemPrompt: opts.systemPrompt,
      mcpServers: opts.mcpServers,
      readOnly,
      effort,
    });
    if (effort) {
      try {
        await proc.call({ type: "set_thinking_level", level: effort }, 30000);
      } catch (e) {
        await proc.kill();
        throw new Error(`couldn't select the pi effort ${JSON.stringify(effort)}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    return this.remember({
      id: sessionId,
      sessionFile,
      cwd: opts.cwd,
      model: resolved.id,
      piProvider: resolved.provider,
      mcpServers: opts.mcpServers,
      readOnly,
      effort,
      cacheKey: sessionId,
      child: proc,
    });
  }

  async fork(session: Session): Promise<Session> {
    const parent = this.live.get(session.id) ?? (await this.loadLive(session.id));
    if (!parent.sessionFile) throw new Error(`pi base session ${session.id} has no session file; cannot fork`);
    // `--fork` copies the base's file (same system prompt and history);
    // UNVIBE_PI_CACHE_KEY keeps the fork on the base's prompt-cache key.
    // --system-prompt is omitted on purpose: the file's prompt rules.
    const { proc, sessionId, sessionFile } = await this.spawnPi({
      cwd: parent.cwd,
      piProvider: parent.piProvider,
      model: parent.model,
      systemPrompt: "",
      mcpServers: parent.mcpServers,
      readOnly: parent.readOnly,
      effort: parent.effort,
      cacheKey: parent.cacheKey,
      forkFrom: parent.sessionFile,
    });
    if (parent.effort) {
      try {
        await proc.call({ type: "set_thinking_level", level: parent.effort }, 30000);
      } catch {
        // inherit is fine
      }
    }
    return this.remember({
      id: sessionId,
      sessionFile,
      cwd: parent.cwd,
      model: parent.model,
      piProvider: parent.piProvider,
      mcpServers: parent.mcpServers,
      readOnly: parent.readOnly,
      effort: parent.effort,
      cacheKey: parent.cacheKey,
      child: proc,
    });
  }

  private async loadLive(sessionId: string): Promise<PiSessionRecord> {
    const existing = this.live.get(sessionId);
    if (existing) return existing;
    const sidecar = this.readSidecar(sessionId);
    const { proc, sessionId: liveId } = await this.spawnPi({
      cwd: sidecar.cwd,
      piProvider: sidecar.piProvider,
      model: sidecar.model,
      systemPrompt: "",
      mcpServers: sidecar.mcpServers,
      readOnly: sidecar.readOnly,
      effort: "",
      cacheKey: sidecar.cacheKey,
      resumeFile: sidecar.sessionFile,
    });
    // `--session <file>` with a missing file starts a different session:
    // refuse it so the manager rebuilds from the base instead.
    if (liveId !== sidecar.id) {
      await proc.kill();
      throw new Error(`pi session ${JSON.stringify(sidecar.id)} is gone (file ${sidecar.sessionFile}); the session rebuilds from the base`);
    }
    if (sidecar.effort) {
      try {
        await proc.call({ type: "set_thinking_level", level: sidecar.effort }, 30000);
      } catch {
        // persisted value stands
      }
    }
    const rec: PiSessionRecord = { ...sidecar, child: proc };
    this.live.set(rec.id, rec);
    return rec;
  }

  async load(sessionId: string): Promise<Session> {
    const rec = await this.loadLive(sessionId);
    return { id: rec.id, provider: PI_PROVIDER, model: rec.model };
  }

  async close(session: Session): Promise<void> {
    const rec = this.live.get(session.id);
    if (!rec) return;
    this.live.delete(session.id);
    this.chains.delete(session.id);
    await rec.child.kill();
  }

  async dispose(): Promise<void> {
    const recs = [...this.live.values()];
    this.chains.clear();
    this.live.clear();
    // Bounded parallel kill (each child ends stdin, then SIGTERM/SIGKILL).
    await Promise.all(recs.map((r) => r.child.kill().catch(() => {})));
  }

  async *prompt(session: Session, text: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const rec = this.requireLive(session);
    // One prompt at a time per pi process (RPC has a single active run):
    // each turn waits for the previous turn's gate before starting.
    const prev = this.chains.get(rec.id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    this.chains.set(
      rec.id,
      prev.then(() => gate),
    );
    await prev;
    try {
      yield* this.promptOnce(rec, text, signal);
    } finally {
      release();
    }
  }

  private async *promptOnce(rec: PiSessionRecord, text: string, signal: AbortSignal | undefined): AsyncIterable<AgentEvent> {
    const child = rec.child;
    if (signal?.aborted) {
      yield { type: "done", stopReason: "cancelled" };
      return;
    }
    const from = child.eventCount;
    let accepted: RpcEvent;
    try {
      accepted = await child.call({ type: "prompt", message: text }, 60000);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      yield { type: "error", message: `pi prompt not accepted: ${message}`, retryable: isRetryablePiError(message) };
      return;
    }
    const disposition = (accepted["data"] as { disposition?: string } | undefined)?.disposition;
    if (disposition === "handled") {
      // An extension consumed the prompt (ours never does): settle quietly.
      yield { type: "done", stopReason: "end_turn" };
      return;
    }

    let settled = false;
    let settledAborted = false;
    const onAbort = (): void => {
      // `abort` waits for the session to go idle; the settled event below
      // still arrives and ends the turn as cancelled.
      void child.call({ type: "abort" }, 30000).catch(() => {});
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    let inputTokens = 0;
    let cachedReadTokens = 0;
    let cachedWriteTokens = 0;
    let outputTokens = 0;
    let usageEvents = 0;
    let failed: { message: string; retryable: boolean } | null = null;
    let cursor = from;
    try {
      for (;;) {
        const batch = child.since(cursor);
        cursor = child.eventCount;
        for (const e of batch) {
          const type = e["type"] as string;
          if (type === "message_update") {
            const update = e["assistantMessageEvent"] as { type?: string; delta?: string } | undefined;
            if (update?.type === "text_delta" && typeof update.delta === "string" && update.delta !== "") {
              yield { type: "text", delta: update.delta };
            }
          } else if (type === "message_end") {
            const message = e["message"] as
              | { role?: string; stopReason?: string; errorMessage?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } }
              | undefined;
            if (message?.role === "assistant") {
              const u = message.usage;
              if (u) {
                inputTokens += u.input ?? 0;
                outputTokens += u.output ?? 0;
                cachedReadTokens += u.cacheRead ?? 0;
                cachedWriteTokens += u.cacheWrite ?? 0;
                usageEvents += 1;
              }
              if (message.stopReason === "error") {
                const msg = message.errorMessage ?? "provider error";
                failed = { message: msg, retryable: isRetryablePiError(msg) };
              }
            }
          } else if (type === "tool_execution_start") {
            yield {
              type: "tool",
              name: String(e["toolName"] ?? "tool"),
              status: "start",
              ...(typeof e["toolCallId"] === "string" ? { id: e["toolCallId"] as string } : {}),
              ...(e["args"] !== undefined ? { detail: truncateDetail(e["args"]) } : {}),
            };
          } else if (type === "tool_execution_end") {
            const result = e["result"] as { content?: { type?: string; text?: string }[] } | undefined;
            const texts = Array.isArray(result?.content)
              ? result.content.filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => (c as { text: string }).text)
              : [];
            yield {
              type: "tool",
              name: String(e["toolName"] ?? "tool"),
              status: "end",
              ...(typeof e["toolCallId"] === "string" ? { id: e["toolCallId"] as string } : {}),
              ...(e["args"] !== undefined ? { detail: truncateDetail(e["args"]) } : {}),
              ...(texts.length > 0 ? { result: texts.join("\n") } : {}),
            };
          } else if (type === "extension_error") {
            // Recorded, not yielded yet: the single error goes out at
            // settle time so a turn yields at most one error, then ends.
            failed = {
              message: `pi extension error (${String(e["event"] ?? "event")}): ${String(e["error"] ?? "unknown")}`.slice(0, 500),
              retryable: false,
            };
          } else if (type === "agent_settled") {
            settled = true;
            settledAborted = e["aborted"] === true;
          }
        }
        if (settled) break;
        try {
          await child.waitForCount(cursor + 1, 600000);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          yield { type: "error", message: `pi turn failed: ${message}`, retryable: isRetryablePiError(message) };
          return;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (!settled) {
      yield { type: "error", message: "pi turn ended without settling", retryable: true };
      return;
    }
    if (failed) {
      yield { type: "error", message: failed.message, retryable: failed.retryable };
      return;
    }
    if (settledAborted || signal?.aborted) {
      yield { type: "done", stopReason: "cancelled" };
      return;
    }
    if (usageEvents > 0) {
      yield {
        type: "usage",
        inputTokens,
        cachedReadTokens,
        cachedWriteTokens,
        outputTokens,
        raw: { provider: rec.piProvider, requests: usageEvents },
      };
    }
    yield { type: "done", stopReason: "end_turn" };
  }

  /** Resolve a bare model id to its pi provider (openai-codex preferred). */
  private async resolveModel(model: string): Promise<{ provider: string; id: string }> {
    if (model.includes("/")) {
      const [provider, ...rest] = model.split("/");
      return { provider, id: rest.join("/") };
    }
    const models = await this.listModels(PI_PROVIDER);
    const ids = new Set(models.map((m) => m.id));
    if (!ids.has(model)) {
      throw new Error(`pi does not offer model ${JSON.stringify(model)} (offers: ${[...ids].join(", ") || "none"})`);
    }
    return { provider: this.modelProviders.get(model) ?? "openai-codex", id: model };
  }

  /** Bare model id → pi provider that offers it (openai-codex wins ties). */
  private readonly modelProviders = new Map<string, string>();

  /** Models pi offers (live, else the static fallback so pickers render
   * offline; [] when pi is absent or older than PI_MIN_VERSION). */
  async listModels(provider: string): Promise<ModelInfo[]> {
    if (provider !== PI_PROVIDER) return [];
    if (!(await this.isSupported())) return [];
    const now = Date.now();
    if (this.modelsCache && now - this.modelsCache.at < this.modelCacheMs) return this.modelsCache.models;
    let models: ModelInfo[] = [...PI_STATIC_MODELS];
    const providers = new Map<string, string>();
    // Static entries are Codex-subscription models; live entries carry
    // their own provider (openai-codex preferred on collisions).
    for (const m of PI_STATIC_MODELS) providers.set(m.id, "openai-codex");
    try {
      const live = await this.ephemeralModels();
      for (const [id, p] of live.providers) {
        if (!providers.has(id) || p === "openai-codex") providers.set(id, p);
      }
      if (live.models.length > 0) models = live.models;
    } catch {
      // live listing failed; keep the static fallback
    }
    this.modelsCache = { at: now, models, providers };
    this.modelProviders.clear();
    for (const [id, p] of providers) this.modelProviders.set(id, p);
    return models;
  }

  async listModelsWithDefault(provider: string): Promise<{ models: ModelInfo[]; defaultId: string | null }> {
    return { models: await this.listModels(provider), defaultId: null };
  }

  /** Thinking levels pi offers (issue #172). Null-able via []: Default only. */
  async listThinking(provider: string): Promise<{ configId: string; current: string; options: { value: string; name?: string; description?: string }[] }[]> {
    if (provider !== PI_PROVIDER || !(await this.isSupported())) return [];
    const now = Date.now();
    if (this.thinkingCache && now - this.thinkingCache.at < this.modelCacheMs) {
      return [{ configId: "thinking", current: "", options: this.thinkingCache.options }];
    }
    try {
      const options = await this.ephemeralThinking();
      if (options.length > 0) {
        this.thinkingCache = { at: now, options };
        return [{ configId: "thinking", current: "", options }];
      }
    } catch {
      // unknown: the picker offers Default only
    }
    return [];
  }

  /** True when this runner owns the session id (live or sidecar on disk). */
  owns(sessionId: string): boolean {
    if (this.live.has(sessionId)) return true;
    try {
      fs.accessSync(this.sidecarPath(sessionId), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** True when the pi binary is present (provider offered in Settings). */
  isAvailable(): boolean {
    if (this.binPath) {
      try {
        fs.accessSync(this.binPath, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }
    return isPiAvailable({ env: this.env });
  }

  /**
   * pi's own version (`pi --version`, cached). Null when the probe fails —
   * callers fail open on null and let the live calls report the breakage.
   */
  async piVersion(): Promise<string | null> {
    const now = Date.now();
    if (this.versionCache && now - this.versionCache.at < this.modelCacheMs) return this.versionCache.version;
    let version: string | null = null;
    try {
      const bin = this.piBin();
      const output = await new Promise<string>((resolve, reject) => {
        // Inherit the runner env (tests point UNVIBE_FAKE_PI_* through it).
        execFile(bin, ["--version"], { timeout: 15000, env: { ...process.env, ...this.env } }, (err, stdout, stderr) => {
          if (err) reject(err);
          else resolve(`${stdout}\n${stderr}`);
        });
      });
      version = parseVersion(output);
    } catch {
      version = null;
    }
    this.versionCache = { at: now, version };
    return version;
  }

  /**
   * True when pi may serve as a provider: binary present and not older
   * than PI_MIN_VERSION (owner decision on #279). Unknown versions fail
   * open (fail loudly later instead).
   */
  async isSupported(): Promise<boolean> {
    if (!this.isAvailable()) return false;
    return piVersionMeetsMin(await this.piVersion());
  }

  /** Clear the model/thinking/version caches (Reload everything). */
  clearModelCache(): void {
    this.modelsCache = null;
    this.thinkingCache = null;
    this.versionCache = null;
  }

  private async ephemeralModels(): Promise<{ models: ModelInfo[]; providers: Map<string, string> }> {
    const proc = await this.spawnEphemeral();
    try {
      const res = await proc.call({ type: "get_available_models" }, 60000);
      const listed = ((res["data"] as { models?: unknown[] } | undefined)?.models ?? []) as {
        provider?: string;
        id?: string;
        name?: string;
      }[];
      const models: ModelInfo[] = [];
      const providers = new Map<string, string>();
      for (const m of listed) {
        if ((m.provider === "openai-codex" || m.provider === "openai") && typeof m.id === "string" && m.id) {
          models.push({ id: m.id, ...(m.name ? { name: m.name } : {}) });
          if (!providers.has(m.id) || m.provider === "openai-codex") providers.set(m.id, m.provider);
        }
      }
      return { models, providers };
    } finally {
      await proc.kill();
    }
  }

  private async ephemeralThinking(): Promise<{ value: string; name?: string; description?: string }[]> {
    const proc = await this.spawnEphemeral();
    try {
      const res = await proc.call({ type: "get_available_models" }, 60000);
      const models = ((res["data"] as { models?: { provider?: string; id?: string }[] } | undefined)?.models ?? []).filter(
        (m) => (m.provider === "openai-codex" || m.provider === "openai") && typeof m.id === "string",
      );
      const first = models[0];
      if (!first?.provider || !first.id) return [];
      await proc.call({ type: "set_model", provider: first.provider, modelId: first.id }, 30000);
      const levels = await proc.call({ type: "get_available_thinking_levels" }, 30000);
      const list = ((levels["data"] as { levels?: unknown } | undefined)?.levels ?? []) as string[];
      return list.filter((l) => typeof l === "string" && l).map((l) => ({ value: l }));
    } finally {
      await proc.kill();
    }
  }

  /** Throwaway probe process: no session, no extension, offline. */
  private async spawnEphemeral(): Promise<RpcProcess> {
    const bin = this.piBin();
    const child = spawn(
      bin,
      ["--mode", "rpc", "--no-session", "--offline", "--no-context-files", "--no-extensions", "--no-mcp", "--no-skills", "--no-prompt-templates", "--no-themes"],
      {
        cwd: os.tmpdir(),
        env: { ...this.env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_OFFLINE: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const proc = new RpcProcess(child);
    try {
      await proc.call({ type: "get_state" }, 60000);
      return proc;
    } catch (e) {
      await proc.kill();
      throw e;
    }
  }
}

function truncateDetail(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const text = typeof input === "string" ? input : safeJson(input);
  if (!text || text.trim() === "" || text.trim() === "{}" || text.trim() === "[]") return undefined;
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

function safeJson(input: unknown): string | undefined {
  try {
    return JSON.stringify(input);
  } catch {
    return undefined;
  }
}

/**
 * Static fallback when pi is installed but its live listing is unreachable
 * (offline, probe hiccup): the Codex-subscription models, so pickers still
 * name models and readiness reports the login plainly. Mirrors the
 * service's STATIC_MODELS fallback for claude/codex.
 */
export const PI_STATIC_MODELS: ModelInfo[] = [
  { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
  { id: "gpt-6-sol", name: "GPT-6 Sol" },
  { id: "gpt-6-luna", name: "GPT-6 Luna" },
  { id: "gpt-6-astra", name: "GPT-6 Astra" },
  { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
];
