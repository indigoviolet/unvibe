/*global console process */
// SPIKE(#114): tables for docs/latency-investigation.md from all runs.
//   node spikes/latency/summary.mjs > spikes/latency/summary.md
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABELS = ["claude-1", "claude-2", "claude-forkmeta-1", "claude-effort-1", "codex-1", "codex-forkmeta-1"];
const runs = Object.fromEntries(
  LABELS.map((l) => [l, JSON.parse(execFileSync(process.execPath, [path.join(HERE, "analyze.mjs"), l, "--json"], { maxBuffer: 1 << 28 }).toString())]),
);
const s = (ms) => (ms === null || ms === undefined || Number.isNaN(ms) ? "–" : (ms / 1000).toFixed(1));
const stat = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length === 0) return "–";
  const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return `${s(med)} (${s(v[0])}–${s(v[v.length - 1])}, n=${v.length})`;
};

console.log("## Open a PR (seconds from the click; one open per run)\n");
console.log("| run | load | ingest ready | first card | reader done | base built | first hunk summary | hunk pass done | first finding | critics done | all idle |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const l of LABELS) {
  const f = runs[l].flows.find((x) => x.name.startsWith("open"));
  const r = f.rel;
  console.log(`| ${l} | ${f.load[0]} | ${s(r.ingestReady)} | ${s(r.firstCard)} | ${s(r.readerDone)} | ${s(r.baseDone)} | ${s(r.firstHunkSummary)} | ${s(r.hunkPassDone)} | ${s(r.firstFinding)} | ${s(r.criticDone)} | ${s(r.allIdle)} |`);
}

console.log("\n## Open: jobs (seconds)\n");
console.log("| run | job | queue wait | session set-up | first text | turn(s) | turns | tool calls (tool time) | total | uncached in | cache read | cache write | out |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const l of LABELS) {
  const f = runs[l].flows.find((x) => x.name.startsWith("open"));
  const hp = f.jobs.filter((j) => j.kind === "hunk-pass");
  for (const j of f.jobs.filter((x) => x.kind !== "hunk-pass" && x.kind !== "explain")) {
    console.log(`| ${l} | ${j.kind} | ${s(j.queueWait)} | ${s(j.setup)} | ${s(j.ttft)} | ${s(j.turnMs)} | ${j.turns} | ${j.tools} (${s(j.toolMs)}) | ${s(j.total)} | ${j.usage.input} | ${j.usage.cacheRead} | ${j.usage.cacheWrite} | ${j.usage.output} |`);
  }
  console.log(`| ${l} | hunk-pass ×${hp.length} | ${stat(hp.map((j) => j.queueWait))} | ${stat(hp.map((j) => j.setup))} | ${stat(hp.map((j) => j.ttft))} | ${stat(hp.map((j) => j.turnMs))} | 1 | 0 | ${stat(hp.map((j) => j.total - j.queueWait))} run | ${Math.round(hp.reduce((n, j) => n + j.usage.input, 0) / hp.length)} | ${Math.round(hp.reduce((n, j) => n + j.usage.cacheRead, 0) / hp.length)} | ${Math.round(hp.reduce((n, j) => n + j.usage.cacheWrite, 0) / hp.length)} | ${Math.round(hp.reduce((n, j) => n + j.usage.output, 0) / hp.length)} |`);
}

console.log("\n## Ingest commands (claude-1; the others are within 0.3 s)\n");
console.log("| at (s) | command | ms |\n|---|---|---|");
for (const c of runs["claude-1"].flows[0].cmds.filter((c) => c.at > 0 && c.at < 9000)) console.log(`| ${s(c.at - c.ms)} | \`${c.cmd}\` | ${c.ms} |`);

function actionRows(title, pick, labels) {
  console.log(`\n## ${title}\n`);
  console.log("| run | flow | load | click → done | of which: wait before enqueue (base build) | queue | fork/session set-up | first text (in turn) | turn | grace | after turn | uncached in | cache read | cache write | out | visible text tokens (≈) |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const l of labels) {
    for (const f of runs[l].flows.filter(pick)) {
      if (f.rel?.done === null || f.rel?.done === undefined || f.rel.done < 100) continue;
      const j = f.jobs.find((x) => x.total !== null && x.turns > 0);
      const other = f.otherTurns.filter((t) => t.usage && t.ms && t.promptChars < 6000)[0];
      const pre = f.preEnqueueBase[0]?.ms ?? 0;
      if (j) {
        console.log(`| ${l} | ${f.name} | ${f.load[0]} | **${s(f.rel.done)}** | ${s(pre)} | ${s(j.queueWait)} | ${s(j.setup)} | ${s(j.ttft)} | ${s(j.turnMs)} | ${s(j.grace)} | ${s(j.post)} | ${j.usage.input} | ${j.usage.cacheRead} | ${j.usage.cacheWrite} | ${j.usage.output} | ${Math.round(j.textChars / 3.6)} |`);
      } else if (other) {
        console.log(`| ${l} | ${f.name} | ${f.load[0]} | **${s(f.rel.done)}** | – | – | ${s(other.at)} (HTTP ${s(f.rel.httpResponse)}) | ${s(other.ttft)} | ${s(other.ms)} | 0.3 | – | ${other.usage.input} | ${other.usage.cacheRead} | ${other.usage.cacheWrite} | ${other.usage.output} | – |`);
      }
    }
  }
}
const base = ["claude-1", "claude-2", "codex-1"];
actionRows("Explain (baseline)", (f) => f.name.startsWith("explain"), base);
actionRows("Explain with the fork experiment (UNVIBE_SPIKE_FORK_META=1)", (f) => f.name.startsWith("explain") && !f.name.includes("effort"), ["claude-forkmeta-1", "codex-forkmeta-1"]);
actionRows("Explain and Ask by reasoning effort (Claude, fork experiment on)", (f) => f.name.includes("effort"), ["claude-effort-1"]);
actionRows("Ask and reply", (f) => f.name.startsWith("ask") || f.name.startsWith("reply"), [...base, "claude-forkmeta-1"]);
actionRows("Generate (Go deeper) and depth +", (f) => f.name.startsWith("generate") || f.name.startsWith("depth"), [...base, "claude-forkmeta-1"]);
actionRows("Hunk summary (one hunk)", (f) => f.name.startsWith("hunk summary"), [...base, "claude-forkmeta-1"]);

