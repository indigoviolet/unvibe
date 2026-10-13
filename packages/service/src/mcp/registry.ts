/**
 * MCP registry: one shared HTTP mount, per-session secrets, fixed tool set.
 *
 * Design (PRD §10, §11.2):
 * - The service mounts a single streamable-HTTP endpoint
 *   `POST|GET|DELETE /api/mcp/:secret`. Each agent session is issued its
 *   own unguessable secret (`issueSession`); the secret identifies the
 *   (review, session, role) for attribution.
 * - One SDK `Server` per issued session, all built from the same frozen
 *   tool definitions. `ListTools` omits `pin_context` for non-readers,
 *   and a direct `pin_context` call from a non-reader is refused — so one
 *   server gives the reader session an extra tool while everyone else
 *   sees an identical surface.
 * - Protection: 127.0.0.1-only binding plus the per-session secret in
 *   the URL (256-bit, revocable). The `/api/mcp/*` path is exempt from
 *   the install-token gate for exactly this reason: agent subprocesses
 *   present the secret, not the token. Documented in `routes.ts`.
 */
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { parseId } from "@unvibe/shared";
import type { CommandRunner } from "../exec/runner.js";
import type { McpReviewData, PinRecord, ReviewReader } from "./read.js";
import { readCodeSlice } from "./read.js";
import { READER_TOOL, toolsForRole } from "./tools.js";

export const MCP_SERVICE_NAME = "unvibe";
export const MCP_SERVICE_VERSION = "0.0.4";

/**
 * MCP session roles (PRD §10, §12).
 *
 * - `reader`: the main reader session (extra `pin_context` tool).
 * - `session`: every other main-model conversation.
 * - `second-opinion`: the isolated second-opinion role (PRD §12). Same
 *   read-only tool surface as `session`, but `search_review` never returns
 *   cards, annotations or contributions — only the description (which is
 *   already in L1). This keeps guide text, other findings, contributions
 *   and discussion out of the second-opinion session even via tools.
 */
export type McpRole = "reader" | "session" | "second-opinion";

export interface IssuedSession {
  secret: string;
  /** Path the agent calls, e.g. `/api/mcp/<secret>`. */
  path: string;
  reviewId: string;
  sessionId: string;
  role: McpRole;
}

export interface McpRegistryOptions {
  reader: ReviewReader;
  commands: CommandRunner;
  now?: () => number;
  onPin?: (pin: PinRecord) => void;
}

interface SessionState extends IssuedSession {
  server: Server;
  transport: StreamableHTTPServerTransport;
  connected: boolean;
  /** Tool calls served on this secret (degraded-turn detection, #51). */
  calls: number;
}

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text: `error: ${text}` }], isError: true };
}

export class McpRegistry {
  private readonly sessions = new Map<string, SessionState>();
  /** Live secrets per review, so a review's secrets die with it. */
  private readonly byReview = new Map<string, Set<string>>();
  private readonly pins: PinRecord[] = [];
  /**
   * Calls against unknown/revoked secrets (degraded-turn detection,
   * #51): a turn whose agent hits a dead URL never connects, and the
   * model usually reports it in the reply.
   */
  private unknownHits = 0;

  constructor(private readonly opts: McpRegistryOptions) {}

