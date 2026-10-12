/**
 * Priority job queue (PRD §12).
 *
 * - Per-provider concurrency cap (default 4, injectable so it can follow
 *   the `sessionsPerProvider` setting).
 * - Priority order: user-requested > visible > background
 *   (`JOB_PRIORITY` in `@unvibe/shared`); raisable while queued.
 * - Rate-limit back-off: a job's `run` throws {@link RetryableError} for
 *   exponential back-off with injected jitter (deterministic in tests);
 *   the job visibly sits in `backing-off`.
 * - Cancellation through `AbortSignal`, while queued, backing off, or
 *   running. An abort always wins over a late success.
 * - Dedupe: identical requests (anchor, kind, depth, base version) share
 *   one job/result while the first is still active.
 * - Every state change, usage report and streamed-text delta is emitted
 *   as a shared `ReviewEvent` via `onEvent`, for the review's event bus.
 * - Jobs persist through `JobPersistence` so the Jobs view survives a
 *   restart; `recover()` marks every open job interrupted (terminal).
 */
import { randomUUID } from "node:crypto";
import {
  jobDedupeKeyString,
  type Job,
  type JobDedupeKey,
  type JobKind,
  type ReviewEvent,
  type TokenUsage,
} from "@unvibe/shared";
import { computeBackoffDelay } from "./backoff.js";
import { MathRandom, RealClock, type Clock, type RandomSource } from "./clock.js";
import { isAbortError, RetryableError } from "./errors.js";
import type { JobPersistence } from "./store.js";
import { reportError } from "../telemetry/sentry.js";

export const DEFAULT_CONCURRENCY_CAP = 4;
export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 60_000;
export const INTERRUPTED_MESSAGE = "interrupted: service restarted";

/** Context handed to a job's `run` function. */
export interface JobContext {
  /** Aborts when the job is cancelled (e.g. its card closed). */
  signal: AbortSignal;
  /** Accumulate token usage; republishes the job event. */
  reportUsage(usage: Partial<TokenUsage>): void;
  /** Stream a text delta; published as a `text` ReviewEvent. */
  reportText(delta: string): void;
  /** Record the exact prompt sent (Settings links to it). */
  setPromptSnapshot(text: string): void;
  /** Record the agent session backing this job. */
  setSessionId(id: string): void;
}

export type JobFn = (ctx: JobContext) => Promise<void>;

export interface EnqueueOptions {
  reviewId: string;
  kind: JobKind;
  provider: string;
  model: string;
  priority: number;
  dedupe?: JobDedupeKey;
  promptSnapshot?: string;
  sessionId?: string;
  /**
   * Card the job works on, when card-scoped (depth/examples/diagram/
   * generate/concept/second-opinion). Carried on the job itself (so
   * snapshots, WS events and the debug views can match it) as well as on
   * the entry (for `text` events).
   */
  cardId?: string;
  /** M4: annotation the streamed text belongs to (ask replies, expansions). */
  threadId?: string;
  run: JobFn;
}

export interface QueueOptions {
  maxAttempts?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  clock?: Clock;
  random?: RandomSource;
  /** Per-provider running-job cap. Defaults to a constant 4. */
  getConcurrencyCap?: (provider: string) => number;
  /** Sink for ReviewEvents (wired to the review's EventBus by the service). */
  onEvent?: (reviewId: string, event: ReviewEvent) => void;
  persist?: JobPersistence | null;
}

interface Entry {
  job: Job;
  run?: JobFn;
  reviewId: string;
  cardId?: string;
  threadId?: string;
  seq: number;
  abort?: AbortController;
}

function copy(job: Job): Job {
  return { ...job, usage: job.usage ? { ...job.usage } : undefined };
}

export class JobQueue {
  private readonly entries = new Map<string, Entry>();
  private readonly dedupe = new Map<string, string>();
  private seq = 0;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly getConcurrencyCap: (provider: string) => number;
  private readonly onEvent: (reviewId: string, event: ReviewEvent) => void;
  private readonly persist: JobPersistence | null;
  private drainWaiters: Array<() => void> = [];

  constructor(opts: QueueOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = opts.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.clock = opts.clock ?? new RealClock();
    this.random = opts.random ?? new MathRandom();
    this.getConcurrencyCap = opts.getConcurrencyCap ?? (() => DEFAULT_CONCURRENCY_CAP);
    this.onEvent = opts.onEvent ?? (() => {});
    this.persist = opts.persist ?? null;
  }

