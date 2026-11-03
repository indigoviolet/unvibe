/*global console process setTimeout clearTimeout Buffer */
// Reusable demo recorder: fires EVERY on-demand action against a live
// review and captures each one, run as:
//   mise run test:live:record-demo -- --cap 5 [--port 4597] [--phase auto]
//   mise run test:live:record-demo -- --cap 5 --phase ondemand --review <id> --data-dir <dir> --questions scripts/<fixture>-questions.json
//
// --provider/--model pick the agent for every role (defaults: claude +
// sonnet); pi runs price from pi's catalogue, other providers price from
// documented list rates (LIST_RATES below) and refuse without them.
// Spend is tracked from the first token (failed jobs included) and the run
// stops over --cap. The spend + per-step report lands in test-results/.
//
// Safety: GITHUB_TOKEN/GH_TOKEN are unset and a fake `gh` that refuses
// writes is first on PATH. The demo ingest makes no gh calls at all.
// UNVIBE_CAPTURE_DIR wraps the real runner (`CaptureAgentRunner`) so every
// marker-carrying prompt/reply pair is saved once — capture runs from the
// very first step, so nothing is ever spent twice.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPriced, costOf, fetchPiCatalog, findCatalogEntry,
  formatUsd, parseLiveArgs, precheckModelOffered, preflightCap,
  resolvePiCmd, selectLiveModel, worstCaseTurnUsd, writeLiveReport,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const rawArgs = process.argv.slice(2);
const phaseIdx = rawArgs.indexOf("--phase");
const PHASE = phaseIdx >= 0 ? rawArgs[phaseIdx + 1] : "auto";
const opt = (name, def) => {
  const i = rawArgs.indexOf(name);
  return i >= 0 ? rawArgs[i + 1] : def;
};
if (!["auto", "ondemand", "blocks", "full", "pilot"].includes(PHASE)) {
  console.error(`unknown --phase ${PHASE} (want auto|ondemand|blocks|full|pilot)`);
  process.exit(2);
}
const live = (() => {
  try {
    return parseLiveArgs(rawArgs);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
// Owner decision on #341: Claude Sonnet for every role unless explicitly
// overridden (--provider/--model stay as flags).
if (!rawArgs.includes("--provider")) live.provider = "claude";
if (!rawArgs.includes("--model")) live.model = "sonnet";
const PORT = Number(opt("--port", "4597"));
const NO_BOOT = rawArgs.includes("--no-boot");
const KEEP_UP = rawArgs.includes("--keep-up");
const REVIEW = opt("--review", null);
const REPO = opt("--repo", "demo");
const QUESTIONS = opt("--questions", null);
const FULL_QUESTIONS = opt("--full-questions", null);
let DATA = opt("--data-dir", null);
if ((PHASE === "ondemand" || PHASE === "pilot") && (!REVIEW || !QUESTIONS || !DATA)) {
  console.error(`${PHASE} needs --review <id> --data-dir <dir> --questions <file>`);
  process.exit(2);
}
if (PHASE === "pilot" && !FULL_QUESTIONS) {
  console.error("pilot needs --full-questions <file> (per-kind means project over its counts)");
  process.exit(2);
}
if (PHASE === "full" && !QUESTIONS) {
  console.error("full needs --questions <file> (auto + ondemand in one service boot, so the live guide survives)");
  process.exit(2);
}
if (!DATA) {
  if (NO_BOOT) {
    console.error("--no-boot needs --data-dir <dir> (reads the running service's token)");
    process.exit(2);
  }
  DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-record-demo-"));
}
const CAPTURE = path.join(DATA, "capture");
fs.mkdirSync(CAPTURE, { recursive: true });
const PI_CMD = resolvePiCmd();

// Fake gh: refuses writes, delegates read-only calls to the real gh.
// The demo path makes no gh calls; this is belt-and-braces.
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-rerecord-fakebin-"));
const realGhPath = (() => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of ["gh"]) {
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).isFile() && p !== path.join(fakeBin, "gh")) return p;
      } catch { /* keep looking */ }
    }
  }
  return "";
})();
fs.writeFileSync(path.join(fakeBin, "gh"),
  "#!/bin/sh\n" +
  "case \" $* \" in\n" +
  "  *create*|*merge*|*close*|*reopen*|*delete*|*upload*|*comment*|*edit*|*lock*|*rerun*|*cancel*|*fork*|*transfer*|*publish*|*sync*|*-X*POST*|*-X*PUT*|*-X*PATCH*|*-X*DELETE*|--method*POST*|--method*PUT*|--method*PATCH*|--method*DELETE*)\n" +
  "    echo 'fake gh: writes refused (live demo recording)' >&2; exit 1;;\n" +
  "esac\n" +
  (realGhPath ? `exec "${realGhPath}" "$@"\n` : "echo 'fake gh: no real gh for read-only delegation' >&2; exit 1\n"),
  { mode: 0o755 });

