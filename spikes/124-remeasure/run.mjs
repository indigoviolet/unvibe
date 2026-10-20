/*global console process setTimeout clearTimeout fetch performance */
// SPIKE(#124) re-measure harness. Spends real Codex tokens (owner-authorized,
// ~$1 budget). Run ONLY via the sanctioned live path:
//
//   mise run build
//   UNVIBE_ALLOW_LIVE_AGENT=1 node spikes/124-remeasure/run.mjs --label codex-1 [--opens 1] [--port 4624]
//
// Starts the BUILT service on its own port with a temp data dir, sets
// main+small to Codex, opens the bundled demo fixture (no GitHub content,
// no gh), waits for the reader, then drives Explain/Ask actions the way
// the web app does (one HTTP call per click, snapshot polled over HTTP).
//
// What it records (counts/timings/kinds only — never guide text, citation
// targets, or prompt contents):
// - per-job usage split (uncached input / cache read / cache write /
//   output), per-turn timings (Job.turns, #194), state, kind;
// - the reader job: whether a "repair" turn ran, its duration, the
//   repair prompt's length vs the first prompt's length (does the repair
//   re-send the guide?), and the failed citations reduced to
//   kind+reason-category counts in memory (targets are parsed and dropped);
// - the base pack size from GET /api/reviews/:id/shared-context.
// Raw output: spikes/124-remeasure/raw/<label>/summary.json
//
// Cost guard: an upper-bound estimate (all input at the old spike's
// gpt-6.1-sol list price $2/M in, $10/M out; cached input priced as
// uncached) is tracked over every job the service reports; the harness
// kills the service it started and exits when the estimate passes
// --budget-usd (default 1.30).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}
if (process.env.UNVIBE_ALLOW_LIVE_AGENT !== "1") {
  console.error("refusing to spend tokens: set UNVIBE_ALLOW_LIVE_AGENT=1 (the test:live:* sanction)");
  process.exit(2);
}

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const PORT = Number(arg("port", "4624"));
const LABEL = arg("label", `codex-${Date.now()}`);
const OPENS = Number(arg("opens", "1"));
const MODEL = arg("model", "gpt-5.6-terra");
const BUDGET = Number(arg("budget-usd", "1.30"));
const OUT = path.join(ROOT, "spikes", "124-remeasure", "raw", LABEL);
fs.mkdirSync(OUT, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-124-"));

const PRICE_IN = 2 / 1e6; // $/token, upper bound (see header)
const PRICE_OUT = 10 / 1e6;
const estCost = (u) =>
  !u ? 0 : (u.inputTokens + u.cachedReadTokens + u.cachedWriteTokens) * PRICE_IN + u.outputTokens * PRICE_OUT;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
let token = "";
async function api(method, p, body) {
  const t0 = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* leave null */ }
  return { code: res.status, json, raw: text, ms: Math.round(performance.now() - t0) };
}

const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
const rootOf = (s) => (s.pages ?? []).find((p) => p.id === "root");
const stage = (s, name) => s.pipeline?.stages?.[name];

/** A quotable paragraph from the guide (guide text itself is never stored). */
function pickQuote(snapshot, skip = 0) {
  const out = [];
  for (const card of rootOf(snapshot)?.cards ?? []) {
    for (const b of card.blocks ?? []) {
      if (b.type !== "paragraph") continue;
      const run = String(b.text?.standard ?? "").split(/<[^>]*>/).map((x) => x.trim()).filter((x) => x.split(" ").length >= 4)[0];
      if (!run) continue;
      out.push({ cardId: card.id, blockId: b.id, quote: run.split(" ").slice(0, 6).join(" ") });
    }
  }
  return out[skip % Math.max(1, out.length)] ?? null;
}