  // -- enqueue --------------------------------------------------------

  enqueue(opts: EnqueueOptions): Job {
    const dedupeKey = opts.dedupe ? jobDedupeKeyString(opts.dedupe) : undefined;
    if (dedupeKey) {
      const existing = this.dedupe.get(dedupeKey);
      if (existing) {
        const entry = this.entries.get(existing);
        if (entry && !isTerminal(entry.job.state)) return copy(entry.job);
        this.dedupe.delete(dedupeKey);
      }
    }
    const job: Job = {
      id: randomUUID(),
      kind: opts.kind,
      model: opts.model,
      provider: opts.provider,
      reviewId: opts.reviewId,
      priority: opts.priority,
      state: "queued",
      attempts: 0,
      ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
      ...(opts.promptSnapshot !== undefined ? { promptSnapshot: opts.promptSnapshot } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
      ...(opts.cardId ? { cardId: opts.cardId } : {}),
    };
    const entry: Entry = {
      job,
      run: opts.run,
      reviewId: opts.reviewId,
      cardId: opts.cardId,
      ...(opts.threadId ? { threadId: opts.threadId } : {}),
      seq: this.seq++,
    };
    this.entries.set(job.id, entry);
    if (dedupeKey) this.dedupe.set(dedupeKey, job.id);
    this.save(entry);
    this.emit(entry);
    this.pump();
    return copy(job);
  }

  // -- reads ----------------------------------------------------------

  get(id: string): Job | undefined {
    const entry = this.entries.get(id);
    return entry ? copy(entry.job) : undefined;
  }

  listByReview(reviewId: string): Job[] {
    return [...this.entries.values()]
      .filter((e) => e.reviewId === reviewId)
      .sort((a, b) => a.seq - b.seq)
      .map((e) => {
        const job = copy(e.job);
        // Prompt snapshots ride separately (`GET /api/jobs/:id/prompt`):
        // lists stay small after hundreds of jobs (PRD §16 snapshot size).
        // `get()` keeps the full job.
        delete job.promptSnapshot;
        return job;
      });
  }

  /**
   * Jobs that are not yet terminal (queued, running, backing-off).
   * Orphaned entries without a `run` function (found at startup, awaiting
   * `rebind`) are skipped, matching {@link drain}'s definition of done —
   * they can never execute, so they must not block idle exit.
   */
  activeCount(): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.run === undefined) continue;
      if (!isTerminal(e.job.state)) n += 1;
    }
    return n;
  }

  /**
   * The same non-terminal set `activeCount` counts, oldest first, capped
   * at `limit`. The version-picker switch route reports these so the UI
   * can name what's running instead of refusing with a bare count
   * (issue #36 follow-up: switch with running jobs).
   */
  listActive(limit = 5): Job[] {
    const ordered = [...this.entries.values()].sort((a, b) => a.seq - b.seq);
    const out: Job[] = [];
    for (const e of ordered) {
      if (e.run === undefined) continue;
      if (isTerminal(e.job.state)) continue;
      out.push(copy(e.job));
      if (out.length >= limit) break;
    }
    return out;
  }

  // -- priority -------------------------------------------------------

  /** Raise (or lower) a job's priority; takes effect while queued. */
  setPriority(id: string, priority: number): Job {
    const entry = this.required(id);
    entry.job.priority = priority;
    this.save(entry);
    this.emit(entry);
    this.pump();
    return copy(entry.job);
  }

  // -- cancellation ---------------------------------------------------

  /** Cancel a job: immediate while queued/backing-off, abort while running. */
  cancel(id: string): Job {
    const entry = this.required(id);
    if (isTerminal(entry.job.state)) return copy(entry.job);
    entry.abort?.abort();
    entry.job.state = "cancelled";
    entry.job.error = undefined;
    entry.job.nextRetryAt = undefined;
    this.forgetDedupe(entry);
    this.save(entry);
    this.emit(entry);
    this.checkDrain();
    return copy(entry.job);
  }

  // -- retry / rebind -------------------------------------------------

  /**
   * Retry a terminal job under the same id (used after errors and after
   * a restart marked jobs interrupted). Reuses the stored `run` when no
   * new one is given; throws when neither exists.
   */
  retry(id: string, run?: JobFn): Job {
    const entry = this.required(id);
    if (!isTerminal(entry.job.state)) return copy(entry.job);
    if (run) entry.run = run;
    if (!entry.run) throw new Error(`JobQueue.retry: no run function for job ${id}`);
    entry.job.state = "queued";
    entry.job.attempts = 0;
    entry.job.error = undefined;
    entry.job.nextRetryAt = undefined;
    if (entry.job.dedupeKey) this.dedupe.set(entry.job.dedupeKey, entry.job.id);
    this.save(entry);
    this.emit(entry);
    this.pump();
    return copy(entry.job);
  }

  /**
   * Attach a `run` function to a job entry that lost it. `recover()` no
   * longer produces such entries (open jobs come back interrupted), so
   * this is only for hand-built queues in tests.
   */
  rebind(id: string, run: JobFn): Job {
    const entry = this.required(id);
    entry.run = run;
    this.pump();
    return copy(entry.job);
  }

  // -- restart recovery -------------------------------------------------

  /**
   * Reconcile jobs persisted by a previous process. Every open job —
   * running, backing off, or still queued — is marked interrupted
   * (terminal `error`, retryable by re-enqueueing). Queued jobs come back
   * as interrupted rather than orphans: nothing in the service rebinds a
   * persisted job to a fresh `run` (pipeline stages re-enqueue via
   * `resumeReview`, on-demand turns rebuild via the action retry paths),
   * so an orphan could never execute — and worse, its dedupe key would
   * make a fresh re-enqueue silently attach to the dead job. The Jobs
   * view keeps the interrupted rows as history.
   */
  recover(open: Job[]): { interrupted: Job[]; orphaned: Job[] } {
    const interrupted: Job[] = [];
    const orphaned: Job[] = [];
    for (const saved of open) {
      if (this.entries.has(saved.id)) continue;
      const job: Job = {
        ...saved,
        state: "error",
        error: INTERRUPTED_MESSAGE,
        nextRetryAt: undefined,
      };
      this.entries.set(job.id, {
        job,
        run: undefined,
        reviewId: job.reviewId ?? "",
        ...(job.cardId ? { cardId: job.cardId } : {}),
        seq: this.seq++,
      });
      const entry = this.entries.get(job.id)!;
      // The dead job must not block a fresh re-enqueue under the same key.
      this.forgetDedupe(entry);
      this.save(entry);
      this.emit(entry);
      interrupted.push(copy(job));
    }
    return { interrupted, orphaned };
  }

  /** Abort everything; used on service shutdown. */
  shutdown(): void {
    for (const entry of this.entries.values()) {
      if (!isTerminal(entry.job.state)) {
        entry.abort?.abort();
        entry.job.state = "cancelled";
        entry.job.nextRetryAt = undefined;
        this.save(entry);
        this.emit(entry);
      }
    }
    this.dedupe.clear();
    this.checkDrain();
  }

  /** Test helper: resolve once no runnable job is active or pending. */
  async drain(timeoutMs = 5000): Promise<void> {
    if (this.isDrained()) return;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.drainWaiters = this.drainWaiters.filter((w) => w !== done);
        reject(new Error("JobQueue.drain: timed out"));
      }, timeoutMs);
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.drainWaiters.push(done);
    });
  }

  // -- internals --------------------------------------------------------

  private required(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`JobQueue: unknown job ${id}`);
    return entry;
  }

  private runningCount(provider: string): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.job.provider === provider && e.job.state === "running") n += 1;
    }
    return n;
  }

  /** Start queued jobs while per-provider caps allow, highest priority first. */
  private pump(): void {
    const queued = [...this.entries.values()]
      .filter((e) => e.job.state === "queued" && e.run !== undefined)
      .sort((a, b) => b.job.priority - a.job.priority || a.seq - b.seq);
    for (const entry of queued) {
      const provider = entry.job.provider ?? "";
      if (this.runningCount(provider) >= this.getConcurrencyCap(provider)) continue;
      void this.execute(entry);
    }
  }

  private async execute(entry: Entry): Promise<void> {
    const job = entry.job;
    job.state = "running";
    job.attempts = (job.attempts ?? 0) + 1;
    job.nextRetryAt = undefined;
    const controller = new AbortController();
    entry.abort = controller;
    this.save(entry);
    this.emit(entry);

    const ctx = this.makeContext(entry, controller);
    try {
      await entry.run!(ctx);
      this.settle(entry, controller, controller.signal.aborted ? "cancelled" : "done");
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) {
        this.settle(entry, controller, "cancelled");
        return;
      }
      if (err instanceof RetryableError && (job.attempts ?? 1) < this.maxAttempts) {
        await this.backOff(entry, controller, err);
        return;
      }
      job.error = err instanceof Error ? err.message : String(err);
      reportError(err, { jobId: job.id, kind: job.kind, provider: job.provider, attempts: job.attempts });
      this.settle(entry, controller, "error");
    }
  }

  private async backOff(entry: Entry, controller: AbortController, err: RetryableError): Promise<void> {
    const job = entry.job;
    const attemptIndex = (job.attempts ?? 1) - 1;
    const delay = computeBackoffDelay(attemptIndex, this.backoffBaseMs, this.backoffMaxMs, this.random.next());
    job.state = "backing-off";
    job.error = err.message;
    job.nextRetryAt = this.clock.now() + delay;
    this.save(entry);
    this.emit(entry);
    try {
      await this.clock.sleep(delay, controller.signal);
    } catch (sleepErr) {
      if (controller.signal.aborted || isAbortError(sleepErr)) {
        this.settle(entry, controller, "cancelled");
        return;
      }
      job.error = sleepErr instanceof Error ? sleepErr.message : String(sleepErr);
      this.settle(entry, controller, "error");
      return;
    }
    if (controller.signal.aborted) {
      this.settle(entry, controller, "cancelled");
      return;
    }
    job.state = "queued";
    job.nextRetryAt = undefined;
    this.save(entry);
    this.emit(entry);
    entry.abort = undefined;
    this.pump();
    this.checkDrain();
  }

  private settle(entry: Entry, controller: AbortController, state: Job["state"]): void {
    if (entry.abort === controller) entry.abort = undefined;
    entry.job.state = state;
    if (state !== "backing-off") entry.job.nextRetryAt = undefined;
    if (state === "cancelled") entry.job.error = undefined;
    if (isTerminal(state)) this.forgetDedupe(entry);
    this.save(entry);
    this.emit(entry);
    this.pump();
    this.checkDrain();
  }

  private makeContext(entry: Entry, controller: AbortController): JobContext {
    const job = entry.job;
    return {
      signal: controller.signal,
      reportUsage: (usage) => {
        job.usage = {
          inputTokens: (job.usage?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
          cachedTokens: (job.usage?.cachedTokens ?? 0) + (usage.cachedTokens ?? 0),
          outputTokens: (job.usage?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        };
        // Read share (M0 spike pitfall #2): inputTokens counts UNCACHED
        // input only, so the rate is cached/(input+cached), never
        // cached/input (which can exceed 1).
        const input = job.usage.inputTokens;
        const cached = job.usage.cachedTokens;
        job.cacheHitRate = input + cached > 0 ? cached / (input + cached) : undefined;
        this.save(entry);
        this.emit(entry);
      },
      reportText: (delta) => {
        this.onEvent(entry.reviewId, {
          type: "text",
          jobId: job.id,
          ...(entry.cardId ? { cardId: entry.cardId } : {}),
          ...(entry.threadId ? { threadId: entry.threadId } : {}),
          delta,
        });
      },
      setPromptSnapshot: (text) => {
        job.promptSnapshot = text;
        this.save(entry);
        this.emit(entry);
      },
      setSessionId: (id) => {
        job.sessionId = id;
        this.save(entry);
        this.emit(entry);
      },
    };
  }

  private forgetDedupe(entry: Entry): void {
    const key = entry.job.dedupeKey;
    if (key && this.dedupe.get(key) === entry.job.id) this.dedupe.delete(key);
  }

  private save(entry: Entry): void {
    this.persist?.save(copy(entry.job));
  }

  private emit(entry: Entry): void {
    this.onEvent(entry.reviewId, { type: "job", job: copy(entry.job) });
  }

  private isDrained(): boolean {
    for (const e of this.entries.values()) {
      if (e.run === undefined) continue; // orphaned (needs rebind) or interrupted
      if (!isTerminal(e.job.state)) return false;
    }
    return true;
  }

  private checkDrain(): void {
    if (!this.isDrained()) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    for (const w of waiters) w();
  }
}

function isTerminal(state: Job["state"]): boolean {
  return state === "done" || state === "error" || state === "cancelled";
}

export { RetryableError };
