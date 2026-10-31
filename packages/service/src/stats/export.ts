/**
 * Anonymized stats exporter (issue #323). Allowlist by construction:
 * only the `StatsExport` fields are ever written. The salt is random
 * per call, kept in memory, and never returned or persisted. All times
 * are relative (durations / offsets from review creation); no absolute
 * timestamp, text, path, name or raw error ever reaches the output.
 */
import { createHmac, randomBytes } from "node:crypto";
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
  "diagram", "go-deeper", "second-opinion", "update-pass", "summarize",
  "plotline-assign", "consolidate",
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

function extractReads(job: Job, diffPaths: Set<string>, hash: Hasher): StatsRead[] {
  const calls = [
    ...(job.tools ?? []),
    ...(job.turnRecords ?? []).flatMap((t) => t.tools ?? []),
  ];
  const reads: StatsRead[] = [];
  for (const call of calls) {
    if (!READ_TOOL.test(call.name) && !call.detail) continue;
    const detail = call.detail ?? "";
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
    return {
      id: hash("review", s.review.id),
      kind: isDocumentReview(s) ? "document" : "change",
      files: files.length,
      hunks, addedLines: added, removedLines: removed,
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
      reads: extractReads(job, diffPaths, hash),
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
    schemaVersion: 1,
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
