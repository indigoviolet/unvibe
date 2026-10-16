/**
 * Versions + settings pure helpers (M8): token/cache-rate formatting, job
 * list reduction from WS events, expanded-prompt layer splitting, and
 * version-status copy. No DOM, no React — covered by vitest.
 */
import type { Job, ReviewEvent, VersionStatus } from "@unvibe/shared";

/** Compact token counts: 412 → "412", 42500 → "42.5k", 1_200_000 → "1.2M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  const m = n / 1_000_000;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10}M`;
}

/** Cache-hit rate 0..1 → "91.5%"; undefined/NaN → "—". */
export function formatCacheRate(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return "—";
  return `${(Math.max(0, Math.min(1, rate)) * 100).toFixed(1)}%`;
}

/**
 * Read share over jobs carrying usage (#125): read/(input+read+write).
 * Writes never count as hits: a turn with writes and no reads shows 0 %.
 */
export function pooledCacheRate(jobs: Job[]): number | undefined {
  let input = 0;
  let read = 0;
  let write = 0;
  for (const j of jobs) {
    if (!j.usage) continue;
    input += j.usage.inputTokens ?? 0;
    read += j.usage.cachedReadTokens ?? 0;
    write += j.usage.cachedWriteTokens ?? 0;
  }
  const total = input + read + write;
  return total > 0 ? read / total : undefined;
}

/** Total input/output/cache-read/cache-write tokens over jobs carrying usage. */
export function pooledTokens(jobs: Job[]): { input: number; output: number; read: number; written: number } {
  let input = 0;
  let output = 0;
  let read = 0;
  let written = 0;
  for (const j of jobs) {
    if (!j.usage) continue;
    input += j.usage.inputTokens ?? 0;
    output += j.usage.outputTokens ?? 0;
    read += j.usage.cachedReadTokens ?? 0;
    written += j.usage.cachedWriteTokens ?? 0;
  }
  return { input, output, read, written };
}

/** Issue #194: local clock time for an epoch-ms stamp, "—" when absent. */
export function formatLocalTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleTimeString([], { hour12: false });
}

/** Issue #194: compact duration, e.g. "0.4s", "12s", "2m 05s", "1h 03m". */
export function formatDurationMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const secs = ms / 1000;
  if (secs < 10) return `${secs.toFixed(1)}s`;
  if (secs < 60) return `${Math.round(secs)}s`;
  const totalSecs = Math.round(secs);
  if (totalSecs < 3600) return `${Math.floor(totalSecs / 60)}m ${String(totalSecs % 60).padStart(2, "0")}s`;
  return `${Math.floor(totalSecs / 3600)}h ${String(Math.floor((totalSecs % 3600) / 60)).padStart(2, "0")}m`;
}

/** Issue #194: duration of a timed step; live (to `now`) while unfinished. */
export function stepDurationMs(step: { startedAt: number; finishedAt?: number }, now: number): number {
  return (step.finishedAt ?? now) - step.startedAt;
}

/** Issue #194: a job's elapsed time — finished, live while running, queued wait while queued. */
export function jobElapsedMs(job: Job, now: number): number | undefined {
  if (job.finishedAt !== undefined && job.startedAt !== undefined) return job.finishedAt - job.startedAt;
  if (job.startedAt !== undefined) return now - job.startedAt;
  if (job.queuedAt !== undefined) return now - job.queuedAt;
  return undefined;
}

/** Issue #194: median finished duration for one job kind (needs both stamps). */
export function medianFinishedDurationMs(jobs: Job[], kind: Job["kind"]): number | undefined {
  const durations = jobs
    .filter((j) => j.kind === kind && j.startedAt !== undefined && j.finishedAt !== undefined)
    .map((j) => (j.finishedAt as number) - (j.startedAt as number))
    .sort((a, b) => a - b);
  if (durations.length === 0) return undefined;
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 1 ? durations[mid] : ((durations[mid - 1] ?? 0) + (durations[mid] ?? 0)) / 2;
}

/**
 * Issue #194: a running job is marked when it has run over 3× the recent
 * median for its kind (median over this list's finished jobs of the kind;
 * needs at least 3 samples so a single fast job cannot mark everything).
 */
export function isLongRunning(job: Job, jobs: Job[], now: number): boolean {
  if (job.state !== "running" && job.state !== "backing-off") return false;
  const samples = jobs.filter((j) => j.kind === job.kind && j.startedAt !== undefined && j.finishedAt !== undefined).length;
  if (samples < 3) return false;
  const median = medianFinishedDurationMs(jobs, job.kind);
  const elapsed = jobElapsedMs(job, now);
  if (median === undefined || median <= 0 || elapsed === undefined) return false;
  return elapsed > 3 * median;
}

