#!/usr/bin/env node
/*global console process */
/**
 * `mise run stats:summary -- <file>` (#366): readable summary of one
 * anonymized trace export (OTLP JSON, `GET /api/traces/export`). Reads
 * only the file named on the command line — nothing else.
 *
 * Job spans (`job <kind>`) carry every former stats job field; review
 * spans (`ingest` / `refresh`) carry the review size buckets. Attempts
 * of one job share its hashed `job.id`, so repeats collapse to the last
 * attempt; reviews merge last-wins. `offsetMs` derives from the
 * waterfall (job start minus the review's first span start).
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: mise run stats:summary -- <unvibe-traces.json>");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
const scopes = data?.resourceSpans;
if (!Array.isArray(scopes)) {
  console.error("not a trace export (expected OTLP JSON with resourceSpans)");
  process.exit(2);
}
const spans = scopes.flatMap((r) => (r.scopeSpans ?? []).flatMap((s) => s.spans ?? []));

/** Attribute list → plain map (ints/doubles as numbers, rest as strings). */
function attrsOf(span) {
  const m = new Map();
  for (const a of span.attributes ?? []) {
    const v = a.value ?? {};
    if (typeof v.intValue === "string" && /^-?\d+$/.test(v.intValue)) m.set(a.key, Number(v.intValue));
    else if (typeof v.doubleValue === "number" && Number.isFinite(v.doubleValue)) m.set(a.key, v.doubleValue);
    else if (typeof v.stringValue === "string") m.set(a.key, v.stringValue);
  }
  return m;
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === "string" ? v : null);
const nanos = (v) => {
  if (typeof v !== "string" || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// One row per job: attempts share a hashed id, the last attempt wins.
const jobSpans = new Map();
for (const span of spans) {
  const m = attrsOf(span);
  const id = str(m.get("job.id"));
  if (!id || !str(m.get("job.kind"))) continue;
  const end = nanos(span.endTimeUnixNano) ?? -1;
  const prev = jobSpans.get(id);
  if (!prev || end >= prev.end) jobSpans.set(id, { span, m, end });
}

// Review ids (ingest/refresh spans) with their earliest start, so job
// offsets derive from the waterfall. Reviews without a span still count
// via their job spans (see totals below).
const reviewIds = new Set();
const reviewFirstStart = new Map();
for (const span of spans) {
  const m = attrsOf(span);
  if (span.name !== "ingest" && span.name !== "refresh") continue;
  const id = str(m.get("review"));
  if (!id) continue;
  reviewIds.add(id);
  const start = nanos(span.startTimeUnixNano);
  if (start !== null && (!reviewFirstStart.has(id) || start < reviewFirstStart.get(id))) {
    reviewFirstStart.set(id, start);
  }
}

const jobs = [...jobSpans.values()].map(({ span, m }) => {
  const toolCounts = [];
  for (const [k, v] of m) {
    if (k.startsWith("job.tool.") && typeof v === "number") {
      toolCounts.push({ tool: k.slice("job.tool.".length), count: v });
    }
  }
  toolCounts.sort((a, b) => (a.tool < b.tool ? -1 : 1));
  const readSlots = new Map();
  for (const [k, v] of m) {
    const slot = /^job\.read\.(\d+)\.(file|lines|inside)$/.exec(k);
    if (slot) {
      const entry = readSlots.get(slot[1]) ?? {};
      entry[slot[2]] = v;
      readSlots.set(slot[1], entry);
    }
  }
  const reads = [...readSlots.values()]
    .filter((r) => typeof r.file === "string")
    .map((r) => ({
      file: r.file,
      lines: typeof r.lines === "number" ? r.lines : null,
      insideDiff: r.inside === "true",
    }));
  const tokens =
    num(m.get("job.tokens.input")) !== null
      ? {
          input: num(m.get("job.tokens.input")) ?? 0,
          cachedRead: num(m.get("job.tokens.cached_read")) ?? 0,
          cachedWrite: num(m.get("job.tokens.cached_write")) ?? 0,
          output: num(m.get("job.tokens.output")) ?? 0,
        }
      : null;
  const start = nanos(span.startTimeUnixNano);
  const end = nanos(span.endTimeUnixNano);
  const review = str(m.get("job.review"));
  let offsetMs = null;
  if (start !== null && review && reviewFirstStart.has(review)) {
    const d = Math.round((start - reviewFirstStart.get(review)) / 1e6);
    if (Number.isFinite(d) && d >= 0) offsetMs = d;
  }
  return {
    id: str(m.get("job.id")),
    review,
    session: str(m.get("job.session")),
    kind: str(m.get("job.kind")) ?? "other",
    state: str(m.get("job.state")) ?? "other",
    provider: str(m.get("job.provider")) ?? "other",
    model: str(m.get("job.model")) ?? "other",
    effort: typeof m.get("job.effort") === "string" ? m.get("job.effort") : "other",
    access: str(m.get("job.access")),
    tokens,
    toolCounts,
    reads,
    turns: num(m.get("job.turns")) ?? 0,
    repairTurns: num(m.get("job.repairs")) ?? 0,
    attempts: num(m.get("job.attempts")) ?? num(m.get("job.attempt")) ?? 0,
    failure: str(m.get("job.failure")),
    queuedMs: num(m.get("job.queued_ms")),
    durationMs:
      num(m.get("job.duration_ms")) ??
      (start !== null && end !== null && end >= start ? Math.round((end - start) / 1e6) : null),
    offsetMs,
  };
});

const tokens = { input: 0, cachedRead: 0, cachedWrite: 0, output: 0 };
for (const j of jobs) {
  if (j.tokens) {
    tokens.input += j.tokens.input;
    tokens.cachedRead += j.tokens.cachedRead;
    tokens.cachedWrite += j.tokens.cachedWrite;
    tokens.output += j.tokens.output;
  }
}
// Reviews without an ingest/refresh span still count via their job spans.
for (const j of jobs) if (j.review) reviewIds.add(j.review);
const totals = {
  reviews: reviewIds.size,
  jobs: jobs.length,
  failures: jobs.filter((j) => j.failure !== null).length,
  repairs: jobs.reduce((n, j) => n + j.repairTurns, 0),
  tokens,
};

const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${Math.round(v)}${unit}`);

console.log(`Reviews: ${totals.reviews}  Jobs: ${totals.jobs}`);
console.log(
  `Tokens: input ${totals.tokens.input}, cached read ${totals.tokens.cachedRead}, ` +
    `cached write ${totals.tokens.cachedWrite}, output ${totals.tokens.output}`,
);

const by = (key) => {
  const m = new Map();
  for (const j of jobs) m.set(String(j[key]), (m.get(String(j[key])) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};
console.log("\nJobs by kind:");
for (const [k, n] of by("kind")) console.log(`  ${k}: ${n}`);
console.log("\nJobs by provider:");
for (const [k, n] of by("provider")) console.log(`  ${k}: ${n}`);

// Re-reads: same file hash read more than once within the export.
const readCounts = new Map();
let totalReads = 0, outsideReads = 0;
for (const j of jobs) for (const r of j.reads ?? []) {
  totalReads++;
  if (!r.insideDiff) outsideReads++;
  readCounts.set(r.file, (readCounts.get(r.file) ?? 0) + 1);
}
const rereadFiles = [...readCounts.values()].filter((n) => n > 1).length;
console.log(`\nReads: ${totalReads} (${outsideReads} outside the diff)`);
console.log(`Re-read rate: ${rereadFiles}/${readCounts.size} files read more than once (${pct(rereadFiles, readCounts.size)})`);

const asks = jobs.filter((j) => j.kind === "ask");
const askOutside = asks.reduce((n, j) => n + (j.reads ?? []).filter((r) => !r.insideDiff).length, 0);
console.log(`Reads outside the diff per ask: ${asks.length ? (askOutside / asks.length).toFixed(2) : "—"} (${askOutside}/${asks.length} asks)`);

console.log("\nPer kind (avg duration, avg output tokens):");
const kinds = [...new Set(jobs.map((j) => j.kind))].sort();
for (const k of kinds) {
  const ks = jobs.filter((j) => j.kind === k);
  console.log(
    `  ${k}: n=${ks.length}, duration ${fmt(avg(ks.map((j) => j.durationMs).filter((v) => v !== null)), " ms")}, ` +
      `output ${fmt(avg(ks.map((j) => j.tokens?.output).filter((v) => typeof v === "number")))}`,
  );
}

const failures = jobs.filter((j) => j.failure !== null);
const repairJobs = jobs.filter((j) => j.repairTurns > 0);
console.log(`\nFailure rate: ${pct(failures.length, jobs.length)} (${failures.length}/${jobs.length})`);
console.log(`Repair rate: ${pct(repairJobs.length, jobs.length)} (${repairJobs.length} jobs with repair turns)`);
if (failures.length) {
  console.log("Failures by class:");
  const m = new Map();
  for (const j of failures) m.set(j.failure, (m.get(j.failure) ?? 0) + 1);
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
}