const ENV = {
  ...process.env,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "0",
  UNVIBE_ALLOW_LIVE_AGENT: "1",
  UNVIBE_CAPTURE_DIR: CAPTURE,
  PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}`,
};
delete ENV.GITHUB_TOKEN; delete ENV.GH_TOKEN;
delete ENV.UNVIBE_AGENT; // real runner (wrapped with capture), never replay/none

function api(method, apiPath, body, token) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: "127.0.0.1", port: PORT, path: apiPath, method,
      headers: { authorization: `Bearer ${token}`, ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}) },
    }, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch { /* leave null */ }
        resolve({ code: res.statusCode, json, raw: data });
      });
    });
    req.on("error", (e) => resolve({ code: 0, json: null, raw: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitJob(reviewId, jobId, token, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) {
    const got = await api("GET", `/api/jobs?review=${reviewId}`, undefined, token);
    const job = (got.json?.jobs ?? []).find((j) => j.id === jobId);
    if (!job) throw new Error(`${label}: job ${jobId} vanished`);
    if (job.state === "done" || job.state === "error") return job;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${label}: job ${jobId} not terminal after ${Math.round(timeoutMs / 1000)}s (state ${job.state})`);
    await sleep(5000);
  }
}

function usageOf(jobs) {
  const u = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
  for (const j of jobs ?? []) {
    if (!j.usage) continue;
    u.inputTokens += j.usage.inputTokens ?? 0;
    u.cachedReadTokens += j.usage.cachedReadTokens ?? j.usage.cachedTokens ?? 0;
    u.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
    u.outputTokens += j.usage.outputTokens ?? 0;
  }
  return u;
}

const AUTH_RE = /403|client_attestation|unauthori[sz]ed|not logged in|credentials_not_configured|auth/i;
function authFailure(jobs) {
  for (const j of (jobs ?? []).filter((x) => x.state === "error")) {
    if (AUTH_RE.test(`${j.error ?? ""} ${(j.detail ?? "")}`)) return j;
  }
  return null;
}

const steps = []; // {id, usd, tokens}
const tracker = { rates: null, totals: { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 } };
function noteSpend(id, jobs) {
  const u = usageOf(jobs);
  const usd = tracker.rates ? costOf(u, tracker.rates) : 0;
  steps.push({ id, usd: Math.round(usd * 10000) / 10000, tokens: u });
  const tot = usageOf([...Object.values(stepJobs).flat()]);
  tracker.totals = tot;
  return usd;
}
const stepJobs = {};
function checkCap(what) {
  if (!tracker.rates) return 0;
  const spend = costOf(tracker.totals, tracker.rates);
  if (spend > live.capUsd) {
    throw new Error(`live cap: ${what} spend ${formatUsd(spend)} exceeds cap ${formatUsd(live.capUsd)} (tokens so far: ${JSON.stringify(tracker.totals)}). Stopping before further spend.`);
  }
  return spend;
}

async function bootService() {
  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let logged = "";
  child.stdout.on("data", (d) => (logged += d.toString()));
  child.stderr.on("data", (d) => (logged += d.toString()));
  const health = () => new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
  });
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await sleep(1000);
    up = await health();
  }
  if (!up) {
    try { child.kill("SIGKILL"); } catch { /* gone */ }
    throw new Error(`service did not start on :${PORT}:\n${logged.slice(-2000)}`);
  }
  console.log(`service pid ${child.pid} on :${PORT}, data dir ${DATA}, capture ${CAPTURE}`);
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  return { child, token };
}

