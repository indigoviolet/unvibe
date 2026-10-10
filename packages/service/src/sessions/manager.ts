/**
 * Session manager (PRD §9.2, §12) on top of the `AgentRunner` interface.
 *
 * - `getBase(key, build)`: builds the base session once per
 *   (review version, guide revision, model) by starting a session and
 *   sending the base pack, waiting for "ready". Concurrent callers share
 *   the same in-flight build. One base per model (caches are per model).
 * - `forkConversation(base, message)`: `runner.fork` when available,
 *   otherwise a fresh session whose first message is byte-identical to
 *   the base pack (PRD §6). Callers get the same shape either way.
 * - `fanOut`: warm the base first, then fork in parallel.
 * - `appendLogBatch`: grow the base with new turns; per-session
 *   "last log entry seen" tracked via `markSeen` / `lastSeen`.
 * - Idle sessions close after the provider cache lifetime and reopen
 *   with `load`; a failed `load` rebuilds from the base. Restarts reopen
 *   lazily through the same path.
 * - `invalidateBase` (+ `pruneBases`) drops superseded bases; the
 *   rebuild *decision* belongs to the caller (context agent).
 */
import type {
  AgentEvent,
  AgentRunner,
  McpServerConfig,
  Session,
  TokenUsage,
} from "@unvibe/shared";
import { RetryableError } from "../jobs/errors.js";
import type { Clock } from "../jobs/clock.js";
import { RealClock } from "../jobs/clock.js";
import type { SessionStore } from "./store.js";

/** Base identity: (review version, guide revision, model). Per-model caches. */
export interface BaseKey {
  reviewVersion: string;
  guideRevision: string;
  provider: string;
  model: string;
}

export function baseKeyString(key: BaseKey): string {
  return [key.reviewVersion, key.guideRevision, key.provider, key.model].join("|");
}

export interface BaseBuild {
  key: BaseKey;
  cwd: string;
  systemPrompt: string;
  mcpServers: McpServerConfig[];
  /** Base pack text (L1 + L1b + L2); the agent answers "ready". */
  pack: string;
  signal?: AbortSignal;
}

export interface BaseHandle {
  key: string;
  session: Session;
  /** True when this call created the base (vs reusing a live one). */
  fresh: boolean;
}

export interface ForkResult {
  session: Session;
  /** True when `runner.fork` was used (false = fresh session + base pack). */
  viaFork: boolean;
  /** The agent's reply to `firstMessage`. */
  text: string;
  usage: TokenUsage;
}

interface BaseRecord {
  key: BaseKey;
  keyString: string;
  session: Session;
  build: { cwd: string; systemPrompt: string; mcpServers: McpServerConfig[] };
  pack: string;
  logSeq: number;
  live: boolean;
  lastUsedAt: number;
}

interface ConversationRecord {
  session: Session;
  baseKey: string;
  viaFork: boolean;
  lastSeenSeq: number;
  live: boolean;
  lastUsedAt: number;
}

export interface SessionManagerOptions {
  runner: AgentRunner;
  clock?: Clock;
  store?: SessionStore | null;
}

export class SessionManager {
  private readonly runner: AgentRunner;
  private readonly clock: Clock;
  private readonly store: SessionStore | null;
  private readonly bases = new Map<string, BaseRecord>();
  private readonly building = new Map<string, Promise<{ record: BaseRecord; fresh: boolean }>>();
  private readonly conversations = new Map<string, ConversationRecord>();
  private restored = false;

  constructor(opts: SessionManagerOptions) {
    this.runner = opts.runner;
    this.clock = opts.clock ?? new RealClock();
    this.store = opts.store ?? null;
  }

