/*global console process setTimeout Buffer */
// Live hunk-pass concurrency measurement (issue #210), run as:
//   mise run build && UNVIBE_ALLOW_LIVE_AGENT=1 node scripts/live-hunk-cap.mjs \
//     --repo-path /path/to/checkout --pr 123 [--caps 4,8,16,32] [--port-base 4640]
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
if (!REPO_PATH || !PR) {
  console.error("usage: --repo-path <checkout> --pr <number> [--caps 4,8,16,32]");
  process.exit(2);
}

// List-price estimate for the Claude Haiku family (USD per million
// tokens): input 1, output 5, cache write 1.25, cache read 0.10.
const RATES = { in: 1, out: 5, cw: 1.25, cr: 0.1 };
function costOf(u) {
  return (
    (u.inputTokens * RATES.in + u.outputTokens * RATES.out + u.cachedWriteTokens * RATES.cw + u.cachedReadTokens * RATES.cr) /
    1_000_000
  );
}

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

    const settings0 = await api(port, "GET", "/api/settings", undefined, token);
    const small = settings0.json?.small;
    if (!small) throw new Error(`no small pick: ${settings0.raw.slice(0, 200)}`);
    out.smallModel = `${small.provider}/${small.model}`;
    const put = await api(
      port,
      "PUT",
      "/api/settings",
      { main: small, small, sessionsPerProvider: cap },
      token,
    );
    if (put.code !== 200) throw new Error(`PUT settings -> ${put.code}: ${put.raw.slice(0, 200)}`);

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
    out.costUsd = Math.round(costOf(usage) * 10000) / 10000;
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

const results = [];
for (let i = 0; i < CAPS.length; i++) results.push(await runCap(CAPS[i], i));
console.log(JSON.stringify({ summary: results }, null, 2));