/** Reduce one failed-citation line to kind + reason category. Target dropped. */
function classifyRepairLine(line) {
  const m = line.replace(/^-\s*/, "").match(/^([a-z]+):/);
  const kind = m ? m[1] : "other";
  let cat = "other";
  if (/outside any hunk/.test(line)) cat = "diff range outside any hunk";
  else if (/span more than one hunk/.test(line)) cat = "diff range spans hunks";
  else if (/spill past hunk/.test(line)) cat = "repaired-spill (should not be in repair list)";
  else if (/unknown file/.test(line)) cat = "unknown file";
  else if (/outside .* \(1–/.test(line)) cat = "code range outside file";
  else if (/unknown file for code/.test(line)) cat = "code unknown file";
  else if (/unknown hunk/.test(line)) cat = "unknown hunk id";
  else if (/unknown description paragraph/.test(line)) cat = "unknown desc paragraph";
  else if (/unknown card/.test(line)) cat = "unknown card";
  else if (/unknown block/.test(line)) cat = "unknown block";
  else if (/unknown page/.test(line)) cat = "unknown page";
  else if (/unknown annotation/.test(line)) cat = "unknown annotation";
  else if (/not a known ID|not a (diff|code|desc|card|page|concept|annotation|hunk) ID/.test(line)) cat = "malformed id";
  else if (/anchor/.test(line)) cat = "anchor problem";
  return `${kind}: ${cat}`;
}

const summary = {
  label: LABEL, model: { provider: "codex", model: MODEL }, port: PORT,
  startedAt: new Date().toISOString(), opens: [], totals: null, budgetUsd: BUDGET, aborted: null,
};
let spent = 0;
function writeSummary() {
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
}

async function jobsOf(reviewId) {
  const r = await api("GET", `/api/jobs?review=${reviewId}`);
  return r.json?.jobs ?? r.json ?? [];
}
function trackCost(jobs) {
  spent = jobs.reduce((n, j) => n + estCost(j.usage), 0);
  return spent;
}

async function untilSnapshot(reviewId, pred, timeoutMs, label) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const s = (await api("GET", `/api/reviews/${reviewId}`)).json;
    if (s && pred(s)) return s;
    const jobs = await jobsOf(reviewId);
    if (trackCost(jobs) > BUDGET) throw new Error(`BUDGET-ABORT est $${spent.toFixed(3)} > $${BUDGET} during ${label}`);
    await sleep(1500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function waitJob(reviewId, jobId, timeoutMs = 5 * 60_000) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const jobs = await jobsOf(reviewId);
    trackCost(jobs);
    if (spent > BUDGET) throw new Error(`BUDGET-ABORT est $${spent.toFixed(3)} > $${BUDGET}`);
    const j = jobs.find((x) => x.id === jobId);
    if (j && ["done", "error", "cancelled"].includes(j.state)) return j;
    await sleep(1500);
  }
  throw new Error(`timeout waiting for job ${jobId}`);
}

const sanitizeJob = (j) => ({
  id: j.id, kind: j.kind, state: j.state, provider: j.provider, model: j.model,
  usage: j.usage ?? null, cacheHitRate: j.cacheHitRate ?? null,
  queuedAt: j.queuedAt, startedAt: j.startedAt, finishedAt: j.finishedAt,
  turns: (j.turns ?? []).map((t) => ({ label: t.label, ms: t.finishedAt ? t.finishedAt - t.startedAt : null })),
  tools: (j.tools ?? []).map((t) => t.name),
  error: j.error ? String(j.error).slice(0, 160) : undefined,
});

async function explainOnce(reviewId, snapshot, skip, name, perOpen) {
  const q = pickQuote(snapshot, skip);
  if (!q) throw new Error("no quotable block");
  const t0 = now();
  const res = await api("POST", `/api/reviews/${reviewId}/actions`, {
    kind: "explain", quote: q.quote, anchor: { where: "block", blockId: `${q.cardId}#${q.blockId}` },
  });
  if (res.code !== 200) throw new Error(`explain -> ${res.code} ${res.raw.slice(0, 200)}`);
  const job = res.json.jobId ? await waitJob(reviewId, res.json.jobId) : null;
  const rec = { name, wallMs: now() - t0, httpMs: res.ms, job: job ? sanitizeJob(job) : null };
  perOpen.forkTurns.push(rec);
  console.log(`  ${name}: wall ${(rec.wallMs / 1000).toFixed(1)}s usage=${JSON.stringify(job?.usage ?? null)}`);
  return (await api("GET", `/api/reviews/${reviewId}`)).json;
}