function stopService(child) {
  try { child.kill("SIGTERM"); } catch { /* gone */ }
  return new Promise((r) => {
    const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } r(); }, 5000);
    child.once("exit", () => { clearTimeout(t); r(); });
  });
}

async function phaseAuto(token) {
  const put = async (patch) => {
    const r = await api("PUT", "/api/settings", patch, token);
    return { ok: r.code === 200, status: r.code, detail: (r.json?.errors ?? [r.raw.slice(0, 200)]).join("; "), body: r.json };
  };
  await selectLiveModel(put, { provider: live.provider, model: live.model }, ["main", "small", "secondOpinion"]);
  const eff = (await api("GET", "/api/settings", undefined, token)).json;
  console.log(`effective settings: main=${eff.main.provider}/${eff.main.model} small=${eff.small.provider}/${eff.small.model} second=${eff.secondOpinion.provider}/${eff.secondOpinion.model}`);

  const created = await api("POST", "/api/reviews", { repoId: REPO }, token);
  if (created.code !== 201) throw new Error(`demo create -> ${created.code}: ${created.raw.slice(0, 300)}`);
  const id = created.json.review.id;
  console.log(`demo review ${id}; pilot = reader job with capture on`);
  fs.writeFileSync(path.join(DATA, "review-id.txt"), `${id}\n`);

  // Pilot gate: wait for the reader job, price it, extrapolate.
  let reader = null;
  const t0 = Date.now();
  let lastLog = 0;
  for (;;) {
    const jobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? [];
    const auth = authFailure(jobs);
    if (auth) throw new Error(`pilot: pi login looks unavailable (job ${auth.kind} error: ${(auth.error ?? "").slice(0, 300)}). Refusing to run before further spend; no fallback model.`);
    reader = jobs.find((j) => j.kind === "reader");
    if (reader && (reader.state === "done" || reader.state === "error")) break;
    if (Date.now() - t0 > 45 * 60_000) throw new Error("pilot: reader not terminal after 45 minutes");
    if (Date.now() - lastLog > 60_000) {
      lastLog = Date.now();
      const snap = (await api("GET", `/api/reviews/${id}`, undefined, token)).json;
      console.log(`  pilot wait t=${Math.round((Date.now() - t0) / 1000)}s rev=${snap?.rev} jobs=${jobs.map((j) => `${j.kind}:${j.state}`).join(",")}`);
    }
    await sleep(8000);
  }
  if (reader.state !== "done") throw new Error(`pilot: reader errored: ${(reader.error ?? "").slice(0, 300)}`);
  const readerUsd = costOf(usageOf([reader]), tracker.rates);
  const extrap = readerUsd * 12; // reader ≈ 1/12 of the full run's output (11k of ~130k)
  console.log(`pilot reader: ${formatUsd(readerUsd)} (out ${(reader.usage?.outputTokens ?? 0)} tok); extrapolated full run ≈ ${formatUsd(extrap)} vs cap ${formatUsd(live.capUsd)}`);
  if (extrap > live.capUsd) throw new Error(`pilot: extrapolated ${formatUsd(extrap)} exceeds cap ${formatUsd(live.capUsd)}; stopping before further spend.`);
  stepJobs.reader = [reader];
  noteSpend("reader", [reader]);

  // Full auto pipeline: reader + critic + hunk pass + go-deeper.
  const deadline = Date.now() + 25 * 60_000;
  let snap = null;
  for (;;) {
    await sleep(10000);
    const jobsRes = await api("GET", `/api/jobs?review=${id}`, undefined, token);
    const jobs = jobsRes.json?.jobs ?? [];
    const auth = authFailure(jobs);
    if (auth) throw new Error(`auto: pi auth failure mid-run (job ${auth.kind}): ${(auth.error ?? "").slice(0, 200)}`);
    stepJobs.auto = jobs.filter((j) => j.kind !== "reader");
    noteSpend("auto-so-far", jobs);
    steps.pop();
    checkCap("auto pipeline");
    snap = (await api("GET", `/api/reviews/${id}`, undefined, token)).json;
    const root = (snap.pages ?? []).find((p) => p.id === "root");
    const findings = (snap.pages ?? []).filter((p) => p.kind === "finding");
    const busy = jobs.some((j) => ["running", "backing-off", "queued"].includes(j.state));
    const cards = root?.cards.length ?? 0;
    console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s rev=${snap.rev} root=${cards} findings=${findings.length} busy=${busy} spend=${formatUsd(costOf(usageOf(jobs), tracker.rates))}`);
    if (cards >= 2 && findings.length >= 1 && !busy) break;
    if (Date.now() > deadline) throw new Error("auto: pipeline did not settle within 25 minutes");
  }
  const errJobs = ((await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? []).filter((j) => j.state === "error");
  if (errJobs.length > 0) throw new Error(`auto: errored jobs: ${errJobs.map((j) => `${j.kind}:${(j.error ?? "").slice(0, 120)}`).join("; ")}`);
  const finalJobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? [];
  byKind(finalJobs);
  console.log(`auto done: root cards=${((snap.pages ?? []).find((p) => p.id === "root")?.cards.length ?? 0)}, findings=${(snap.pages ?? []).filter((p) => p.kind === "finding").length}`);
  return { id, snap };
}

function byKind(jobs) {
  const kinds = {};
  for (const j of jobs) {
    (kinds[j.kind] ??= []).push(j);
  }
  stepJobs.byKind = jobs;
  for (const [k, js] of Object.entries(kinds)) {
    const usd = costOf(usageOf(js), tracker.rates);
    steps.push({ id: `auto:${k}x${js.length}`, usd: Math.round(usd * 10000) / 10000, tokens: usageOf(js) });
  }
  tracker.totals = usageOf(jobs);
}

async function phaseOndemand(token, reviewId, questionsPath) {
  const q = JSON.parse(fs.readFileSync(questionsPath, "utf8"));
  const fired = []; // {entry, jobId?, status, note}
  const fire = async (entry, payload) => {
    const r = await api("POST", `/api/reviews/${reviewId}/actions`, payload, token);
    if (r.code !== 200 || r.json?.accepted !== true) {
      fired.push({ entry, status: "rejected", note: `${r.code}: ${(r.json?.error ?? r.raw).toString().slice(0, 160)}` });
      return null;
    }
    if (r.json.reused || r.json.deduplicated) {
      fired.push({ entry, status: r.json.reused ? "reused" : "deduplicated", note: "no new turn, no spend" });
      return null;
    }
    return r.json;
  };
  // Anchor self-healing: a guessed block anchor the snapshot does not
  // know is retried once against the live guide — the block whose text
  // contains the quote wins. Rejections spend nothing.
  const healAnchor = async (payload) => {
    const snap = (await api("GET", `/api/reviews/${reviewId}`, undefined, token)).json;
    const norm = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const want = norm(payload.quote);
    for (const p of snap?.pages ?? []) {
      for (const c of p.cards ?? []) {
        for (const b of c.blocks ?? []) {
          const texts = [];
          if (b.text) texts.push(norm(b.text.standard));
          for (const it of b.items ?? []) texts.push(norm(it.text?.standard));
          if (texts.some((t) => t && (t.includes(want) || (want && want.includes(t.slice(0, 120)))))) {
            return { ...payload, anchor: { where: "block", blockId: `${c.id}#${b.id}` } };
          }
        }
      }
    }
    return null;
  };
  const settle = async (entry, res) => {
    if (!res || !res.jobId) {
      if (res) fired.push({ entry: entry, status: "ok-sync", note: "applied without a job" });
      return;
    }
    const job = await waitJob(reviewId, res.jobId, token, 10 * 60_000, entry);
    const usd = costOf(usageOf([job]), tracker.rates);
    steps.push({ id: entry, usd: Math.round(usd * 10000) / 10000, tokens: usageOf([job]) });
    const jobs = (await api("GET", `/api/jobs?review=${reviewId}`, undefined, token)).json?.jobs ?? [];
    tracker.totals = usageOf(jobs);
    checkCap(entry);
    if (job.state !== "done") {
      const auth = authFailure([job]);
      if (auth) throw new Error(`${entry}: pi auth failure: ${(job.error ?? "").slice(0, 200)}`);
      throw new Error(`${entry}: job errored: ${(job.error ?? "").slice(0, 200)}`);
    }
    fired.push({ entry, status: "done", note: `${formatUsd(usd)} job=${job.id}` });
    console.log(`  ${entry}: done ${formatUsd(usd)} total=${formatUsd(costOf(tracker.totals, tracker.rates))}`);
  };

  for (const slug of q.concept ?? []) {
    const res = await fire(`concept:${slug}`, { kind: "concept", slug });
    await settle(`concept:${slug}`, res);
  }
  for (const d of q.depth ?? []) {
    const res = await fire(`depth:${d.cardId}:${d.direction}`, { kind: "depth", cardId: d.cardId, direction: d.direction });
    await settle(`depth:${d.cardId}:${d.direction}`, res);
  }
  for (const cardId of q.examples ?? []) {
    const res = await fire(`examples:${cardId}`, { kind: "examples", cardId });
    await settle(`examples:${cardId}`, res);
  }
  for (const cardId of q.diagram ?? []) {
    const res = await fire(`diagram:${cardId}`, { kind: "diagram", cardId });
    await settle(`diagram:${cardId}`, res);
  }
  const fireHeal = async (entry, payload) => {
    let res = await fire(entry, payload);
    if (res) return res;
    const last = fired[fired.length - 1];
    if (last && last.entry === entry && last.status === "rejected" && /anchor|host|block|quote/i.test(last.note ?? "")) {
      const healed = await healAnchor(payload);
      if (healed) {
        fired.push({ entry, status: "heal-retry", note: `anchor → ${healed.anchor?.blockId ?? "?"}` });
        console.log(`  ${entry}: anchor healed → ${healed.anchor?.blockId ?? "?"}, retrying`);
        res = await fire(entry, healed);
      }
    }
    return res;
  };
  for (const e of q.explain ?? []) {
    const payload = { kind: "explain", quote: e.quote, anchor: e.anchor };
    const res = await fireHeal(`explain:${e.key}`, payload);
    await settle(`explain:${e.key}`, res);
  }
  for (const a of q.ask ?? []) {
    const payload = { kind: "ask", quote: a.quote, message: a.message, anchor: a.anchor };
    const res = await fireHeal(`ask:${a.key}`, payload);
    await settle(`ask:${a.key}`, res);
  }
  // Thread depths: ask on a fresh review to open a conversation card, then
  // step its level. Conversation cards share one `expansion:<level>`
  // recording (stable ids would collide across threads).
  for (const t of q.threadDepths ?? []) {
    const askPayload = { kind: "ask", quote: t.ask.quote, message: t.ask.message, anchor: t.ask.anchor };
    const askRes = await fireHeal(`ask:${t.ask.key}`, askPayload);
    const threadId = askRes?.replyId ?? askRes?.turnId ?? null;
    await settle(`ask:${t.ask.key}`, askRes);
    if (!threadId) {
      fired.push({ entry: `depth:expansion:${t.direction}`, status: "rejected", note: "ask produced no thread id" });
      continue;
    }
    const res = await fire(`depth:expansion:${t.direction}`, { kind: "depth", cardId: threadId, direction: t.direction });
    await settle(`depth:expansion:${t.direction}`, res);
  }
  for (const s of q.secondOpinion ?? []) {
    const res = await fire(`second-opinion:${s.cardId}:${s.mode}`, { kind: "second_opinion", cardId: s.cardId, mode: s.mode });
    if (res) await settle(`second-opinion:${s.cardId}:${s.mode}`, res);
    // A refusal here is expected when second opinion === main (by design);
    // recorded in fired[] by fire(); no spend either way.
  }
  return fired;
}

