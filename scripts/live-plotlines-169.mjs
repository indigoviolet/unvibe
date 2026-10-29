/*global console process setTimeout Buffer */
// Live evaluation for issue #169 (hunk scores + plotlines), run as:
//   mise run test:live:plotlines [--port N] [--provider pi|claude|codex] [--model <ref>] --cap <usd> [--allow-unpriced]
//
// Default provider is pi with muse-spark-1.3-contributor (issue
// #292); --provider/--model keep the other providers selectable. --cap
// (USD) is required: spend is tracked case by case (failed jobs included)
// and the run stops over the cap. Free pre-checks (pi --list-models, pi
// catalogue pricing) run before any spend; the spend + per-case report
// also lands in test-results/live-plotlines-*.json (gitignored).
//
// Spins up the BUILT service (real agent logins; token spend), opens the bundled demo plus three
// public pallets/flask PRs of different sizes (read-only: clone + fetch
// through the service's own gh/git paths; nothing is ever posted), waits
// out each pipeline, and records per case: score spread, plotlines with
// sample hunks, wall time, and token usage by job kind (reader,
// hunk-pass, plotline-assign fallback). Results print as JSON; the
// write-up goes on the issue, not here.
//
// Never run by `mise run check`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertPriced,
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
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4596;
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
let piRates = null; // catalogue rates when the pi model is priced
let spend = null; // live spend tracker (failed jobs included)
const caseIdx = args.indexOf("--case");
const onlyCase = caseIdx >= 0 ? args[caseIdx + 1] : null;
// Issue #193: stop as soon as the reader lands (plotlines + its usage),
// instead of waiting out the whole pipeline.
const readerOnly = args.includes("--reader-only");

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-plot-data-"));
const ENV = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(PORT), UNVIBE_IDLE_MS: "0" };
delete ENV.UNVIBE_AGENT; // default ACP runner (real agents)
ENV.UNVIBE_ALLOW_LIVE_AGENT = "1"; // default ACP runner (real agents)

const CASES = [
  { name: "demo", create: { repoId: "demo" }, budgetMs: 15 * 60_000 },
  { name: "urllib3-small-5310", repoUrl: "https://github.com/urllib3/urllib3", pr: 5310, budgetMs: 20 * 60_000 },
  { name: "urllib3-medium-5245", repoUrl: "https://github.com/urllib3/urllib3", pr: 5245, budgetMs: 30 * 60_000 },
  { name: "urllib3-large-5278", repoUrl: "https://github.com/urllib3/urllib3", pr: 5278, budgetMs: 40 * 60_000 },
  // Issue #193: clean two-commit PR (fix + changelog) vs one-commit squashed PR.
  { name: "clean-5310", repoUrl: "https://github.com/urllib3/urllib3", pr: 5310, budgetMs: 20 * 60_000 },
  { name: "squashed-5259", repoUrl: "https://github.com/urllib3/urllib3", pr: 5259, budgetMs: 20 * 60_000 },
];

function api(method, apiPath, body, token) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
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

async function waitService() {
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
          res.resume();
          resolve(res.statusCode === 200);
        });
        req.on("timeout", () => req.destroy());
        req.on("error", () => resolve(false));
      });
      if (ok) return true;
    } catch {
      // retry
    }
  }
  return false;
}