async function runOpen(n) {
  const perOpen = { open: n, forkTurns: [], reader: null, base: null, jobs: [] };
  summary.opens.push(perOpen);
  const created = await api("POST", "/api/reviews", { repoId: "demo" });
  if (![200, 201, 202].includes(created.code)) throw new Error(`create -> ${created.code} ${created.raw.slice(0, 200)}`);
  const reviewId = created.json.review.id;
  perOpen.reviewId = reviewId;
  console.log(`open#${n} review=${reviewId}`);
  let snap = await untilSnapshot(reviewId, (s) => stage(s, "reader") === "done" || stage(s, "reader") === "error", 10 * 60_000, "reader");
  if (stage(snap, "reader") === "error") {
    const dj = await jobsOf(reviewId);
    perOpen.readerError = {
      stageValue: stage(snap, "reader"), pipeline: snap.pipeline ?? null,
      jobs: dj.map(sanitizeJob),
      snapshotError: snap.error ?? snap.ingest ?? null,
    };
    writeSummary();
    throw new Error("reader stage error (see readerError in summary.json)");
  }
  perOpen.readerDoneMs = now();
  snap = await untilSnapshot(reviewId, (s) => stage(s, "base") === "done" || (rootOf(s)?.cards ?? []).length > 0, 5 * 60_000, "base/cards");

  // Reader job + repair-turn forensics (prompt contents parsed, never stored).
  const jobs1 = await jobsOf(reviewId);
  const readerJob = jobs1.find((j) => j.kind === "reader");
  if (readerJob) {
    const pr = await api("GET", `/api/jobs/${readerJob.id}/prompt`);
    const snapText = pr.json?.promptSnapshot ?? "";
    const marker = "\n\n--- repair turn ---\n";
    const at = snapText.indexOf(marker);
    const repairPrompt = at >= 0 ? snapText.slice(at + marker.length) : null;
    const failedKinds = {};
    if (repairPrompt) {
      for (const line of repairPrompt.split("\n").filter((l) => l.startsWith("- "))) {
        const k = classifyRepairLine(line);
        failedKinds[k] = (failedKinds[k] ?? 0) + 1;
      }
    }
    perOpen.reader = {
      job: sanitizeJob(readerJob),
      repairTurnRan: (readerJob.turns ?? []).some((t) => t.label === "repair"),
      repairMs: (() => { const t = (readerJob.turns ?? []).find((x) => x.label === "repair"); return t?.finishedAt ? t.finishedAt - t.startedAt : null; })(),
      firstTurnMs: (() => { const t = (readerJob.turns ?? [])[0]; return t?.finishedAt ? t.finishedAt - t.startedAt : null; })(),
      firstPromptChars: at >= 0 ? at : snapText.length,
      repairPromptChars: repairPrompt ? repairPrompt.length : 0,
      repairPromptShareOfStored: snapText.length ? Number(((repairPrompt?.length ?? 0) / snapText.length).toFixed(3)) : 0,
      failedCitationKinds: failedKinds,
      failedCitationCount: Object.values(failedKinds).reduce((a, b) => a + b, 0),
    };
    console.log(`  reader: turns=${JSON.stringify(perOpen.reader.job.turns)} repair=${perOpen.reader.repairTurnRan} failedKinds=${JSON.stringify(failedKinds)}`);
  }

  if (argv.includes("--reader-only")) {
    const allJobs = await jobsOf(reviewId);
    trackCost(allJobs);
    perOpen.jobs = allJobs.map(sanitizeJob);
    perOpen.usageTotals = snap.usageTotals ?? null;
    perOpen.estCostUsdUpperBound = Number(spent.toFixed(4));
    writeSummary();
    console.log(`  reader-only open#${n} done: est upper-bound $${spent.toFixed(3)}`);
    return reviewId;
  }
  const sc = await api("GET", `/api/reviews/${reviewId}/shared-context`);
  const baseText = typeof sc.json?.base === "string" ? sc.json.base : "";
  const m = baseText.match(/\((\d+) tokens\)/);
  perOpen.base = { rawKeys: Object.keys(sc.json ?? {}), packTokens: m ? Number(m[1]) : null };
  console.log(`  shared-context keys=${JSON.stringify(perOpen.base.rawKeys)} packTokens=${perOpen.base.packTokens}`);

  // Six fork turns on identical state: 5 Explain + 1 Ask (all fork the base).
  snap = await explainOnce(reviewId, snap, 0, "explain#1", perOpen);
  snap = await explainOnce(reviewId, snap, 1, "explain#2", perOpen);
  snap = await explainOnce(reviewId, snap, 2, "explain#3", perOpen);
  {
    const q = pickQuote(snap, 3);
    const t0 = now();
    const res = await api("POST", `/api/reviews/${reviewId}/actions`, {
      kind: "ask", quote: q.quote, anchor: { where: "block", blockId: `${q.cardId}#${q.blockId}` },
      message: "Why does this matter for a reviewer? Answer in two or three sentences.",
    });
    if (res.code !== 200) throw new Error(`ask -> ${res.code} ${res.raw.slice(0, 200)}`);
    const job = res.json.jobId ? await waitJob(reviewId, res.json.jobId) : null;
    perOpen.forkTurns.push({ name: "ask#1", wallMs: now() - t0, httpMs: res.ms, job: job ? sanitizeJob(job) : null });
    console.log(`  ask#1: wall ${((now() - t0) / 1000).toFixed(1)}s usage=${JSON.stringify(job?.usage ?? null)}`);
    snap = (await api("GET", `/api/reviews/${reviewId}`)).json;
  }
  snap = await explainOnce(reviewId, snap, 4, "explain#4", perOpen);
  snap = await explainOnce(reviewId, snap, 5, "explain#5", perOpen);

  const allJobs = await jobsOf(reviewId);
  trackCost(allJobs);
  perOpen.jobs = allJobs.map(sanitizeJob);
  perOpen.usageTotals = snap.usageTotals ?? null;
  perOpen.estCostUsdUpperBound = Number(spent.toFixed(4));
  writeSummary();
  console.log(`  open#${n} done: jobs=${allJobs.length} est upper-bound $${spent.toFixed(3)}`);
  return reviewId;
}

