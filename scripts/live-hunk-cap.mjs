/*global console process setTimeout Buffer */
// Live hunk-pass concurrency measurement (issue #210), run as:
//   mise run test:live:hunk-cap -- --repo-path /path/to/checkout --pr 123 \
//     [--caps 4,8,16,32] [--port-base 4640] [--provider pi|claude|codex] [--model <ref>] --cap <usd> [--allow-unpriced]
//
// Default model is pi with muse-spark-1.3-contributor (issue #292)
// for main and small; --provider/--model keep the other providers
// selectable. --cap (USD) is required: spend is tracked cap by cap
// (failed jobs included) and the sweep stops over the cap. Free
// pre-checks (pi --list-models, pi catalogue pricing) run before any
// spend; the spend + per-cap report also lands in
// test-results/live-hunk-cap-*.json (gitignored).
//
// For each concurrency cap (Settings -> sessionsPerProvider): starts the
// BUILT service with a fresh data dir, sets main = small (the product's
// small pick, so non-hunk jobs stay cheap), opens one PR review, cancels
// every non-hunk-pass job as it appears (isolating the hunk pass), and
// waits for all hunk-pass jobs to finish. Prints one JSON object per cap
// with wall time, per-job queue-wait / run durations (p50/p95), attempts,
// token usage and a list-price cost estimate.
//
// Never run by `mise run check`. Requires the built service and a
// logged-in `claude` CLI; spends real tokens (small model only).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPriced,
  costOf,
  createSpendTracker,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  parseLiveArgs,
  precheckModelOffered,
  preflightCap,
  resolvePiCmd,
  selectLiveModel,
  worstCaseTurnUsd,
  writeLiveReport,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const REPO_PATH = argOf("--repo-path", "");
const PR = Number(argOf("--pr", "0"));
const CAPS = argOf("--caps", "4,8,16,32").split(",").map(Number);
const PORT_BASE = Number(argOf("--port-base", "4640"));
const live = (() => {
  try {
    return parseLiveArgs(args); // --provider/--model/--cap/--allow-unpriced (issue #292)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
if (!["pi", "claude", "codex"].includes(live.provider)) {
  console.error(`unknown --provider ${live.provider} (want pi|claude|codex)`);
  process.exit(2);
}
const PI_CMD = resolvePiCmd();
const pick = { provider: live.provider, model: live.model };
let piRates = null; // catalogue rates when the pi model is priced
let spend = null; // live spend tracker (failed jobs included)
if (!REPO_PATH || !PR) {
  console.error("usage: --repo-path <checkout> --pr <number> [--caps 4,8,16,32]");
  process.exit(2);
}

// Pre-#292 list-price estimate for the Claude Haiku family (USD per
// million tokens): input 1, output 5, cache write 1.25, cache read 0.10.
// Kept for non-pi runs only: pi runs are priced from pi's own catalogue
// (never invented).
const LEGACY_RATES = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
const rates = () => piRates ?? LEGACY_RATES;

function api(port, method, apiPath, body, token) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: apiPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            // leave null
          }
          resolve({ code: res.statusCode, json, raw: data });
        });
      },
    );
    req.on("error", (e) => resolve({ code: 0, json: null, raw: String(e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, i)]);
}
function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  return { p50: pct(s, 50), p95: pct(s, 95), max: s.length ? Math.round(s[s.length - 1]) : null };
}

