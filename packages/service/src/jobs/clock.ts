/**
 * Injectable clock + randomness for the job queue (PRD §12, §18).
 *
 * Production uses real timers; tests use {@link ManualClock} + a stub
 * random source so back-off schedules are deterministic.
 */

export interface Clock {
  now(): number;
  /**
   * Resolve after `ms`. Reject with an `AbortError` DOMException when
   * `signal` aborts first.
   */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface RandomSource {
  /** Uniform [0, 1). */
  next(): number;
}

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export class MathRandom implements RandomSource {
  next(): number {
    return Math.random();
  }
}

/** Deterministic random: cycles through `values` (default always 0). */
export class FakeRandom implements RandomSource {
  private i = 0;
  constructor(private readonly values: number[] = [0]) {}
  next(): number {
    const v = this.values[this.i % this.values.length];
    this.i += 1;
    return v;
  }
}

interface PendingSleep {
  due: number;
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Manual clock for tests. Time only moves via {@link advance}; pending
 * sleeps resolve in due order. Aborting a sleep's signal rejects it.
 */
export class ManualClock implements Clock {
  private t: number;
  private pending: PendingSleep[] = [];

  constructor(start = 0) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  pendingSleeps(): number {
    return this.pending.length;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    }
    const due = this.t + Math.max(0, ms);
    return new Promise<void>((resolve, reject) => {
      const entry: PendingSleep = { due, resolve, reject, signal };
      entry.onAbort = (): void => {
        const i = this.pending.indexOf(entry);
        if (i >= 0) this.pending.splice(i, 1);
        reject(new DOMException("Aborted", "AbortError"));
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.pending.push(entry);
    });
  }

  /** Move time forward, resolving every sleep whose time has come. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      this.pending.sort((a, b) => a.due - b.due);
      const next = this.pending[0];
      if (!next || next.due > target) break;
      this.pending.shift();
      this.t = next.due;
      next.signal?.removeEventListener("abort", next.onAbort!);
      next.resolve();
      // Let continuations run (they may schedule new sleeps at now).
      await Promise.resolve();
    }
    this.t = target;
    await Promise.resolve();
  }
}
