/*global console performance process */
// SPIKE(#114): cost of ReviewStore.getSnapshot / mutate as the snapshot grows.
// Synthetic: mirrors packages/service/src/state/store.ts (SELECT + JSON.parse,
// immer produceWithPatches, JSON.stringify + UPDATE in a transaction) on a
// snapshot scaled up from the real one of urllib3#5020. No agents, no tokens.
//   node spikes/latency/bench-store.mjs
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { enablePatches, produceWithPatches } from "immer";

enablePatches();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-bench-"));
const db = new DatabaseSync(path.join(dir, "b.db"));
db.exec("PRAGMA journal_mode=WAL; CREATE TABLE review_snapshots (review_id TEXT PRIMARY KEY, rev INTEGER, snapshot TEXT, updated_at INTEGER)");

function synth(files, hunksPerFile, linesPerHunk) {
  const mkLine = (i) => ({ kind: i % 3 === 0 ? "add" : "ctx", text: `    value_${i} = compute_something(arg_${i}, other_${i})  # line`, oldLine: i, newLine: i });
  return {
    review: { id: "rv", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "a", mergeBaseSha: "b", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: Array.from({ length: files }, (_, f) => ({
      fileKey: `src-file-${f}.py`,
      path: `src/pkg/file_${f}.py`,
      hunks: Array.from({ length: hunksPerFile }, (_, h) => ({
        contentHash: `${f}-${h}`.padEnd(40, "0"),
        header: "@@ -1,40 +1,44 @@",
        added: 10,
        removed: 4,
        newStart: h * 100,
        newEnd: h * 100 + linesPerHunk,
        lines: Array.from({ length: linesPerHunk }, (_, i) => mkLine(i)),
      })),
    })),
    pages: [{ id: "root", kind: "root", title: "Guide", cards: Array.from({ length: 6 }, (_, c) => ({ id: `c${c}`, blocks: Array.from({ length: 5 }, (_, b) => ({ type: "paragraph", id: `b${b}`, text: { standard: "x".repeat(500) }, citations: [] })) })) }],
    annotations: [],
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    usageTotals: { inputTokens: 0, cachedTokens: 0, outputTokens: 0 },
    rev: 1,
  };
}

const rows = [];
for (const [files, hunks, lines] of [[4, 2, 30], [40, 3, 40], [150, 3, 40], [400, 4, 40]]) {
  const snap = synth(files, hunks, lines);
  const text = JSON.stringify(snap);
  db.prepare("INSERT OR REPLACE INTO review_snapshots VALUES ('rv', 1, ?, 0)").run(text);
  const get = () => {
    const row = db.prepare("SELECT rev, snapshot FROM review_snapshots WHERE review_id = ?").get("rv");
    return JSON.parse(row.snapshot);
  };
  const mutate = () => {
    const before = get();
    const [next] = produceWithPatches(before, (d) => {
      d.usageTotals.inputTokens += 1;
    });
    db.exec("BEGIN");
    db.prepare("UPDATE review_snapshots SET rev = rev + 1, snapshot = ?, updated_at = 0 WHERE review_id = 'rv'").run(JSON.stringify(next));
    db.exec("COMMIT");
  };
  const time = (fn, n) => {
    for (let i = 0; i < 3; i++) fn();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) fn();
    return (performance.now() - t0) / n;
  };
  const n = text.length > 2e6 ? 10 : 40;
  rows.push({ files, hunks: files * hunks, snapshotKB: Math.round(text.length / 1024), getMs: +time(get, n).toFixed(2), mutateMs: +time(mutate, n).toFixed(2) });
}
console.table(rows);
// One Explain = 16 gets + 8 mutates (measured live); one hunk-pass job = 4 gets + 3 mutates.
for (const r of rows) console.log(`${r.hunks} hunks (${r.snapshotKB} KB): one Explain ≈ ${Math.round(16 * r.getMs + 8 * r.mutateMs)} ms of blocked event loop; the hunk pass ≈ ${Math.round((r.hunks * (4 * r.getMs + 3 * r.mutateMs)) / 1000)} s in total`);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
