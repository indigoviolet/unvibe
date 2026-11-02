#!/usr/bin/env node
/*global console process */
/**
 * `mise run stats:summary -- <file>` (#323): readable summary of one
 * anonymized stats export. Reads only the file named on the command
 * line — nothing else.
 */
import fs from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: mise run stats:summary -- <unvibe-stats.json>");
  process.exit(2);
}
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (data.schemaVersion !== 1 || !Array.isArray(data.reviews) || !Array.isArray(data.jobs)) {
  console.error("not a v1 stats export");
  process.exit(2);
}
const jobs = data.jobs;
const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—");
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (v, unit = "") => (v === null || v === undefined ? "—" : `${Math.round(v)}${unit}`);

console.log(`Reviews: ${data.totals.reviews}  Jobs: ${data.totals.jobs}`);
console.log(
  `Tokens: input ${data.totals.tokens.input}, cached read ${data.totals.tokens.cachedRead}, ` +
    `cached write ${data.totals.tokens.cachedWrite}, output ${data.totals.tokens.output}`,
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
