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
/**
 * #123: small-model jobs (hunk summaries) run in their own concurrency
 * bucket per provider, so the hunk pass never queues behind main-model
 * critics. The burst stays bounded (provider rate limits surface as
 * retryable errors and back off through the usual schedule).
 */
export const SMALL_CONCURRENCY_CAP = 4;
const SMALL_JOB_KINDS: ReadonlySet<JobKind> = new Set(["hunk-pass", "summarize", "consolidate"]);
export const INTERRUPTED_MESSAGE = "stopped because the service restarted — retry to run it again";

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
  /** Issue #136: annotation the streamed text belongs to (conversation fills). */
  annotationId?: string;
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
  annotationId?: string;
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
      ...(opts.annotationId ? { annotationId: opts.annotationId } : {}),
      ...(opts.cardId ? { cardId: opts.cardId } : {}),
    };
    const entry: Entry = {
      job,
      run: opts.run,
      reviewId: opts.reviewId,
      cardId: opts.cardId,
      ...(opts.annotationId ? { annotationId: opts.annotationId } : {}),
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

  /**
   * Re-target a job at a new card (issue #152: promote moves a
   * conversation's fill to a page card while it runs, so the page shows
   * the working state through the usual `cardId` match). The job keeps
   * running; only its address changes.
   */
  retarget(id: string, cardId: string): Job {
    const entry = this.required(id);
    entry.job.cardId = cardId;
    entry.cardId = cardId;
    this.save(entry);
    this.emit(entry);
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

  /**
   * Drop every entry for a review (review delete, #115 redo). Without
   * this, finished jobs linger in memory after their rows are deleted, so
   * the jobs endpoint keeps listing a deleted review's jobs. Dedupe keys
   * go too, so a re-opened review starts clean. Callers cancel live jobs
   * first; a detached run settling afterwards still saves once
   * (pre-existing cancel-then-settle race, unchanged).
   */
  dropReview(reviewId: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.reviewId !== reviewId) continue;
      this.forgetDedupe(entry);
      this.entries.delete(id);
    }
    this.checkDrain();
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
   * Reconcile jobs persisted by a previous process (issue #117: pass every
   * stored job, so finished jobs stay listed after a restart). Every open
   * job — running, backing off, or still queued — is marked interrupted
   * (terminal `error`, retryable by re-enqueueing). Queued jobs come back
   * as interrupted rather than orphans: nothing in the service rebinds a
   * persisted job to a fresh `run` (pipeline stages re-enqueue via
   * `resumeReview`, on-demand turns rebuild via the action retry paths),
   * so an orphan could never execute — and worse, its dedupe key would
   * make a fresh re-enqueue silently attach to the dead job. Finished
   * jobs (done, error, cancelled) load back unchanged as history: the
   * Jobs view lists them with their prompts and results. Hydrated entries
   * carry no `run`, so they never execute, never count as active, and
   * never block idle exit.
   */
  recover(savedJobs: Job[]): { interrupted: Job[]; orphaned: Job[] } {
    const interrupted: Job[] = [];
    const orphaned: Job[] = [];
    for (const saved of savedJobs) {
      if (this.entries.has(saved.id)) continue;
      const open = !isTerminal(saved.state);
      const job: Job = open
        ? {
            ...saved,
            state: "error",
            error: INTERRUPTED_MESSAGE,
            nextRetryAt: undefined,
          }
        : { ...saved };
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
      if (open) interrupted.push(copy(job));
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

  private runningCount(provider: string, small: boolean): number {
    let n = 0;
    for (const e of this.entries.values()) {
      if (e.job.provider === provider && e.job.state === "running" && SMALL_JOB_KINDS.has(e.job.kind) === small) {
        n += 1;
      }
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
      const small = SMALL_JOB_KINDS.has(entry.job.kind);
      const cap = small ? SMALL_CONCURRENCY_CAP : this.getConcurrencyCap(provider);
      if (this.runningCount(provider, small) >= cap) continue;
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
          cachedReadTokens: (job.usage?.cachedReadTokens ?? 0) + (usage.cachedReadTokens ?? 0),
          cachedWriteTokens: (job.usage?.cachedWriteTokens ?? 0) + (usage.cachedWriteTokens ?? 0),
          outputTokens: (job.usage?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        };
        // Read share (#125, M0 spike pitfall #2): inputTokens counts
        // UNCACHED input only, so the rate is read/(input+read+write),
        // never cached/input (which can exceed 1); writes never count.
        const total = job.usage.inputTokens + job.usage.cachedReadTokens + job.usage.cachedWriteTokens;
        job.cacheHitRate = total > 0 ? job.usage.cachedReadTokens / total : undefined;
        this.save(entry);
        this.emit(entry);
      },
      reportText: (delta) => {
        this.onEvent(entry.reviewId, {
          type: "text",
          jobId: job.id,
          ...(entry.cardId ? { cardId: entry.cardId } : {}),
          ...(entry.annotationId ? { annotationId: entry.annotationId } : {}),
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
