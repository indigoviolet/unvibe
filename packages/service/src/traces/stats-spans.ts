/**
 * Stats-shaped span attributes (issue #366): the former `stats export`
 * fields now ride on the trace spans themselves, recorded RAW and
 * scrubbed on export by the existing scrubber (see `scrub.ts`).
 *
 * - Job spans (`job <kind>`) carry the model, tokens, tool counts,
 *   reads (raw path + line range + diff membership), turns, repairs,
 *   attempts, failure class, and queued/duration timings.
 * - Review spans (`ingest` / `refresh`) carry the size buckets, guide
 *   size, threads, versions and cap-skipped hunk summaries.
 *
 * Numbers, enums and raw ids/paths only — no free text. The export
 * scrubber hashes every id and path, keeps known enums verbatim, and
 * maps unknown enum values to `other` (the same fail-closed rule the
 * old exporter used).
 */
import { isDocumentReview } from "@unvibe/shared";
import type { Job, ReviewSnapshot } from "@unvibe/shared";

export const JOB_KINDS = new Set([
  "reader", "critic", "hunk-pass", "concept", "ask", "depth", "examples",
  "diagram", "go-deeper", "update-pass", "summarize",
  "plotline-assign", "consolidate", "persona",
]);
export const JOB_STATES = new Set(["queued", "running", "backing-off", "done", "error", "cancelled"]);

export type StatsAttrs = Record<string, string | number | boolean>;

const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Tool/attribute name kept verbatim, else folded to `other` (never raw). */
export function safeName(value: string): string {
  return SAFE_TOKEN.test(value) ? value : "other";
}

export type FailureClass =
  | "timeout"
  | "rate-limit"
  | "auth"
  | "no-agent"
  | "not-found"
  | "head-moved"
  | "network"
  | "cancelled"
  | "interrupted"
  | "other";

export function failureClassOf(error: string | undefined | null): FailureClass | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (/timed? ?out|deadline/.test(e)) return "timeout";
  if (/rate.?limit|too many requests|429/.test(e)) return "rate-limit";
  if (/unauthor|forbidden|401|403|auth|login|credential/.test(e)) return "auth";
  if (/no agent|not installed|not logged in|adapter.*down/.test(e)) return "no-agent";
  if (/not found|404|no such/.test(e)) return "not-found";
  if (/head.?moved|head moved/.test(e)) return "head-moved";
  if (/cancel/.test(e)) return "cancelled";
  if (/interrupt/.test(e)) return "interrupted";
  if (/network|fetch failed|econn|socket|dns/.test(e)) return "network";
  return "other";
}

const READ_TOOL = /read|view|cat|open|get_file|file_slice/i;

/** Line span of one diff hunk (new side preferred, old side as fallback). */
function hunkLineSpan(h: { newStart: number; newEnd: number; oldStart: number; oldEnd: number }): number | null {
  const spans = [h.newEnd - h.newStart + 1, h.oldEnd - h.oldStart + 1].filter((n) => n > 0);
  return spans.length > 0 ? Math.max(...spans) : null;
}

/** Numeric detail field, when it is a safe finite number. */
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Line count from a parsed tool-argument object (`get_code` carries
 * `path` + `startLine`/`endLine`; `get_hunk` carries a hunk id). Only
 * numbers and raw paths leave this function — raw strings never do.
 */
function linesFromArgs(
  args: Record<string, unknown>,
  hunkLines: Map<string, { path: string; lines: number | null }>,
): { filePath: string; lines: number | null; hunkRead: boolean } | null {
  // Hunk reads first: the hunk id resolves to its file + line span.
  const hunkRaw = args["hunkHash"] ?? args["contentHash"] ?? args["hunk"] ?? args["hunkId"] ?? args["hunkID"];
  if (typeof hunkRaw === "string") {
    const contentHash = hunkRaw.includes(":") ? (hunkRaw.split(":").pop() ?? "") : hunkRaw;
    const found = contentHash ? hunkLines.get(contentHash) : undefined;
    if (found) return { filePath: found.path, lines: found.lines, hunkRead: true };
  }
  const pathRaw =
    args["path"] ?? args["file"] ?? args["filePath"] ?? args["filename"] ?? args["filepath"];
  if (typeof pathRaw !== "string" || !pathRaw.includes("/") || pathRaw.startsWith("http")) return null;
  const filePath = pathRaw;
  const start = num(args["startLine"] ?? args["start"] ?? args["line"] ?? args["from"]);
  const end = num(args["endLine"] ?? args["end"] ?? args["to"]);
  const count = num(args["lineCount"] ?? args["numLines"] ?? args["count"] ?? args["limit"]);
  const arrayRange = Array.isArray(args["lines"]) ? (args["lines"] as unknown[]) : null;
  let lines: number | null = null;
  if (start !== null && end !== null && end >= start) lines = end - start + 1;
  else if (count !== null && count >= 0) lines = Math.round(count);
  else if (
    arrayRange !== null &&
    arrayRange.length === 2 &&
    typeof arrayRange[0] === "number" &&
    typeof arrayRange[1] === "number" &&
    (arrayRange[1] as number) >= (arrayRange[0] as number)
  ) {
    lines = (arrayRange[1] as number) - (arrayRange[0] as number) + 1;
  }
  return { filePath, lines, hunkRead: false };
}