/**
 * Pilot: run the ondemand set in QUESTIONS (one card's full set plus one
 * of each other kind) against the live review, measure per-kind means,
 * and project the FULL_QUESTIONS set over its counts. Throws when the
 * projection exceeds the cap, before further spend. Kinds absent from
 * the pilot fall back to the overall measured mean.
 */
async function phasePilot(token, reviewId, questionsPath, fullPath) {
  const fired = await phaseOndemand(token, reviewId, questionsPath);
  const byKind = {};
  for (const s of steps) {
    const kind = String(s.id).split(":")[0];
    if (kind === "reader" || kind === "auto" || kind === "auto-so-far") continue;
    if (typeof s.usd !== "number") continue;
    (byKind[kind] ??= []).push(s.usd);
  }
  const mean = (kind) => {
    const xs = byKind[kind] ?? [];
    if (xs.length > 0) return xs.reduce((a, b) => a + b, 0) / xs.length;
    const all = Object.values(byKind).flat();
    return all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : 0;
  };
  const full = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const counts = {
    concept: (full.concept ?? []).length,
    depth: (full.depth ?? []).length,
    examples: (full.examples ?? []).length,
    diagram: (full.diagram ?? []).length,
    explain: (full.explain ?? []).length,
    ask: (full.ask ?? []).length,
    threadDepths: (full.threadDepths ?? []).length,
  };
  const spent = costOf(tracker.totals, tracker.rates);
  const projected =
    spent +
    counts.concept * mean("concept") +
    (counts.depth + counts.threadDepths) * mean("depth") +
    counts.examples * mean("examples") +
    counts.diagram * mean("diagram") +
    counts.explain * mean("explain") +
    (counts.ask + counts.threadDepths) * mean("ask");
  console.log(
    `pilot per-kind means: ${Object.entries(byKind).map(([k, xs]) => `${k}=${formatUsd(xs.reduce((a, b) => a + b, 0) / xs.length)}x${xs.length}`).join(" ")}`,
  );
  console.log(`pilot counts: ${JSON.stringify(counts)} spent=${formatUsd(spent)} projected=${formatUsd(projected)} vs cap ${formatUsd(live.capUsd)}`);
  if (projected > live.capUsd) {
    throw new Error(`pilot: projected ${formatUsd(projected)} exceeds cap ${formatUsd(live.capUsd)}; stopping before further spend.`);
  }
  return { fired, projected };
}