  /** Load persisted records (all closed); sessions reopen lazily. */
  restore(): void {
    if (this.restored || !this.store) return;
    this.restored = true;
    const { bases, conversations } = this.store.loadAll();
    for (const b of bases) {
      this.bases.set(baseKeyString(b.key), {
        key: b.key,
        keyString: baseKeyString(b.key),
        session: b.session,
        build: { ...b.build, mcpServers: b.build.mcpServers as McpServerConfig[] },
        pack: b.pack,
        logSeq: b.logSeq,
        live: false,
        lastUsedAt: b.updatedAt,
      });
    }
    for (const c of conversations) {
      this.conversations.set(c.session.id, {
        session: c.session,
        baseKey: c.baseKey,
        viaFork: c.viaFork,
        lastSeenSeq: c.lastSeenSeq,
        live: false,
        lastUsedAt: c.updatedAt,
      });
    }
  }

  // -- base -----------------------------------------------------------

  /**
   * Return the live base for `key`, building it once. Concurrent callers
   * share the in-flight build. A closed base (idle close or restart)
   * reopens with `load`, falling back to a rebuild from the pack.
   */
  async getBase(build: BaseBuild): Promise<BaseHandle> {
    const key = baseKeyString(build.key);
    const existing = this.bases.get(key);
    if (existing?.live) {
      existing.lastUsedAt = this.clock.now();
      return { key, session: existing.session, fresh: false };
    }
    let inflight = this.building.get(key);
    if (!inflight) {
      inflight = this.ensureBase(build, existing).then((record) => ({ record, fresh: !existing }));
      this.building.set(key, inflight);
      try {
        const done = await inflight;
        return { key, session: done.record.session, fresh: done.fresh };
      } finally {
        this.building.delete(key);
      }
    }
    const done = await inflight;
    return { key, session: done.record.session, fresh: false };
  }

  private async ensureBase(build: BaseBuild, closed?: BaseRecord): Promise<BaseRecord> {
    if (closed) {
      try {
        const session = await this.runner.load(closed.session.id);
        closed.session = session;
        closed.live = true;
        closed.lastUsedAt = this.clock.now();
        this.persistBase(closed);
        return closed;
      } catch {
        await this.closeQuietly(closed.session);
      }
    }
    const session = await this.runner.start({
      provider: build.key.provider,
      model: build.key.model,
      cwd: build.cwd,
      systemPrompt: build.systemPrompt,
      mcpServers: build.mcpServers,
    });
    const { text } = await this.sendText(session, build.pack, build.signal);
    if (!/ready/i.test(text)) {
      await this.closeQuietly(session);
      throw new Error("SessionManager: base session did not acknowledge ready");
    }
    const record: BaseRecord = {
      key: build.key,
      keyString: baseKeyString(build.key),
      session,
      build: { cwd: build.cwd, systemPrompt: build.systemPrompt, mcpServers: build.mcpServers },
      pack: build.pack,
      logSeq: closed?.logSeq ?? 0,
      live: true,
      lastUsedAt: this.clock.now(),
    };
    this.bases.set(record.keyString, record);
    this.persistBase(record);
    return record;
  }

  /**
   * Drop a base (caller-triggered rebuild decision, PRD §9.4). Forked
   * conversations survive; the base session is closed.
   */
  async invalidateBase(key: BaseKey | string): Promise<void> {
    const keyString = typeof key === "string" ? key : baseKeyString(key);
    const record = this.bases.get(keyString);
    if (record) {
      await this.closeQuietly(record.session);
      this.bases.delete(keyString);
      this.store?.remove(record.session.id);
      this.store?.removeBase(keyString);
    }
  }

  /** Drop every base not in `keep` (cleanup of superseded bases). */
  async pruneBases(keep: Set<string>): Promise<void> {
    for (const key of [...this.bases.keys()]) {
      if (!keep.has(key)) await this.invalidateBase(key);
    }
  }

  // -- conversations ----------------------------------------------------

