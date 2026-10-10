/**
 * Idle exit (PRD §14): the service exits after `idleMs` (default 10
 * minutes) with no open window and no running or queued jobs.
 *
 * - "Open window" = WebSocket clients (`wsClients`) or recent HTTP
 *   requests (`lastHttpAt`). `/api/health` polls never count: the `start`
 *   waiter and any external prober must not keep the service alive.
 * - "Running jobs" is an injected function (`hasActiveJobs`) because the
 *   job queue is owned elsewhere; the service wires it to the real queue.
 * - Time is injected (`now`) so tests drive it with a fake clock; the
 *   periodic `start()` timer is real time and `unref()`d so it never holds
 *   the process open on its own.
 */

export const DEFAULT_IDLE_MS = 10 * 60 * 1000;
/** How often the monitor re-checks while running (bounded by idleMs). */
export const MAX_CHECK_INTERVAL_MS = 30_000;

export interface IdleState {
  /** Open WebSocket clients (open windows). */
  wsClients: () => number;
  /** Epoch ms of the last counted HTTP request, or null when none yet. */
  lastHttpAt: () => number | null;
  /** True while any job is running, queued, or backing off. */
  hasActiveJobs: () => boolean;
}

export interface IdleMonitorOptions {
  state: IdleState;
  /** Defaults to {@link DEFAULT_IDLE_MS}. Non-positive disables. */
  idleMs?: number;
  /** Epoch-ms clock. Defaults to `Date.now`. */
  now?: () => number;
  /** Check period. Defaults to `min(30s, idleMs)`. */
  checkIntervalMs?: number;
  /** Runs once when the idle condition first holds; then the monitor stops. */
  onIdle: () => void | Promise<void>;
}

export class IdleMonitor {
  private readonly state: IdleState;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly checkIntervalMs: number;
  private readonly onIdle: () => void | Promise<void>;
  private readonly startedAt: number;
  private timer: NodeJS.Timeout | null = null;
  private fired = false;

  constructor(opts: IdleMonitorOptions) {
    this.state = opts.state;
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.now = opts.now ?? Date.now;
    this.checkIntervalMs = Math.max(
      1000,
      Math.min(opts.checkIntervalMs ?? MAX_CHECK_INTERVAL_MS, this.idleMs),
    );
    this.onIdle = opts.onIdle;
    this.startedAt = this.now();
  }

  /** True while the monitor is configured to ever fire. */
  get enabled(): boolean {
    return this.idleMs > 0;
  }

  /**
   * True when the service has been without windows, requests and jobs for
   * at least `idleMs`. Pure except for the injected state functions, so
   * tests call this directly with a fake clock.
   */
  isIdle(at?: number): boolean {
    if (!this.enabled) return false;
    const now = at ?? this.now();
    if (this.state.hasActiveJobs()) return false;
    if (this.state.wsClients() > 0) return false;
    const last = this.state.lastHttpAt() ?? this.startedAt;
    return now - last >= this.idleMs;
  }

  /** One check: fire `onIdle` (once) when idle. Returns whether it fired. */
  check(at?: number): boolean {
    if (this.fired) return true;
    if (!this.isIdle(at)) return false;
    this.fired = true;
    this.stop();
    void this.onIdle();
    return true;
  }

  /** Begin periodic checks. Safe to call twice. */
  start(): void {
    if (!this.enabled || this.timer || this.fired) return;
    this.timer = setInterval(() => this.check(), this.checkIntervalMs);
    // The timer must not keep the service alive by itself.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