/**
 * List USD/MTok rates for non-pi runs. Claude Sonnet 5.5: $2 in / $10
 * out / $0.10 cache-read / $2.50 cache-write (5-min) per M — Anthropic's
 * pricing page via multiple checks Oct–Nov 2026 (cache read was $0.20
 * before Oct 7). No catalogue exists for claude; these documented list
 * rates price the cap guard and the report.
 */
const LIST_RATES = {
  "claude/sonnet": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude/haiku": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

const main = async () => {
  try {
    if (live.provider === "pi") {
      const hit = precheckModelOffered(PI_CMD, live, { env: ENV });
      console.log(`live pre-check: pi offers ${hit.provider}/${hit.model} (free, no ~/.pi read)`);
      const catalog = await fetchPiCatalog(PI_CMD, { env: ENV });
      const entry = findCatalogEntry(catalog, live);
      tracker.rates = assertPriced(entry, live);
      preflightCap({ capUsd: live.capUsd, worstCaseUsd: worstCaseTurnUsd(tracker.rates, entry), what: "one full-context turn" });
    } else {
      const key = `${live.provider}/${live.model}`;
      const rates = LIST_RATES[key];
      if (!rates) {
        console.error(`refusing: no documented list rates for ${key} (pass --provider/--model for a rated model; no fallback, no invented prices)`);
        process.exit(2);
      }
      tracker.rates = rates;
      console.log(`live pricing: ${key} at $${rates.input}/M in, $${rates.output}/M out, $${rates.cacheRead}/M cache-read, $${rates.cacheWrite}/M cache-write (documented list rates)`);
      preflightCap({ capUsd: live.capUsd, worstCaseUsd: null, what: "one full-context turn" });
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }

  let child = null;
  let token;
  if (NO_BOOT) {
    if (!DATA) throw new Error("--no-boot needs --data-dir <dir>");
    token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
    console.log(`attached to running service on :${PORT}, data dir ${DATA}`);
  } else {
    ({ child, token } = await bootService());
  }
  let reviewId = REVIEW;
  let report = { task: "record-demo", phase: PHASE, provider: live.provider, model: live.model, capUsd: live.capUsd, steps, failures: [] };
  try {
    if (PHASE === "auto") {
      const out = await phaseAuto(token);
      reviewId = out.reviewId ?? out.id;
      report.reviewId = reviewId;
      report.dataDir = DATA;
      report.captureDir = CAPTURE;
    } else if (PHASE === "full") {
      // Auto + ondemand in one service boot: the live guide never goes
      // through a restart between phases.
      const out = await phaseAuto(token);
      reviewId = out.reviewId ?? out.id;
      report.reviewId = reviewId;
      report.dataDir = DATA;
      report.captureDir = CAPTURE;
      const fired = await phaseOndemand(token, reviewId, QUESTIONS);
      report.fired = fired;
    } else if (PHASE === "pilot") {
      const out = await phasePilot(token, reviewId, QUESTIONS, FULL_QUESTIONS);
      report.reviewId = reviewId;
      report.dataDir = DATA;
      report.captureDir = CAPTURE;
      report.fired = out.fired;
      report.projectedUsd = Math.round(out.projected * 10000) / 10000;
    } else if (PHASE === "blocks") {
      // No-spend structural dump: card/block ids + finding ids + glossary,
      // for authoring the ondemand questions file against the live guide.
      const snap = (await api("GET", `/api/reviews/${reviewId}`, undefined, token)).json;
      if (!snap || !snap.pages) throw new Error(`no snapshot for review ${reviewId}`);
      const firstText = (b) => {
        const t = b.text?.standard ?? b.items?.map((it) => it.text?.standard ?? "").join(" ") ?? "";
        return String(t).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 110);
      };
      console.log(`review ${reviewId} pages:`);
      for (const p of snap.pages) {
        console.log(`- page ${p.id} (${p.kind}): ${p.title}`);
        for (const c of p.cards ?? []) {
          console.log(`  - card ${c.id}: ${c.title}`);
          for (const b of c.blocks ?? []) console.log(`    - ${b.type}:${b.id}: ${firstText(b)}`);
        }
      }
      console.log(`glossary: ${JSON.stringify((snap.glossary ?? []).map((g) => g.name))}`);
      console.log(`files: ${JSON.stringify((snap.files ?? []).map((f) => f.fileKey))}`);
      report.reviewId = reviewId;
      report.dataDir = DATA;
      report.captureDir = CAPTURE;
      report.note = "blocks dump only; no agent calls, no spend";
    } else {
      const fired = await phaseOndemand(token, reviewId, QUESTIONS);
      report.reviewId = reviewId;
      report.dataDir = DATA;
      report.captureDir = CAPTURE;
      report.fired = fired;
    }
    report.spendUsd = Math.round(costOf(tracker.totals, tracker.rates) * 10000) / 10000;
    report.totals = tracker.totals;
  } catch (e) {
    report.failures.push(e instanceof Error ? e.message : String(e));
    try {
      const jobs = reviewId ? (await api("GET", `/api/jobs?review=${reviewId}`, undefined, token)).json?.jobs ?? [] : [];
      report.totals = usageOf(jobs);
      report.spendUsd = Math.round(costOf(report.totals, tracker.rates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }) * 10000) / 10000;
    } catch { /* report what we have */ }
    console.error(`FAILED: ${report.failures.join("; ")}`);
  } finally {
    if (child && !KEEP_UP) await stopService(child);
    if (child && KEEP_UP) console.log(`service kept up: pid ${child.pid} on :${PORT}, data dir ${DATA}, review ${reviewId ?? "(none)"} — kill it by PID when done`);
  }
  const file = writeLiveReport({ dir: path.join(ROOT, "test-results"), ...report });
  console.log(`steps:\n${steps.map((s) => `- ${s.id}: ${formatUsd(s.usd)}`).join("\n")}`);
  console.log(`total ${formatUsd(report.spendUsd ?? 0)} vs cap ${formatUsd(live.capUsd)}; report ${file}`);
  console.log(`data dir: ${DATA}; capture: ${CAPTURE}${reviewId ? `; review: ${reviewId}` : ""}`);
  if (report.failures.length > 0) process.exit(1);
};

await main();