async function runCase(c, token, repoCache) {
  const out = { name: c.name, failures: [] };
  const t0 = Date.now();
  let id;
  let createdAt = t0;
  try {
    if (c.create) {
      const created = await api("POST", "/api/reviews", c.create, token);
      if (created.code !== 201 && created.code !== 202) {
        out.failures.push(`review create -> ${created.code}: ${(created.raw ?? "").slice(0, 200)}`);
        return out;
      }
      id = created.json.review.id;
      createdAt = created.json.review.createdAt ?? t0;
    } else {
      let repoId = repoCache[c.repoUrl];
      if (!repoId) {
        console.log(`[${c.name}] adding repo ${c.repoUrl} (managed clone)…`);
        const added = await api("POST", "/api/repos", { url: c.repoUrl }, token);
        if (added.code !== 200) {
          out.failures.push(`repo add -> ${added.code}: ${(added.raw ?? "").slice(0, 300)}`);
          return out;
        }
        const repos = added.json?.repos ?? [];
        const repo = repos.find((r) => r.managed === true && c.repoUrl.includes(`${r.owner}/${r.name}`));
        repoId = repo?.id;
        console.log(`[${c.name}] repos: ${repos.map((r) => `${r.id}(${r.owner}/${r.name}${r.managed ? ",managed" : ""})`).join(", ")}`);
        if (!repoId) {
          out.failures.push(`repo add: no managed match for ${c.repoUrl}`);
          return out;
        }
        repoCache[c.repoUrl] = repoId;
      }
      console.log(`[${c.name}] opening PR ${c.pr}…`);
      const created = await api("POST", "/api/reviews", { repoId, pr: c.pr }, token);
      if (created.code !== 201 && created.code !== 202 && created.code !== 200) {
        out.failures.push(`review create -> ${created.code}: ${(created.raw ?? "").slice(0, 300)}`);
        return out;
      }
      id = created.json.review.id;
    }
    out.reviewId = id;
    // Poll: ingest ready, then pipeline stages done and no live jobs.
    const deadline = Date.now() + c.budgetMs;
    let snap = null;
    let retried = false;
    for (;;) {
      await sleep(readerOnly ? 5000 : 30000);
      const got = await api("GET", `/api/reviews/${id}`, undefined, token);
      if (got.code !== 200) {
        out.failures.push(`GET review -> ${got.code}`);
        break;
      }
      snap = got.json;
      const stages = snap.pipeline?.stages ?? {};
      const jobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? [];
      const busy = jobs.some((j) => j.state === "running" || j.state === "backing-off" || j.state === "queued");
      const hunks = (snap.files ?? []).reduce((n, f) => n + (f.hunks ?? []).length, 0);
      const scored = (snap.hunkStates ?? []).filter((s) => s.score !== undefined).length;
      console.log(
        `  [${c.name}] t=${Math.round((Date.now() - t0) / 1000)}s ingest=${snap.ingest?.status} ` +
          `stages=${["reader", "base", "critic", "concepts", "hunk-pass"].map((k) => `${k}:${stages[k] ?? "?"}`).join(",")} ` +
          `hunks=${hunks} scored=${scored} plotlines=${(snap.plotlines ?? []).length} busy=${busy}`,
      );
      const core = ["reader", "base", "critic", "concepts", "hunk-pass"];
      if (readerOnly && snap.ingest?.status === "ready" && stages.reader === "done") break;
      if (snap.ingest?.status === "ready" && core.every((k) => stages[k] === "done") && !busy) break;
      if (snap.ingest?.status === "failed") {
        out.failures.push(`ingest failed: ${(snap.ingest?.error ?? "").slice(0, 300)}`);
        break;
      }
      if (!busy && (stages.reader === "error" || stages.base === "error")) {
        if (!retried) {
          // Same as the guide's Retry button: one resume, then keep polling.
          retried = true;
          console.log(`  [${c.name}] reader errored; resuming once…`);
          await api("POST", `/api/reviews/${id}/resume`, undefined, token);
          continue;
        }
        const jobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? [];
        const errs = jobs.filter((j) => j.state === "error").map((j) => `${j.kind}: ${(j.error ?? "").slice(0, 200)}`);
        out.failures.push(`pipeline stalled: ${errs.join("; ") || "reader/base error"}`);
        break;
      }
      if (Date.now() > deadline) {
        out.failures.push("pipeline did not finish within budget");
        break;
      }
    }
    if (!snap) {
      out.failures.push("no snapshot captured");
      return out;
    }
    out.seconds = Math.round((Date.now() - t0) / 1000);
    const files = snap.files ?? [];
    const hunks = files.reduce((n, f) => n + (f.hunks ?? []).length, 0);
    out.hunks = hunks;
    out.files = files.length;
    const states = new Map((snap.hunkStates ?? []).map((s) => [s.contentHash, s]));
    out.scores = { mechanical: 0, routine: 0, substantive: 0, "needs-attention": 0, unscored: 0 };
    out.hidden = 0;
    for (const f of files) {
      for (const h of f.hunks ?? []) {
        const s = states.get(h.contentHash)?.score;
        if (s && out.scores[s] !== undefined) out.scores[s] += 1;
        else out.scores.unscored += 1;
        if (h.hiddenReason) out.hidden += 1;
      }
    }
    const byPlot = new Map();
    let other = 0;
    for (const f of files) {
      for (const h of f.hunks ?? []) {
        const p = states.get(h.contentHash)?.plotline;
        if (p === undefined) other += 1;
        else byPlot.set(p, (byPlot.get(p) ?? 0) + 1);
      }
    }
    // Sample hunks per plotline (first 3: path + summary) for the write-up.
    const samples = new Map();
    for (const f of files) {
      for (const h of f.hunks ?? []) {
        const p = states.get(h.contentHash)?.plotline ?? "other";
        const arr = samples.get(p) ?? [];
        if (arr.length < 3) {
          arr.push(`${f.path} @${h.newStart}: ${(states.get(h.contentHash)?.summary ?? h.header).slice(0, 110)}`);
          samples.set(p, arr);
        }
      }
    }
    // Issue #193: the commit evidence the reader actually had.
    out.commits = (snap.commits ?? []).map((c) => ({
      sha: c.sha.slice(0, 7),
      subject: c.subject,
      files: c.files,
      hunks: (c.hunks ?? []).length,
    }));
    out.plotlines = (snap.plotlines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      buildsOn: p.buildsOn ?? null,
      hunks: byPlot.get(p.id) ?? 0,
      sample: samples.get(p.id) ?? [],
    }));
    out.other = { hunks: other, sample: samples.get("other") ?? [] };
    const jobs = (await api("GET", `/api/jobs?review=${id}`, undefined, token)).json?.jobs ?? [];
    out.jobStates = jobs.map((j) => `${j.kind}:${j.state}`).join(",");
    out.errored = jobs.filter((j) => j.state === "error").map((j) => `${j.kind}: ${(j.error ?? "").slice(0, 160)}`);
    out.usageByKind = {};
    for (const j of jobs) {
      const u = j.usage ?? {};
      const e = (out.usageByKind[j.kind] ??= { jobs: 0, input: 0, cachedRead: 0, cachedWrite: 0, output: 0 });
      e.jobs += 1;
      e.input += u.inputTokens ?? 0;
      e.cachedRead += u.cachedReadTokens ?? 0;
      e.cachedWrite += u.cachedWriteTokens ?? 0;
      e.output += u.outputTokens ?? 0;
    }
    const totals = snap.usageTotals ?? {};
    out.usageTotals = {
      input: totals.inputTokens ?? 0,
      cachedRead: totals.cachedReadTokens ?? 0,
      cachedWrite: totals.cachedWriteTokens ?? 0,
      output: totals.outputTokens ?? 0,
      hitRate: totals.cacheHitRate ?? null,
      firstCardS: totals.firstCardAt ? Math.round((totals.firstCardAt - createdAt) / 100) / 10 : null,
    };
    // Priced spend for this case (all jobs, failed included) when pi
    // catalogue rates are known; otherwise tokens are reported without a
    // USD conversion (no invented prices).
    out.spendUsd = null;
    if (piRates) {
      const caseUsage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
      for (const k of Object.values(out.usageByKind)) {
        caseUsage.inputTokens += k.input;
        caseUsage.cachedReadTokens += k.cachedRead;
        caseUsage.cachedWriteTokens += k.cachedWrite;
        caseUsage.outputTokens += k.output;
      }
      spend.add(caseUsage);
      out.spendUsd = Math.round(spend.usd() * 10000) / 10000;
      try {
        spend.check(`live plotlines (${c.name})`);
      } catch (e) {
        out.failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    // Prompt bytes: reader + one hunk-pass job (the score/plotline bytes
    // ride these prompts).
    const readerJob = jobs.find((j) => j.kind === "reader");
    if (readerJob) {
      const p = await api("GET", `/api/jobs/${readerJob.id}/prompt`, undefined, token);
      out.readerPromptChars = (p.json?.promptSnapshot ?? "").length;
    }
    const hunkJob = jobs.find((j) => j.kind === "hunk-pass" || j.kind === "summarize");
    if (hunkJob) {
      const p = await api("GET", `/api/jobs/${hunkJob.id}/prompt`, undefined, token);
      out.hunkPromptChars = (p.json?.promptSnapshot ?? "").length;
    }
    out.assignJob = jobs.some((j) => j.kind === "plotline-assign")
      ? jobs.find((j) => j.kind === "plotline-assign").state
      : "not-run";
    console.log(
      `[${c.name}] done in ${out.seconds}s: hunks=${hunks} scores=${JSON.stringify(out.scores)} ` +
        `plotlines=${out.plotlines.length} other=${other} assign=${out.assignJob}`,
    );
  } catch (err) {
    out.failures.push(`exception: ${String(err).slice(0, 300)}`);
  }
  return out;
}