const main = async () => {
  const env = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0", UNVIBE_ALLOW_LIVE_AGENT: "1" };
  delete env.UNVIBE_AGENT;
  delete env.GITHUB_TOKEN;
  for (const k of Object.keys(env)) if (k.startsWith("SENTRY_") || k.startsWith("AXIOM_")) delete env[k];
  const logFile = fs.openSync(path.join(OUT, "service.log"), "w");
  const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", logFile, logFile] });
  console.log(`service pid ${child.pid} port ${PORT} data ${DATA}`);
  const stop = async () => {
    try { child.kill("SIGTERM"); } catch { /* gone */ }
    await sleep(3000);
    try { child.kill("SIGKILL"); } catch { /* gone */ }
  };
  process.on("SIGINT", () => void stop().then(() => process.exit(130)));
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await sleep(250);
      try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status === 200; } catch { up = false; }
    }
    if (!up) throw new Error("service did not start (see service.log)");
    token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
    const put = await api("PUT", "/api/settings", {
      main: { provider: "codex", model: MODEL, effort: "" },
      small: { provider: "codex", model: MODEL, effort: "" },
    });
    if (put.code !== 200) throw new Error(`PUT settings -> ${put.code} ${put.raw.slice(0, 300)}`);
    console.log(`settings set: codex/${MODEL} for main+small`);
    for (let n = 1; n <= OPENS; n++) {
      const reviewId = await runOpen(n);
      if (n < OPENS) {
        await api("DELETE", `/api/reviews/${reviewId}`);
        await sleep(2000);
      }
    }
    summary.totals = { estCostUsdUpperBound: Number(spent.toFixed(4)), finishedAt: new Date().toISOString() };
    writeSummary();
  } catch (e) {
    summary.aborted = String(e?.message ?? e);
    summary.totals = { estCostUsdUpperBound: Number(spent.toFixed(4)), finishedAt: new Date().toISOString() };
    writeSummary();
    console.error(`ABORT: ${summary.aborted}`);
    process.exitCode = 3;
  } finally {
    await stop();
    fs.closeSync(logFile);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  console.log(`wrote ${path.join(OUT, "summary.json")} est upper-bound $${spent.toFixed(3)}`);
};
await main();
