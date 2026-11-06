/**
 * Anonymized stats exporter (issue #323). Allowlist by construction:
 * only the `StatsExport` fields are ever written. The salt is random
 * per call, kept in memory, and never returned or persisted. All times
 * are relative (durations / offsets from review creation); no absolute
 * timestamp, text, path, name or raw error ever reaches the output.
 */
import { createHmac, randomBytes } from "node:crypto";
import { HUNK_PASS_FANOUT_LIMIT } from "@unvibe/shared";
import type {
  Job,
  ReviewSnapshot,
  StatsExport,
  StatsFailureClass,
  StatsJob,
  StatsProvider,
  StatsRead,
  StatsReview,
} from "@unvibe/shared";
import { isDocumentReview } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";
import { JobStore } from "../jobs/store.js";

const JOB_KINDS = new Set([
  "reader", "critic", "hunk-pass", "concept", "ask", "depth", "examples",
  "diagram", "go-deeper", "update-pass", "summarize",
  "plotline-assign", "consolidate", "persona",
]);
const JOB_STATES = new Set(["queued", "running", "backing-off", "done", "error", "cancelled"]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type Hasher = (kind: string, value: string) => string;

function makeHasher(): Hasher {
  const salt = randomBytes(32);
  return (kind, value) =>
    createHmac("sha256", salt).update(`${kind}:${value}`).digest("hex").slice(0, 16);
}

function providerOf(v: string | undefined): StatsProvider {
  return v === "claude" || v === "codex" || v === "pi" ? v : "other";
}

function safeToken(v: string | undefined, fallback: string): string {
  return v !== undefined && SAFE_TOKEN.test(v) ? v : fallback;
}

export function failureClassOf(error: string | undefined | null): StatsFailureClass | null {
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
 * numbers and hashes leave this function — raw strings never do.
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

function extractReads(
  job: Job,
  diffPaths: Set<string>,
  hunkLines: Map<string, { path: string; lines: number | null }>,
  hash: Hasher,
): StatsRead[] {
  const calls = [
    ...(job.tools ?? []),
    ...(job.turnRecords ?? []).flatMap((t) => t.tools ?? []),
  ];
  const reads: StatsRead[] = [];
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
              file: hash("file", parsed.filePath),
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
      reads.push({ file: hash("file", filePath), lines, insideDiff });
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

export function buildStatsExport(snapshots: ReviewSnapshot[], jobs: Job[]): StatsExport {
  const hash = makeHasher();
  const byReview = new Map<string, ReviewSnapshot>();
  for (const s of snapshots) byReview.set(s.review.id, s);

  const reviews: StatsReview[] = snapshots.map((s) => {
    const files = s.files ?? [];
    let hunks = 0, added = 0, removed = 0;
    for (const f of files) for (const h of f.hunks ?? []) { hunks++; added += h.added || 0; removed += h.removed || 0; }
    const threads = s.annotations ?? [];
    // Issue #356: hunks with no stored summary because the hunk-pass
    // fan-out cap left them out (0 when the review fits the cap —
    // missing summaries there are pending work, not cap skips).
    const summarized = new Set((s.hunkStates ?? []).filter((st) => st.summary !== undefined).map((st) => st.contentHash));
    const missingSummaries = files.reduce(
      (n, f) => n + (f.hunks ?? []).filter((h) => !summarized.has(h.contentHash)).length,
      0,
    );
    return {
      id: hash("review", s.review.id),
      kind: isDocumentReview(s) ? "document" : "change",
      files: files.length,
      hunks,
      skippedHunkSummaries: hunks > HUNK_PASS_FANOUT_LIMIT ? missingSummaries : 0,
      addedLines: added, removedLines: removed,
      guidePages: (s.pages ?? []).length,
      guideCards: (s.pages ?? []).reduce((n, p) => n + (p.cards ?? []).length, 0),
      threads: threads.length,
      replies: threads.reduce((n, t) => n + (t.replies ?? []).length, 0),
      outboxThreads: threads.filter((t) => t.post && !t.postedAt).length,
      versions: (s.review.versions ?? []).length || 1,
      jobs: jobs.filter((j) => j.reviewId === s.review.id).length,
    };
  });

  const outJobs: StatsJob[] = jobs.map((job) => {
    const snap = job.reviewId ? byReview.get(job.reviewId) : undefined;
    const diffPaths = new Set((snap?.files ?? []).map((f) => f.path));
    // Hunk id → file + line span, so `get_hunk` reads record line ranges.
    const hunkLines = new Map<string, { path: string; lines: number | null }>();
    for (const f of snap?.files ?? []) {
      for (const h of f.hunks ?? []) hunkLines.set(h.contentHash, { path: f.path, lines: hunkLineSpan(h) });
    }
    const toolCounts = new Map<string, number>();
    const calls = [...(job.tools ?? []), ...(job.turnRecords ?? []).flatMap((t) => t.tools ?? [])];
    for (const c of calls) {
      const name = safeToken(c.name, "other");
      toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
    }
    const turns = job.turnRecords?.length ?? job.turns?.length ?? 0;
    return {
      id: hash("job", job.id),
      review: job.reviewId ? hash("review", job.reviewId) : null,
      session: job.sessionId ? hash("session", job.sessionId) : null,
      kind: JOB_KINDS.has(job.kind) ? job.kind : "other",
      state: JOB_STATES.has(job.state) ? job.state : "other",
      provider: providerOf(job.provider),
      model: safeToken(job.model, "other"),
      effort: job.effort === "" ? "" : safeToken(job.effort, "other"),
      access: job.accessMode === "full" || job.accessMode === "lockdown" ? job.accessMode : null,
      tokens: job.usage
        ? { input: job.usage.inputTokens, cachedRead: job.usage.cachedReadTokens, cachedWrite: job.usage.cachedWriteTokens, output: job.usage.outputTokens }
        : null,
      toolCounts: [...toolCounts.entries()].map(([tool, count]) => ({ tool, count })),
      reads: extractReads(job, diffPaths, hunkLines, hash),
      turns,
      repairTurns: (job.turnRecords ?? []).filter((t) => /repair/i.test(t.label)).length,
      attempts: job.attempts ?? job.attemptTimings?.length ?? 0,
      failure: job.state === "error" || job.state === "cancelled" ? failureClassOf(job.error) ?? "other" : null,
      queuedMs: diffMs(job.queuedAt, job.startedAt),
      durationMs: diffMs(job.startedAt, job.finishedAt),
      offsetMs: snap && typeof job.startedAt === "number" ? diffMs(snap.review.createdAt, job.startedAt) : null,
    };
  });

  const tokens = { input: 0, cachedRead: 0, cachedWrite: 0, output: 0 };
  for (const j of outJobs) if (j.tokens) { tokens.input += j.tokens.input; tokens.cachedRead += j.tokens.cachedRead; tokens.cachedWrite += j.tokens.cachedWrite; tokens.output += j.tokens.output; }
  return {
    schemaVersion: 2,
    reviews,
    jobs: outJobs,
    totals: {
      reviews: reviews.length,
      jobs: outJobs.length,
      failures: outJobs.filter((j) => j.failure !== null).length,
      repairs: outJobs.reduce((n, j) => n + j.repairTurns, 0),
      tokens,
    },
  };
}

/** Read snapshots + jobs with SELECTs only; never writes. */
export function buildStatsExportFromDb(db: DatabaseSync): StatsExport {
  let snapshots: ReviewSnapshot[] = [];
  let jobs: Job[] = [];
  try {
    const rows = db.prepare("SELECT snapshot FROM review_snapshots").all() as { snapshot: string }[];
    snapshots = rows.map((r) => JSON.parse(r.snapshot) as ReviewSnapshot);
  } catch { /* no table yet: empty export */ }
  try {
    jobs = new JobStore(db).listAll();
  } catch { /* no jobs table yet */ }
  if (jobs.length === 0) jobs = snapshots.flatMap((s) => s.jobs ?? []);
  return buildStatsExport(snapshots, jobs);
}