  /**
   * Fork the base and send `firstMessage` (L4). Uses `runner.fork` when
   * the runner has it, else a fresh session whose first message is
   * byte-identical to the base pack. Same result shape either way.
   */
  async forkConversation(
    baseKey: BaseKey | string,
    firstMessage: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<ForkResult> {
    const keyString = typeof baseKey === "string" ? baseKey : baseKeyString(baseKey);
    const base = this.bases.get(keyString);
    if (!base) throw new Error(`SessionManager: unknown base ${keyString}`);
    if (!base.live) {
      throw new Error(`SessionManager: base ${keyString} is closed; getBase() first`);
    }
    base.lastUsedAt = this.clock.now();

    let session: Session;
    let viaFork = false;
    if (typeof this.runner.fork === "function") {
      session = await this.runner.fork(base.session);
      viaFork = true;
    } else {
      session = await this.runner.start({
        provider: base.key.provider,
        model: base.key.model,
        cwd: base.build.cwd,
        systemPrompt: base.build.systemPrompt,
        mcpServers: base.build.mcpServers,
      });
      await this.sendText(session, base.pack, opts.signal);
    }
    const { text, usage } = await this.sendText(session, firstMessage, opts.signal);
    const record: ConversationRecord = {
      session,
      baseKey: keyString,
      viaFork,
      lastSeenSeq: base.logSeq,
      live: true,
      lastUsedAt: this.clock.now(),
    };
    this.conversations.set(session.id, record);
    this.persistConversation(record);
    return { session, viaFork, text, usage };
  }

  /**
   * Warm the base first, then fork every conversation in parallel
   * (PRD §9.2 fan-out).
   */
  async fanOut(build: BaseBuild, firstMessages: string[]): Promise<ForkResult[]> {
    const base = await this.getBase(build);
    return Promise.all(firstMessages.map((m) => this.forkConversation(base.key, m)));
  }

  /** Send one text turn on a conversation session; returns the reply. */
  async sendOnConversation(
    sessionId: string,
    text: string,
    opts: { signal?: AbortSignal } = {},
  ): Promise<{ text: string; usage: TokenUsage }> {
    const ensured = await this.ensureConversation(sessionId);
    const out = await this.sendText(ensured, text, opts.signal);
    const record = this.conversations.get(sessionId);
    if (record) {
      record.lastUsedAt = this.clock.now();
      this.persistConversation(record);
    }
    return out;
  }

  /**
   * Reopen a conversation after an idle close or restart (`load`), or
   * rebuild it as a fresh fork of the current base when `load` fails.
   * A rebuild loses conversation history past the base; the caller
   * re-sends what it needs (it owns L4).
   */
  async ensureConversation(sessionId: string): Promise<Session> {
    const record = this.conversations.get(sessionId);
    if (record?.live) {
      record.lastUsedAt = this.clock.now();
      return record.session;
    }
    if (record) {
      try {
        record.session = await this.runner.load(sessionId);
        record.live = true;
        record.lastUsedAt = this.clock.now();
        this.persistConversation(record);
        return record.session;
      } catch {
        await this.closeQuietly(record.session);
      }
      const base = this.bases.get(record.baseKey);
      if (base?.live) {
        const rebuilt = record.viaFork && typeof this.runner.fork === "function"
          ? await this.runner.fork(base.session)
          : await this.fallbackSession(base);
        if (!record.viaFork || typeof this.runner.fork !== "function") {
          await this.drainEvents(rebuilt, base.pack);
        }
        record.session = rebuilt;
        record.live = true;
        record.lastUsedAt = this.clock.now();
        this.conversations.delete(sessionId);
        this.conversations.set(rebuilt.id, record);
        this.persistConversation(record);
        return rebuilt;
      }
      record.live = false;
      throw new Error(`SessionManager: cannot reopen ${sessionId}: base ${record.baseKey} is gone`);
    }
    return this.runner.load(sessionId);
  }

  async closeConversation(sessionId: string): Promise<void> {
    const record = this.conversations.get(sessionId);
    if (!record) return;
    await this.closeQuietly(record.session);
    record.live = false;
    this.persistConversation(record);
  }

  // -- log --------------------------------------------------------------

  /**
   * Append a log batch to the base as a new turn (keeps the cached
   * prefix valid, PRD §9.3). `seq` is the log's sequence number; the
   * base remembers the highest seen.
   */
  async appendLogBatch(
    baseKey: BaseKey | string,
    batch: { seq: number; text: string },
    opts: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const keyString = typeof baseKey === "string" ? baseKey : baseKeyString(baseKey);
    const base = this.bases.get(keyString);
    if (!base?.live) throw new Error(`SessionManager: base ${keyString} is not live`);
    await this.sendText(base.session, batch.text, opts.signal);
    base.logSeq = Math.max(base.logSeq, batch.seq);
    base.lastUsedAt = this.clock.now();
    this.persistBase(base);
  }

  /** Record that a session has seen log entries up to `seq`. */
  markSeen(sessionId: string, seq: number): void {
    const record = this.conversations.get(sessionId);
    if (!record) return;
    record.lastSeenSeq = Math.max(record.lastSeenSeq, seq);
    this.persistConversation(record);
  }

  /** Last log entry a session has seen (for filtered change lists). */
  lastSeen(sessionId: string): number {
    return (
      this.conversations.get(sessionId)?.lastSeenSeq ??
      0
    );
  }

  // -- idle ---------------------------------------------------------------

  /**
   * Close sessions idle longer than `idleAfterMs` (provider cache
   * lifetime setting). They reopen lazily via `load`/rebuild.
   */
  async sweepIdle(now: number, idleAfterMs: number): Promise<{ closed: string[] }> {
    const closed: string[] = [];
    for (const record of this.bases.values()) {
      if (record.live && now - record.lastUsedAt >= idleAfterMs) {
        await this.closeQuietly(record.session);
        record.live = false;
        this.persistBase(record);
        closed.push(record.session.id);
      }
    }
    for (const record of this.conversations.values()) {
      if (record.live && now - record.lastUsedAt >= idleAfterMs) {
        await this.closeQuietly(record.session);
        record.live = false;
        this.persistConversation(record);
        closed.push(record.session.id);
      }
    }
    return { closed };
  }

  /** Live session counts per provider (for the concurrency cap). */
  countsByProvider(): Record<string, number> {
    const out: Record<string, number> = {};
    const count = (s: Session): void => {
      out[s.provider] = (out[s.provider] ?? 0) + 1;
    };
    for (const b of this.bases.values()) if (b.live) count(b.session);
    for (const c of this.conversations.values()) if (c.live) count(c.session);
    return out;
  }

  // -- internals ----------------------------------------------------------

  private async fallbackSession(base: BaseRecord): Promise<Session> {
    const session = await this.runner.start({
      provider: base.key.provider,
      model: base.key.model,
      cwd: base.build.cwd,
      systemPrompt: base.build.systemPrompt,
      mcpServers: base.build.mcpServers,
    });
    await this.drainEvents(session, base.pack);
    return session;
  }

  private async drainEvents(session: Session, text: string, signal?: AbortSignal): Promise<void> {
    await this.sendText(session, text, signal);
  }

  /** One prompt turn: collect text + usage; map error events to throws. */
  private async sendText(
    session: Session,
    text: string,
    signal?: AbortSignal,
  ): Promise<{ text: string; usage: TokenUsage }> {
    let out = "";
    const usage: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
    for await (const event of this.runner.prompt(session, text, signal)) {
      const e: AgentEvent = event;
      if (e.type === "text") out += e.delta;
      else if (e.type === "usage") {
        usage.inputTokens += e.inputTokens;
        usage.cachedTokens += e.cachedTokens;
        usage.outputTokens += e.outputTokens;
      } else if (e.type === "error") {
        if (e.retryable) throw new RetryableError(e.message);
        throw new Error(e.message);
      }
    }
    return { text: out, usage };
  }

  private async closeQuietly(session: Session): Promise<void> {
    try {
      await this.runner.close(session);
    } catch {
      // closing is best-effort
    }
  }

  private persistBase(record: BaseRecord): void {
    this.store?.saveBase({
      key: record.key,
      session: record.session,
      build: record.build,
      pack: record.pack,
      logSeq: record.logSeq,
      live: record.live,
      updatedAt: record.lastUsedAt,
    });
  }

  private persistConversation(record: ConversationRecord): void {
    this.store?.saveConversation({
      session: record.session,
      baseKey: record.baseKey,
      viaFork: record.viaFork,
      lastSeenSeq: record.lastSeenSeq,
      live: record.live,
      updatedAt: record.lastUsedAt,
    });
  }
}