/** "retry in 45s" / "retry in 2m" for a backing-off job; "—" when unknown. */
export function formatRetryIn(nextRetryAt: number | undefined, now = Date.now()): string {
  if (nextRetryAt === undefined || !Number.isFinite(nextRetryAt)) return "—";
  const secs = Math.max(0, Math.round((nextRetryAt - now) / 1000));
  if (secs < 60) return `retry in ${secs}s`;
  return `retry in ${Math.round(secs / 60)}m`;
}

/**
 * Job list reduction from WS events (PRD §4.14 "live through the WebSocket
 * `job` events"): `job` events upsert by id (new jobs appended, so an
 * update-pass job enqueued after the snapshot loaded still appears);
 * every other event leaves the list alone. Pure so settings tests can
 * drive it without a socket.
 */
export function reduceJobs(jobs: Job[], event: ReviewEvent): Job[] {
  if (event.type !== "job") return jobs;
  const i = jobs.findIndex((j) => j.id === event.job.id);
  if (i < 0) return [...jobs, event.job];
  if (jobs[i] === event.job) return jobs;
  const next = [...jobs];
  next[i] = event.job;
  return next;
}

export interface LayerSection {
  layer: string;
  label: string;
  tokens: number;
  cached: boolean;
  text: string;
}

const LAYER_OPEN =
  /<!--\s*layer:([A-Za-z0-9]+)\s+label:(.+?)\s+tokens:(\d+)\s+cached:(yes|no)\s*-->/;
const LAYER_CLOSE = /<!--\s*\/layer:([A-Za-z0-9]+)\s*-->/;

/**
 * Split an expanded prompt into its L0–L4 layer sections on the
 * `<!-- layer:… -->` markers the service emits (see `assemble` in
 * `packages/service/src/routes/prompts.ts`). Text outside markers is kept
 * as an unmarked section so nothing is ever dropped.
 */
export function splitLayers(expanded: string): LayerSection[] {
  const sections: LayerSection[] = [];
  let rest = expanded;
  let lead = "";
  for (;;) {
    const open = LAYER_OPEN.exec(rest);
    if (!open) break;
    const before = rest.slice(0, open.index);
    if (lead === "" && before.trim() !== "") lead = before;
    else if (before.trim() !== "") {
      sections.push({ layer: "", label: "text", tokens: 0, cached: false, text: before.trim() });
    }
    const afterOpen = rest.slice(open.index + open[0].length);
    const close = LAYER_CLOSE.exec(afterOpen);
    const text = close ? afterOpen.slice(0, close.index) : afterOpen;
    sections.push({
      layer: open[1],
      label: open[2],
      tokens: Number(open[3]),
      cached: open[4] === "yes",
      // Markers sit on their own lines; drop the surrounding newlines only.
      text: text.replace(/^\n/, "").replace(/\n+$/, ""),
    });
    rest = close ? afterOpen.slice(close.index + close[0].length) : "";
    if (!close) break;
  }
  if (rest.trim() !== "") {
    sections.push({ layer: "", label: "text", tokens: 0, cached: false, text: rest.trim() });
  }
  if (sections.length === 0 && expanded.trim() !== "") {
    sections.push({ layer: "", label: "text", tokens: 0, cached: false, text: expanded.trim() });
  }
  if (lead !== "") sections.unshift({ layer: "", label: "text", tokens: 0, cached: false, text: lead.trim() });
  return sections;
}

/** "1 changed · 2 new · 0 removed" for the update banner + start page. */
export function versionCountsText(s: {
  changedHunks: number;
  newHunks: number;
  removedHunks: number;
}): string {
  const part = (n: number, what: string): string => `${n} ${what}`;
  return `${part(s.changedHunks, "changed")} · ${part(s.newHunks, "new")} · ${part(s.removedHunks, "removed")}`;
}

/** Banner headline for a stale review (PRD §8 "New commits on this branch"). */
export function staleHeadline(status: VersionStatus): string {
  return `New commits on this branch: v${status.fromVersion} → v${status.toVersion} (${versionCountsText(status)} hunks)`;
}

/**
 * Quiet refresh failure, in words: what happened and that the current
 * view is still usable. Never a console error, never a status code.
 */
export function refreshErrorNotice(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/failed to fetch|networkerror|load failed|offline/i.test(msg)) {
    return "The Unvibe service isn't answering. Showing the last fetched version.";
  }
  if (/\b404\b/.test(msg)) return "This review no longer exists";
  if (/\b502\b/.test(msg)) return "Couldn't fetch from the repo's remote. Showing the last fetched version.";
  return "Couldn't check for new commits — showing the last fetched version.";
}