/** Diff membership for a plaintext path (computed before hashing). */
function isInsideDiff(filePath: string, diffPaths: Set<string>): boolean {
  return diffPaths.has(filePath) || [...diffPaths].some((p) => p !== "" && filePath.endsWith(`/${p}`));
}

export interface RawRead {
  /** Raw file path (hashed by the export scrubber, never kept). */
  file: string;
  /** Lines read when the tool detail named a range, else null. */
  lines: number | null;
  /** True when the file is part of the review's diff. */
  insideDiff: boolean;
}

/**
 * Raw (unhashed) file reads from a job's tool calls. Same parse as the
 * old stats exporter; hashing happens in the export scrubber.
 */
export function extractRawReads(
  job: Job,
  diffPaths: Set<string>,
  hunkLines: Map<string, { path: string; lines: number | null }>,
): RawRead[] {
  const calls = [
    ...(job.tools ?? []),
    ...(job.turnRecords ?? []).flatMap((t) => t.tools ?? []),
  ];
  const reads: RawRead[] = [];
  for (const call of calls) {
    if (!READ_TOOL.test(call.name) && !call.detail) continue;
    const detail = call.detail ?? "";
    // Structured arguments first (`get_code`/`get_hunk` JSON): path and
    // line range come from named fields, never from free text.
    if (detail.startsWith("{")) {
      try {
        const args = JSON.parse(detail) as Record<string, unknown>;
        if (args && typeof args === "object" && !Array.isArray(args)) {
          const parsed = linesFromArgs(args, hunkLines);
          if (parsed) {
            reads.push({
              file: parsed.filePath,
              lines: parsed.lines,
              insideDiff: parsed.hunkRead || isInsideDiff(parsed.filePath, diffPaths),
            });
            continue;
          }
        }
      } catch {
        // Truncated detail (the 300-char cap marker): fall through to
        // the token parser below.
      }
    }
    // Path-like tokens only; the detail itself is never emitted.
    for (const raw of detail.split(/[\s"',;()[\]{}<>]+/)) {
      const token = raw.replace(/^[^A-Za-z0-9._/-]+|[^A-Za-z0-9._/-]+$/g, "");
      if (!token.includes("/") || token.startsWith("http")) continue;
      const range = token.match(/:(\d+)(?:-(\d+))?$/);
      const filePath = range ? token.slice(0, token.length - range[0].length) : token;
      if (!filePath.includes("/")) continue;
      const lines = range ? Math.max(0, Number(range[2] ?? range[1]) - Number(range[1]) + 1) : null;
      const insideDiff =
        diffPaths.has(filePath) || [...diffPaths].some((p) => filePath.endsWith(`/${p}`));
      reads.push({ file: filePath, lines, insideDiff });
      break; // one read per tool call
    }
  }
  return reads;
}

function diffMs(a: number | undefined, b: number | undefined): number | null {
  if (typeof a !== "number" || typeof b !== "number") return null;
  const d = b - a;
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
}

function diffPathsOf(snapshot: ReviewSnapshot | null | undefined): Set<string> {
  return new Set((snapshot?.files ?? []).map((f) => f.path));
}

function hunkLinesOf(
  snapshot: ReviewSnapshot | null | undefined,
): Map<string, { path: string; lines: number | null }> {
  const out = new Map<string, { path: string; lines: number | null }>();
  for (const f of snapshot?.files ?? []) {
    for (const h of f.hunks ?? []) out.set(h.contentHash, { path: f.path, lines: hunkLineSpan(h) });
  }
  return out;
}

/**
 * Attributes set when a job span starts: identity + routing only (the
 * rest is known only once the job settles). Raw ids — the export
 * scrubber hashes them.
 */
export function jobStartAttributes(job: Job, attempt: number): StatsAttrs {
  return {
    "job.id": job.id,
    "job.kind": job.kind,
    ...(job.provider ? { "job.provider": job.provider } : {}),
    ...(job.model ? { "job.model": job.model } : {}),
    "job.attempt": attempt,
    ...(job.reviewId ? { "job.review": job.reviewId } : {}),
  };
}

/**
 * Attributes set when a job span ends: every former stats job field.
 * Reads resolve against the review snapshot when available (diff
 * membership + `get_hunk` line spans); without one every path still
 * records, marked outside the diff — the old exporter's empty-diff
 * behavior.
 */
export function jobEndAttributes(job: Job, snapshot?: ReviewSnapshot | null): StatsAttrs {
  const out: StatsAttrs = { "job.state": job.state };
  if (job.sessionId) out["job.session"] = job.sessionId;
  out["job.effort"] = job.effort ?? "";
  if (job.accessMode === "full" || job.accessMode === "lockdown") out["job.access"] = job.accessMode;
  if (job.usage) {
    out["job.tokens.input"] = job.usage.inputTokens;
    out["job.tokens.cached_read"] = job.usage.cachedReadTokens;
    out["job.tokens.cached_write"] = job.usage.cachedWriteTokens;
    out["job.tokens.output"] = job.usage.outputTokens;
  }
  const calls = [...(job.tools ?? []), ...(job.turnRecords ?? []).flatMap((t) => t.tools ?? [])];
  const counts = new Map<string, number>();
  for (const c of calls) {
    const name = safeName(c.name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const [tool, count] of counts) out[`job.tool.${tool}`] = count;
  const reads = extractRawReads(job, diffPathsOf(snapshot), hunkLinesOf(snapshot));
  reads.forEach((r, i) => {
    out[`job.read.${i}.file`] = r.file;
    if (r.lines !== null) out[`job.read.${i}.lines`] = r.lines;
    out[`job.read.${i}.inside`] = r.insideDiff;
  });
  out["job.turns"] = job.turnRecords?.length ?? job.turns?.length ?? 0;
  out["job.repairs"] = (job.turnRecords ?? []).filter((t) => /repair/i.test(t.label)).length;
  out["job.attempts"] = job.attempts ?? job.attemptTimings?.length ?? 0;
  if (job.state === "error" || job.state === "cancelled") {
    out["job.failure"] = failureClassOf(job.error) ?? "other";
  }
  const queuedMs = diffMs(job.queuedAt, job.startedAt);
  const durationMs = diffMs(job.startedAt, job.finishedAt);
  if (queuedMs !== null) out["job.queued_ms"] = queuedMs;
  if (durationMs !== null) out["job.duration_ms"] = durationMs;
  return out;
}

/**
 * Attributes for a review span (`ingest` / `refresh`): every former
 * stats review field except the job count (jobs are counted from the
 * job spans in `stats:summary`). Counts only — no text, no paths.
 */
export function reviewAttributes(snapshot: ReviewSnapshot): StatsAttrs {
  const files = snapshot.files ?? [];
  let hunks = 0, added = 0, removed = 0;
  for (const f of files) {
    for (const h of f.hunks ?? []) {
      hunks++;
      added += h.added || 0;
      removed += h.removed || 0;
    }
  }
  const summarized = new Set(
    (snapshot.hunkStates ?? []).filter((st) => st.summary !== undefined).map((st) => st.contentHash),
  );
  const missingSummaries = files.reduce(
    (n, f) => n + (f.hunks ?? []).filter((h) => !summarized.has(h.contentHash)).length,
    0,
  );
  const threads = snapshot.annotations ?? [];
  return {
    "review.kind": isDocumentReview(snapshot) ? "document" : "change",
    "review.files": files.length,
    "review.hunks": hunks,
    "review.skipped": missingSummaries,
    "review.added": added,
    "review.removed": removed,
    "review.pages": (snapshot.pages ?? []).length,
    "review.cards": (snapshot.pages ?? []).reduce((n, p) => n + (p.cards ?? []).length, 0),
    "review.threads": threads.length,
    "review.replies": threads.reduce((n, t) => n + (t.replies ?? []).length, 0),
    "review.outbox": threads.filter((t) => t.post && !t.postedAt).length,
    "review.versions": (snapshot.review.versions ?? []).length || 1,
  };
}