  /** Issue a per-session secret + dedicated tool surface. */
  issueSession(reviewId: string, sessionId: string, role: McpRole): IssuedSession {
    const secret = randomBytes(32).toString("hex");
    const server = new Server(
      { name: MCP_SERVICE_NAME, version: MCP_SERVICE_VERSION },
      { capabilities: { tools: {} } },
    );
    const state: SessionState = {
      secret,
      path: `/api/mcp/${secret}`,
      reviewId,
      sessionId,
      role,
      server,
      // Stateful (SDK-session) transport, one per issued MCP session: the
      // SDK forbids reusing a *stateless* transport across HTTP requests,
      // while a stateful one is built for exactly this. The MCP session id
      // is an SDK concern; attribution still comes from our URL secret.
      transport: new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() }),
      connected: false,
      calls: 0,
    };
    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: toolsForRole(role),
    }));
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      state.calls += 1;
      try {
        return await this.dispatch(state, req.params.name, args);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    });
    this.sessions.set(secret, state);
    let set = this.byReview.get(reviewId);
    if (!set) {
      set = new Set();
      this.byReview.set(reviewId, set);
    }
    set.add(secret);
    const issued: IssuedSession = {
      secret: state.secret,
      path: state.path,
      reviewId: state.reviewId,
      sessionId: state.sessionId,
      role: state.role,
    };
    return issued;
  }

  revokeSession(secret: string): void {
    const state = this.sessions.get(secret);
    if (!state) return;
    this.sessions.delete(secret);
    const set = this.byReview.get(state.reviewId);
    if (set) {
      set.delete(secret);
      if (set.size === 0) this.byReview.delete(state.reviewId);
    }
    void state.transport.close().catch(() => {});
  }

  /**
   * Revoke every live secret for a review (review delete, base rebuild of
   * that review). Secrets are also process-local, so a restart expires all
   * of them implicitly. Returns the number revoked.
   */
  revokeForReview(reviewId: string): number {
    const set = this.byReview.get(reviewId);
    if (!set) return 0;
    const secrets = [...set];
    for (const secret of secrets) this.revokeSession(secret);
    return secrets.length;
  }

  /**
   * Revoke live secrets issued under one agent-session label
   * (`base-<reviewId>`, `reader-<reviewId>`, …). Used when the owning
   * session closes or is rebuilt while the review lives on. Returns the
   * number revoked.
   */
  revokeBySessionId(sessionId: string): number {
    let n = 0;
    for (const [secret, state] of [...this.sessions]) {
      if (state.sessionId === sessionId) {
        this.revokeSession(secret);
        n += 1;
      }
    }
    return n;
  }

  /**
   * Close every live transport (service shutdown, issue #30): agent
   * subprocesses are already dead by then, so their SSE streams would
   * otherwise hold hijacked responses open and block `app.close()`
   * forever. Best-effort, never throws. Returns the number closed.
   */
  async closeAll(): Promise<number> {
    const states = [...this.sessions.values()];
    this.sessions.clear();
    this.byReview.clear();
    let n = 0;
    await Promise.all(
      states.map(async (state) => {
        try {
          await state.transport.close();
        } catch {
          // Already gone: fine.
        }
        n += 1;
      }),
    );
    return n;
  }

  /** Live (unrevoked) secret count — observability for tests. */
  liveSecretCount(reviewId?: string): number {
    if (reviewId) return this.byReview.get(reviewId)?.size ?? 0;
    return this.sessions.size;
  }

  /** A call hit an unknown/revoked secret (the route counts it, #51). */
  noteUnknownHit(): void {
    this.unknownHits += 1;
  }

  /**
   * Review-scoped MCP activity for degraded-turn detection (#51): how
   * many of the review's live secrets ever connected, how many tool
   * calls they served, and how many calls hit unknown secrets
   * service-wide. Snapshot before a turn and diff after: no new
   * connections or calls means the turn ran without its tools.
   */
  activitySnapshot(reviewId: string): { connected: number; toolCalls: number; unknownHits: number } {
    let connected = 0;
    let toolCalls = 0;
    for (const secret of this.byReview.get(reviewId) ?? []) {
      const state = this.sessions.get(secret);
      if (!state) continue;
      if (state.connected) connected += 1;
      toolCalls += state.calls;
    }
    return { connected, toolCalls, unknownHits: this.unknownHits };
  }

  hasSession(secret: string): boolean {
    return this.sessions.has(secret);
  }

  /** Pins recorded via `pin_context` (supervisor persists via `onPin`). */
  listPins(reviewId?: string): PinRecord[] {
    return reviewId ? this.pins.filter((p) => p.reviewId === reviewId) : [...this.pins];
  }

  /**
   * Handle one HTTP call for a secret. `req`/`res` are the raw Node
   * objects; `body` is the already-parsed JSON body (if any).
   */
  async handleRequest(
    secret: string,
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    body: unknown,
  ): Promise<void> {
    const state = this.sessions.get(secret);
    if (!state) {
      this.unknownHits += 1;
      res.statusCode = 404;
      res.end("unknown mcp session");
      return;
    }
    if (!state.connected) {
      await state.server.connect(state.transport);
      state.connected = true;
    }
    // Newer claude CLIs (≥2.1.296, MCP protocol 2026-07-28) probe
    // `server/discover` before `initialize`; our SDK (1.32.1) predates it and
    // would answer HTTP 500 (fatal, tools unavailable). Answer JSON-RPC
    // Method Not Found (HTTP 200) so the CLI falls back to `initialize`.
    // (Live-test stub mirrors this in `test/acp-live.test.ts`.)
    const method = (body as { method?: unknown } | null)?.method;
    if (method === "server/discover") {
      const rpcId = (body as { id?: unknown } | null)?.id ?? null;
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: rpcId, error: { code: -32601, message: "Method not found: server/discover" } }));
      return;
    }
    await state.transport.handleRequest(req, res, body);
  }

  // -- dispatch ---------------------------------------------------------

  private async dispatch(
    state: SessionState,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    switch (name) {
      case "get_hunk":
        return textResult(await this.getHunk(state, String(args["id"] ?? "")));
      case "get_code":
        return textResult(
          await this.getCode(
            state,
            String(args["path"] ?? ""),
            String(args["lines"] ?? ""),
            args["sha"] === undefined ? undefined : String(args["sha"]),
          ),
        );
      case "search_review":
        return textResult(await this.searchReview(state, String(args["query"] ?? "")));
      case "resolve":
        return textResult(await this.resolve(state, String(args["description"] ?? "")));
      case READER_TOOL.name:
        if (state.role !== "reader") {
          return errorResult("pin_context is only available to the reader session");
        }
        return textResult(
          this.pinContext(
            state,
            String(args["path"] ?? ""),
            String(args["lines"] ?? ""),
            String(args["why"] ?? ""),
          ),
        );
      default:
        return errorResult(`unknown tool: ${name}`);
    }
  }

  private async loadReview(state: SessionState): Promise<McpReviewData> {
    const review = await this.opts.reader.getReview(state.reviewId);
    if (!review) throw new Error(`unknown review: ${state.reviewId}`);
    return review;
  }

  // -- tools --------------------------------------------------------------

  private async getHunk(state: SessionState, id: string): Promise<string> {
    const parsed = parseId(id);
    if (parsed?.kind !== "h") throw new Error(`invalid hunk id: ${id}`);
    const review = await this.loadReview(state);
    const hunk = review.hunks.find(
      (h) => h.fileKey === parsed.fileKey && h.contentHash === parsed.contentHash,
    );
    if (!hunk) throw new Error(`unknown hunk: ${id}`);
    const lines = hunk.text.split("\n");
    const numbered = lines.map((line, i) => `${hunk.newStart + i}: ${line}`);
    return [`h:${hunk.fileKey}:${hunk.contentHash}`, `file: ${hunk.path}`, hunk.header, ...numbered].join(
      "\n",
    );
  }

  /**
   * Refuse anything that isn't a repo-relative path inside the worktree:
   * absolute paths, `..` escapes (including encoded ones, which never
   * reach us decoded — we check the literal text too), and empty paths.
   */
  static checkPathInRepo(worktree: string, relPath: string): string {
    if (!relPath || path.isAbsolute(relPath)) throw new Error(`path escapes repository: ${relPath}`);
    if (relPath.split(/[\\/]/).includes("..")) throw new Error(`path escapes repository: ${relPath}`);
    const abs = path.resolve(worktree, relPath);
    const rel = path.relative(worktree, abs);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`path escapes repository: ${relPath}`);
    }
    return abs;
  }

  private parseLines(lines: string): { start: number; end: number } {
    const m = lines.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`invalid lines range: ${lines}`);
    const start = Number(m[1]);
    const end = m[2] === undefined ? start : Number(m[2]);
    if (end < start) throw new Error(`invalid lines range: ${lines}`);
    return { start, end };
  }

  private async getCode(state: SessionState, relPath: string, lines: string, sha?: string): Promise<string> {
    const review = await this.loadReview(state);
    const worktree = await this.opts.reader.getWorktreePath(state.reviewId);
    if (!worktree) throw new Error(`no worktree for review: ${state.reviewId}`);
    McpRegistry.checkPathInRepo(worktree, relPath);
    const { start, end } = this.parseLines(lines);
    const rev = sha ?? review.headSha;
    const slice = await readCodeSlice(this.opts.commands, worktree, rev, relPath, start, end);
    if ("error" in slice) {
      if (slice.error === "out-of-range") throw new Error(`lines ${lines} outside file ${relPath}@${rev}`);
      if (slice.error === "binary") throw new Error(`binary file ${relPath}@${rev} is not shown`);
      throw new Error(`git show failed for ${rev}:${relPath}`);
    }
    const id = `code:${relPath}:${start === end ? `${start}` : `${start}-${end}`}@${rev}`;
    return [id, ...slice.text.split("\n").map((line, i) => `${start + i}: ${line}`)].join("\n");
  }

  private async searchReview(state: SessionState, query: string): Promise<string> {
    const review = await this.loadReview(state);
    const q = query.toLowerCase();
    if (!q) return "no matches";
    const hits: string[] = [];
    const push = (id: string, kind: string, text: string): void => {
      if (hits.length >= 10) return;
      const i = text.toLowerCase().indexOf(q);
      const snippet =
        i < 0 ? text.slice(0, 120) : text.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ");
      hits.push(`${kind} ${id}: ${snippet}`);
    };
    if (!this.isRestrictedRole(state)) {
      for (const c of review.cards) {
        if ((c.title ?? "").toLowerCase().includes(q) || c.text.toLowerCase().includes(q)) {
          push(`card:${c.id}`, "card", `${c.title ?? ""} ${c.text}`);
        }
      }
      for (const a of review.annotations) {
        if (a.anchorSummary.toLowerCase().includes(q) || a.text.toLowerCase().includes(q)) {
          push(`ann:${a.id}`, "annotation", `${a.anchorSummary} ${a.text}`);
        }
      }
      for (const c of review.contributions) {
        if (c.text.toLowerCase().includes(q)) push(c.id, "contribution", c.text);
      }
    }
    for (const d of this.matchDescription(review, query)) {
      push(`desc:${d.id}`, "description", d.text);
    }
    return hits.length > 0 ? hits.join("\n") : "no matches";
  }

  /**
   * Second-opinion isolation (PRD §12): this role must not see guide
   * text, other findings, contributions, or discussion — even via tools.
   * Only the description is available (it is already in L1). Shared by
   * `search_review` and `resolve` (issue #96).
   */
  private isRestrictedRole(state: SessionState): boolean {
    return state.role === "second-opinion";
  }

  /**
   * Description paragraphs matching a query (case-insensitive substring),
   * shared by `search_review` and `resolve` (issue #96). The description
   * is allowed for every role, including second-opinion.
   */
  private matchDescription(
    review: McpReviewData,
    query: string,
  ): { id: string; text: string }[] {
    const q = query.toLowerCase();
    if (!q) return [];
    return review.description.filter((d) => d.text.toLowerCase().includes(q));
  }

  private async resolve(state: SessionState, description: string): Promise<string> {
    const review = await this.loadReview(state);
    const out: string[] = [];
    const restricted = this.isRestrictedRole(state);
    // file paths with optional :line[-line]
    for (const m of description.matchAll(/([\w./-]+\.\w+)(?::(\d+)(?:-(\d+))?)?/g)) {
      const file = m[1];
      const hunks = review.hunks.filter((h) => h.path.endsWith(file) || h.path === file);
      for (const h of hunks.slice(0, 3)) {
        out.push(`h:${h.fileKey}:${h.contentHash} (hunk in ${h.path}${m[2] ? ` near line ${m[2]}` : ""})`);
      }
      // Second-opinion isolation: never return card candidates.
      if (hunks.length === 0 && !restricted) {
        const cards = review.cards.filter((c) => c.text.includes(file)).slice(0, 2);
        for (const c of cards) out.push(`card:${c.id} (mentions ${file})`);
      }
    }
    // description text (allowed for every role, including second-opinion:
    // same restriction rule as search_review, issue #96).
    for (const d of this.matchDescription(review, description)) {
      out.push(`desc:${d.id} (description match)`);
      if (out.length >= 10) break;
    }
    if (!restricted) {
      // quoted code → cards/annotations containing it
      for (const m of description.matchAll(/"([^"]{4,})"|`([^`]{4,})`/g)) {
        const quote = (m[1] ?? m[2] ?? "").trim();
        if (!quote) continue;
        for (const c of review.cards) {
          if (c.text.includes(quote)) out.push(`card:${c.id} (quotes matched text)`);
          if (out.length >= 10) break;
        }
      }
      // bare card titles / slugs
      const lower = description.toLowerCase();
      for (const c of review.cards) {
        if (c.title && lower.includes(c.title.toLowerCase())) out.push(`card:${c.id} (title match)`);
        if (out.length >= 10) break;
      }
    }
    return out.length > 0 ? [...new Set(out)].slice(0, 10).join("\n") : "no candidates";
  }

  private pinContext(state: SessionState, relPath: string, lines: string, why: string): string {
    if (!relPath) throw new Error("path is required");
    if (!why) throw new Error("why is required");
    this.parseLines(lines);
    const pin: PinRecord = {
      reviewId: state.reviewId,
      sessionId: state.sessionId,
      path: relPath,
      lines,
      why,
      pinnedAt: (this.opts.now ?? Date.now)(),
    };
    this.pins.push(pin);
    this.opts.onPin?.(pin);
    return `pinned code:${relPath}:${lines} (${why})`;
  }
}