console.log("\n## Fold all (8 hunks, cap 4 per provider)\n");
console.log("| run | load | first summary | half | all | queue wait of the second wave | per job: set-up | first text | turn |\n|---|---|---|---|---|---|---|---|---|");
for (const l of [...base, "claude-forkmeta-1"]) {
  const f = runs[l].flows.find((x) => x.name.startsWith("fold all"));
  if (!f) continue;
  console.log(`| ${l} | ${f.load[0]} | ${s(f.rel.firstSummary)} | ${s(f.rel.halfSummaries)} | ${s(f.rel.done)} | ${stat(f.jobs.map((j) => j.queueWait).filter((q) => q > 500))} | ${stat(f.jobs.map((j) => j.setup))} | ${stat(f.jobs.map((j) => j.ttft))} | ${stat(f.jobs.map((j) => j.turnMs))} |`);
}

console.log("\n## Explain: summary by condition (job only, excludes the base build)\n");
console.log("| condition | click → done | job total | first text | turn | cache read | cache write + uncached |\n|---|---|---|---|---|---|---|");
const cond = (name, labels, pick) => {
  const js = [];
  const done = [];
  for (const l of labels) for (const f of runs[l].flows.filter(pick)) {
    const j = f.jobs.find((x) => x.kind === "explain" && x.turns > 0);
    if (!j || !f.rel?.done || f.rel.done < 100) continue;
    js.push(j);
    done.push(f.rel.done);
  }
  const avg = (k) => Math.round(js.reduce((n, j) => n + k(j), 0) / Math.max(1, js.length));
  console.log(`| ${name} | ${stat(done)} | ${stat(js.map((j) => j.total))} | ${stat(js.map((j) => j.ttft))} | ${stat(js.map((j) => j.turnMs))} | ${avg((j) => j.usage.cacheRead)} | ${avg((j) => j.usage.cacheWrite + j.usage.input)} |`);
};
const ex = (f) => f.name.startsWith("explain") && !f.name.includes("effort");
cond("Claude, as shipped", ["claude-1", "claude-2"], ex);
cond("Claude, fork experiment", ["claude-forkmeta-1"], ex);
cond("Claude, fork experiment + effort high (set explicitly)", ["claude-effort-1"], (f) => f.name.startsWith("explain effort=high"));
cond("Claude, fork experiment + effort medium", ["claude-effort-1"], (f) => f.name.startsWith("explain effort=medium"));
cond("Claude, fork experiment + effort low", ["claude-effort-1"], (f) => f.name.startsWith("explain effort=low"));
cond("Codex, as shipped", ["codex-1"], ex);
cond("Codex, fork experiment", ["codex-forkmeta-1"], ex);

console.log("\n## Base builds (every one in every run)\n");
console.log("| run | pack chars | seconds |\n|---|---|---|");
for (const l of LABELS) for (const b of runs[l].baseBuilds) console.log(`| ${l} | ${b.packChars} | ${s(b.ms)} |`);

console.log("\n## Tokens per run\n");
console.log("| run | model | turns | uncached input | cache read | cache write | output | est. $ |\n|---|---|---|---|---|---|---|---|");
// $/MTok: input, cache read, cache write, output. Opus 5.5 and Haiku 5.5 from the
// Anthropic price table (cache write 1.25x input; Haiku cache read assumed 0.1x).
// gpt-6.1-sol: $2/$10 from third-party aggregators, cached input priced as
// uncached (rate not found), so it is an upper bound.
const PRICE = { "claude/opus": [4, 0.2, 5, 20], "claude/haiku": [0.1, 0.01, 0.125, 0.5], "codex/gpt-6.1-sol": [2, 2, 2, 10] };
let grand = 0;
for (const l of LABELS) for (const [m, b] of Object.entries(runs[l].totals.byModel)) {
  const p = PRICE[m];
  const usd = p ? (b.input * p[0] + b.cacheRead * p[1] + b.cacheWrite * p[2] + b.output * p[3]) / 1e6 : null;
  if (usd) grand += usd;
  console.log(`| ${l} | ${m} | ${b.turns} | ${b.input} | ${b.cacheRead} | ${b.cacheWrite} | ${b.output} | ${usd === null ? "?" : usd.toFixed(2)} |`);
}
console.log(`\nTotal: $${grand.toFixed(2)}`);

console.log("\n## Our own code per flow (claude-1)\n");
console.log("| flow | snapshot reads | ms | snapshot writes | ms | snapshot bytes |\n|---|---|---|---|---|---|");
for (const f of runs["claude-1"].flows) console.log(`| ${f.name} | ${f.store.gets} | ${f.store.getMs} | ${f.store.mutates} | ${f.store.mutateMs} | ${f.store.maxBytes} |`);