async function runCap(cap, idx) {
  const port = PORT_BASE + idx;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `unvibe-210-cap${cap}-`));
  const env = { ...process.env, UNVIBE_DATA_DIR: data, UNVIBE_PORT: String(port), UNVIBE_IDLE_MS: "0" };
  delete env.UNVIBE_AGENT;
  delete env.GITHUB_TOKEN;
  env.UNVIBE_ALLOW_LIVE_AGENT = "1";
  const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d.toString()));
  child.stderr.on("data", (d) => (log += d.toString()));
  const out = { cap, port };
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(500);
      const h = await api(port, "GET", "/api/health", undefined, "");
      up = h.code === 200;
    }
    if (!up) throw new Error(`service did not start: ${log.slice(-500)}`);
    const token = fs.readFileSync(path.join(data, "token"), "utf8").trim();

    // Single model-selection place (issue #292): main and small both run
    // the selected model. Fails loudly when the runner does not offer it
    // (the runner offers every pi model; the bare id maps to its provider).
    const put = async (patch) => {
      const r = await api(port, "PUT", "/api/settings", patch, token);
      return { ok: r.code === 200, status: r.code, detail: ((r.json?.errors ?? [r.raw.slice(0, 200)])).join("; "), body: r.json };
    };
    try {
      await selectLiveModel(put, pick, ["main", "small"]);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : String(e));
    }
    const sessions = await api(port, "PUT", "/api/settings", { sessionsPerProvider: cap }, token);
    if (sessions.code !== 200) throw new Error(`PUT sessionsPerProvider -> ${sessions.code}: ${sessions.raw.slice(0, 200)}`);
    out.smallModel = `${pick.provider}/${pick.model}`;

    const added = await api(port, "POST", "/api/repos", { path: REPO_PATH }, token);
    const repo = (added.json?.repos ?? []).find((r) => r.localPath === REPO_PATH);
    if (!repo) throw new Error(`repo add failed: ${added.code} ${added.raw.slice(0, 200)}`);

    const created = await api(port, "POST", "/api/reviews", { repoId: repo.id, pr: PR }, token);
    if (created.code !== 201 && created.code !== 202) {
      throw new Error(`review create -> ${created.code}: ${created.raw.slice(0, 300)}`);
    }
    const reviewId = created.json.review.id;

    // Isolate the hunk pass: cancel every other job kind on sight.
    const deadline = Date.now() + 12 * 60_000;
    let hunkJobs = [];
    for (;;) {
      const res = await api(port, "GET", `/api/jobs?review=${reviewId}`, undefined, token);
      const jobs = res.json?.jobs ?? [];
      for (const j of jobs) {
        if (j.kind !== "hunk-pass" && (j.state === "queued" || j.state === "running" || j.state === "backing-off")) {
          await api(port, "POST", `/api/jobs/${j.id}/cancel`, {}, token);
        }
      }
      hunkJobs = jobs.filter((j) => j.kind === "hunk-pass");
      const allDone =
        hunkJobs.length > 0 && hunkJobs.every((j) => ["done", "error", "cancelled"].includes(j.state));
      if (allDone) break;
      if (Date.now() > deadline) throw new Error(`timeout with ${hunkJobs.length} hunk jobs`);
      await sleep(250);
    }

    const queued = hunkJobs.map((j) => j.queuedAt ?? 0).filter(Boolean);
    const finished = hunkJobs.map((j) => j.finishedAt ?? 0).filter(Boolean);
    out.jobs = hunkJobs.length;
    out.done = hunkJobs.filter((j) => j.state === "done").length;
    out.errors = hunkJobs.filter((j) => j.state === "error").map((j) => (j.error ?? "").slice(0, 120));
    out.wallMs = finished.length && queued.length ? Math.max(...finished) - Math.min(...queued) : null;
    out.queueWaitMs = stats(hunkJobs.map((j) => (j.startedAt ?? 0) - (j.queuedAt ?? 0)).filter((v) => v >= 0));
    out.runMs = stats(
      hunkJobs.map((j) => (j.finishedAt ?? 0) - (j.startedAt ?? 0)).filter((v) => v >= 0),
    );
    out.totalMs = stats(
      hunkJobs.map((j) => (j.finishedAt ?? 0) - (j.queuedAt ?? 0)).filter((v) => v >= 0),
    );
    out.attempts = {};
    for (const j of hunkJobs) out.attempts[j.attempts ?? 1] = (out.attempts[j.attempts ?? 1] ?? 0) + 1;
    out.turnsRecorded = hunkJobs.reduce((n, j) => n + (j.turns?.length ?? 0), 0);
    const usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
    for (const j of hunkJobs) {
      if (!j.usage) continue;
      usage.inputTokens += j.usage.inputTokens ?? 0;
      usage.cachedReadTokens += j.usage.cachedReadTokens ?? 0;
      usage.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
      usage.outputTokens += j.usage.outputTokens ?? 0;
    }
    out.usage = usage;
    spend.add(usage);
    out.costUsd = Math.round(costOf(usage, rates()) * 10000) / 10000;
    out.spendUsd = Math.round(spend.usd() * 10000) / 10000;
    try {
      spend.check(`live hunk-cap (cap ${cap})`);
    } catch (e) {
      out.failure = e instanceof Error ? e.message : String(e);
      out.capExceeded = true;
    }
  } catch (err) {
    out.failure = err instanceof Error ? err.message : String(err);
    out.logTail = log.slice(-800);
  } finally {
    child.kill("SIGTERM");
    await sleep(1500);
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
    fs.rmSync(data, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out));
  return out;
}

// Free pre-checks before any spend (issue #292): pi must list the model,
// and the cap is priced from pi's own catalogue. Non-pi runs keep the
// legacy list-price estimate (tokens reported, no catalogue).
try {
  if (pick.provider === "pi") {
    precheckModelOffered(PI_CMD, pick);
    const catalog = await fetchPiCatalog(PI_CMD);
    const entry = findCatalogEntry(catalog, pick);
    piRates = assertPriced(entry, { ...pick, allowUnpriced: live.allowUnpriced });
    const oneTurn = worstCaseTurnUsd(piRates, entry);
    preflightCap({
      capUsd: live.capUsd,
      worstCaseUsd: oneTurn === null ? null : oneTurn * CAPS.length,
      what: `${CAPS.length} cap step(s) worst case`,
    });
  } else {
    console.log(`live pre-check: provider ${pick.provider} is not pi; skipping pi --list-models and catalogue pricing (legacy list-price estimate applies)`);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(2);
}
spend = createSpendTracker(rates(), live.capUsd);

const results = [];
for (let i = 0; i < CAPS.length; i++) {
  const r = await runCap(CAPS[i], i);
  results.push(r);
  if (r.capExceeded) {
    console.log(`stopping the sweep: cap ${formatUsd(live.capUsd)} exceeded (failed jobs included)`);
    break;
  }
}
console.log(JSON.stringify({ summary: results }, null, 2));
const spendUsd = Math.round(spend.usd() * 10000) / 10000;
const report = writeLiveReport({
  dir: path.join(ROOT, "test-results"),
  task: "hunk-cap",
  provider: pick.provider,
  model: pick.model,
  rates: rates(),
  ratesSource: piRates ? "pi catalogue" : "legacy list-price estimate (non-pi run)",
  capUsd: live.capUsd,
  spendUsd,
  tokens: spend.totals,
  results,
  failures: results.filter((r) => r.failure).map((r) => `cap ${r.cap}: ${r.failure}`),
});
console.log(`live hunk-cap: spend ${formatUsd(spendUsd)} of cap ${formatUsd(live.capUsd)} (failed jobs included); report ${report}`);