const main = async () => {
  // Free pre-checks before anything starts (issue #292): pi must list the
  // model, and the cap is priced from pi's own catalogue. No prompt, no spend.
  try {
    if (live.provider === "pi") {
      precheckModelOffered(PI_CMD, { provider: "pi", model: live.model });
      const catalog = await fetchPiCatalog(PI_CMD);
      const entry = findCatalogEntry(catalog, { provider: "pi", model: live.model });
      piRates = assertPriced(entry, { provider: "pi", model: live.model, allowUnpriced: live.allowUnpriced });
      const planned = onlyCase ? 1 : CASES.length;
      const oneTurn = worstCaseTurnUsd(piRates, entry);
      preflightCap({ capUsd: live.capUsd, worstCaseUsd: oneTurn === null ? null : oneTurn * planned, what: `${planned} case(s) worst case` });
    } else {
      console.log(`live pre-check: provider ${live.provider} is not pi; skipping pi --list-models and catalogue pricing (tokens reported, no USD conversion)`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  spend = createSpendTracker(piRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, live.capUsd);
  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let logged = "";
  child.stdout.on("data", (d) => (logged += d.toString()));
  child.stderr.on("data", (d) => (logged += d.toString()));
  if (!(await waitService())) {
    console.error(`service did not start:\n${logged.slice(-2000)}`);
    child.kill("SIGKILL");
    process.exit(1);
  }
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  // Single model-selection place (issue #292): fails loudly when the
  // runner does not offer the model (it offers every pi model; the bare id maps to its provider).
  const put = async (patch) => {
    const r = await api("PUT", "/api/settings", patch, token);
    return { ok: r.code === 200, status: r.code, detail: ((r.json?.errors ?? [r.raw.slice(0, 200)])).join("; "), body: r.json };
  };
  try {
    await selectLiveModel(put, { provider: live.provider, model: live.model }, ["main", "small"]);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    child.kill("SIGTERM");
    await sleep(2000);
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
    process.exit(1);
  }
  const settings = await api("GET", "/api/settings", undefined, token);
  console.log(`settings: ${JSON.stringify(settings.json?.main ?? settings.json)}`);
  const repoCache = {};
  const results = [];
  try {
    for (const c of CASES) {
      if (onlyCase && c.name !== onlyCase) continue;
      const r = await runCase(c, token, repoCache);
      results.push(r);
      console.log(JSON.stringify(r, null, 1));
    }
  } finally {
    child.kill("SIGTERM");
    await sleep(2000);
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  const failed = results.some((r) => (r.failures ?? []).length > 0);
  const spendUsd = Math.round(spend.usd() * 10000) / 10000;
  const report = writeLiveReport({
    dir: path.join(ROOT, "test-results"),
    task: "plotlines-169",
    provider: live.provider,
    model: live.model,
    rates: piRates,
    capUsd: live.capUsd,
    spendUsd,
    tokens: spend.totals,
    results,
    failures: results.flatMap((r) => (r.failures ?? []).map((f) => `${r.name}: ${f}`)),
  });
  console.log(`live plotlines: priced spend ${formatUsd(spendUsd)} of cap ${formatUsd(live.capUsd)} (failed jobs included); report ${report}`);
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  process.exit(failed ? 1 : 0);
};

await main();
