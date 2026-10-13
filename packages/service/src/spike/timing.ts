/**
 * SPIKE(#114) latency instrumentation. Lives on `spike/latency` only.
 *
 * With `UNVIBE_SPIKE_TIMING=<file>` set, every mark is appended to that
 * file as one JSON line `{ t, name, ...data }` (`t` = epoch ms). Unset, all
 * of this is a no-op. Read by `spikes/latency/`.
 */
import fs from "node:fs";

const file = process.env.UNVIBE_SPIKE_TIMING;

export const spikeOn = Boolean(file);

export function spikeMark(name: string, data: Record<string, unknown> = {}): void {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${JSON.stringify({ t: Date.now(), name, ...data })}\n`);
  } catch {
    // instrumentation never fails the caller
  }
}

// Hook for modules that must not import this file (see exec/runner.ts).
(globalThis as { __unvibeSpikeMark?: typeof spikeMark }).__unvibeSpikeMark = spikeMark;

/** Time an async step; the mark is written when it settles (ok or not). */
export async function spikeTime<T>(name: string, data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
  if (!file) return fn();
  const t0 = performance.now();
  let ok = true;
  try {
    return await fn();
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    spikeMark(name, { ...data, ms: Math.round((performance.now() - t0) * 10) / 10, ok });
  }
}

/** Time a synchronous step. */
export function spikeTimeSync<T>(name: string, data: Record<string, unknown>, fn: () => T): T {
  if (!file) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    spikeMark(name, { ...data, ms: Math.round((performance.now() - t0) * 10) / 10 });
  }
}
