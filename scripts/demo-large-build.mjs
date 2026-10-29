/*global console process setTimeout Buffer */
// Cached large-demo build (issue #309), run as:
//   mise run demo:large:build -- --repo <owner/name|url> --pr <n> [--cap <usd>] [--port N] [--budget-min M] [--allow-unpriced] [--force]
//
// Live token spend (real pi, real read-only `gh`; full access stays off,
// nothing is ever posted). Every role (main, small, secondOpinion) runs
// pi + muse-spark-1.3-contributor. Free pre-checks (`pi --list-models`,
// pi catalogue pricing) run before any spend; the spend is tracked job by
// job (failed jobs included) and the run stops over the cap. On success
// the data dir (DB, managed clone, worktrees, review folders) is copied
// into the user cache dir with a schema version (`demo-large-lib.mjs`).
//
// Never run by `mise run check`. Requires a build (`mise run build`).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEMO_LARGE_BUILD_CAP_USD,
  DEMO_LARGE_DEFAULT_PR,
  DEMO_LARGE_DEFAULT_REPO,
  DEMO_LARGE_MODEL,
  demoLargeCacheDir,
  demoLargeMetaPath,
  normalizeRepoUrl,
  parseDemoLargeBuildArgs,
  writeDemoLargeMeta,
} from "./demo-large-lib.mjs";
import {
  assertPriced,
  costOf,
  createSpendTracker,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  precheckModelOffered,
  preflightCap,
  resolvePiCmd,
  selectLiveModel,
  worstCaseTurnUsd,
  writeLiveReport,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Cached large-demo build (issue #309): live pi + muse-spark over one owner-picked public PR.",
    "",
    "Usage: mise run demo:large:build -- --repo <owner/name|url> --pr <n> [--cap <usd>] [--port N]",
    "                                     [--budget-min M] [--allow-unpriced] [--force]",
    "",
    "  --repo     public repo (owner/name or https URL; default python/cpython, owner pick on #309)",
    "  --pr       PR number to build the review from (default 160318)",
    `  --cap      spend cap in USD (default ${DEMO_LARGE_BUILD_CAP_USD})`,
    "  --port     service port for the build (default 4597)",
    "  --budget-min  pipeline budget in minutes (default 45)",
    "  --force    rebuild even when a cache already exists",
  ].join("\n"));
  process.exit(0);
}
const opts = (() => {
  try {
    return parseDemoLargeBuildArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const { url: repoUrl, owner, name } = (() => {
  try {
    return normalizeRepoUrl(opts.repo);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const PI_CMD = resolvePiCmd();
const CACHE = demoLargeCacheDir();

if (!opts.force && fs.existsSync(demoLargeMetaPath(CACHE))) {
  console.error(`demo-large build: cache already exists in ${CACHE} (pass --force to rebuild it)`);
  process.exit(2);
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

function jobsUsage(jobs) {
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

const main = async () => {
  // Free pre-checks before any spend (issue #292 pattern): pi must list
  // the model, and the cap is priced from pi's own catalogue.
  let piRates = null;
  let piEntry = null;
  try {
    precheckModelOffered(PI_CMD, DEMO_LARGE_MODEL);
    const catalog = await fetchPiCatalog(PI_CMD);
    piEntry = findCatalogEntry(catalog, DEMO_LARGE_MODEL);
    piRates = assertPriced(piEntry, { ...DEMO_LARGE_MODEL, allowUnpriced: opts.allowUnpriced });
    preflightCap({ capUsd: opts.capUsd, worstCaseUsd: worstCaseTurnUsd(piRates, piEntry), what: "one full-context turn" });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const spend = createSpendTracker(piRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, opts.capUsd);
  if (!fs.existsSync(CLI)) {
    console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
    process.exit(2);
  }

  // d2 renders diagrams service-side; missing binary only skips them.
  const d2 = spawnSync("d2", ["--version"], { encoding: "utf8" });
  if (d2.status !== 0) console.log("demo-large build: no `d2` on PATH (diagrams will skip visibly; install it for a complete cache)");

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-demo-large-build-"));
  const ENV = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(opts.port), UNVIBE_IDLE_MS: "0" };
  delete ENV.UNVIBE_AGENT; // default ACP runner (real agents)
  ENV.UNVIBE_ALLOW_LIVE_AGENT = "1";
  console.log(`demo-large build: ${owner}/${name}#${opts.pr} (${repoUrl}) cap ${formatUsd(opts.capUsd)} cache ${CACHE}`);
  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let logged = "";
  child.stdout.on("data", (d) => (logged += d.toString()));
  child.stderr.on("data", (d) => (logged += d.toString()));
  const stopService = async () => {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  };
  const health = () =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: opts.port, path: "/api/health", timeout: 2000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => resolve(false));
    });
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    up = await health();
  }
  if (!up) {
    console.error(`demo-large build: service did not start:\n${logged.slice(-2000)}`);
    await stopService();
    process.exit(1);
  }
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const put = async (patch) => {
    const r = await api(opts.port, "PUT", "/api/settings", patch, token);
    return { ok: r.code === 200, status: r.code, detail: (r.json?.errors ?? [r.raw.slice(0, 200)]).join("; "), body: r.json };
  };
  const failures = [];
  let reviewId = null;
  let headSha = null;
  try {
    // Every role on pi + muse-spark (issue #309).
    try {
      await selectLiveModel(put, DEMO_LARGE_MODEL, ["main", "small", "secondOpinion"]);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }
    if (failures.length === 0) {
      const added = await api(opts.port, "POST", "/api/repos", { url: repoUrl }, token);
      const repos = added.json?.repos ?? [];
      const repo = repos.find((r) => r.managed === true && c_urlMatches(r, repoUrl)) ?? repos.find((r) => r.managed === true);
      if (!repo) failures.push(`repo add -> ${added.code}: ${(added.raw ?? "").slice(0, 300)}`);
      else {
        console.log(`repo ${repo.id} (${repo.owner}/${repo.name}, managed)`);
        const created = await api(opts.port, "POST", "/api/reviews", { repoId: repo.id, pr: opts.pr }, token);
        if (created.code !== 201) failures.push(`review create -> ${created.code}: ${(created.raw ?? "").slice(0, 300)}`);
        else {
          reviewId = created.json.review.id;
          console.log(`review ${reviewId} created; running the full pipeline (reader, hunk passes, plotlines, glossary, diagrams)…`);
        }
      }
    }
    let snap = null;
    if (failures.length === 0) {
      const deadline = Date.now() + opts.budgetMin * 60_000;
      for (;;) {
        await new Promise((r) => setTimeout(r, 10000));
        const got = await api(opts.port, "GET", `/api/reviews/${reviewId}`, undefined, token);
        if (got.code !== 200) {
          failures.push(`GET review -> ${got.code}`);
          break;
        }
        snap = got.json;
        const root = (snap.pages ?? []).find((p) => p.id === "root");
        const findings = (snap.pages ?? []).filter((p) => p.kind === "finding");
        const hunksum = (snap.hunkStates ?? []).filter((h) => h.summary).length;
        const totalHunks = (snap.files ?? []).reduce((n, f) => n + (f.hunks ?? []).length, 0);
        const jobs = await api(opts.port, "GET", `/api/jobs?review=${reviewId}`, undefined, token);
        const busy = (jobs.json?.jobs ?? []).some((j) => j.state === "running" || j.state === "backing-off" || j.state === "queued");
        const busyKinds = (jobs.json?.jobs ?? []).filter((j) => j.state === "running" || j.state === "backing-off" || j.state === "queued").map((j) => j.kind).join(",");
        const estimate = spend.usd() + costOf(jobsUsage(jobs.json?.jobs), piRates);
        console.log(
          `  t=${Math.round((Date.now() - (deadline - opts.budgetMin * 60_000)) / 60000)}min rev=${snap.rev} files=${(snap.files ?? []).length} root=${root?.cards.length ?? 0} findings=${findings.length} hunksum=${hunksum}/${totalHunks} busy=[${busyKinds}] spend~${formatUsd(estimate)}/${formatUsd(opts.capUsd)}`,
        );
        if (estimate > opts.capUsd) {
          failures.push(`cap exceeded mid-run: priced spend ${formatUsd(estimate)} > cap ${formatUsd(opts.capUsd)} (failed jobs included); stopping before further spend`);
          break;
        }
        const plausibleTotal = totalHunks > 0 ? hunksum >= totalHunks : true;
        if ((root?.cards.length ?? 0) >= 1 && plausibleTotal && !busy) break;
        if (Date.now() > deadline) {
          failures.push(`pipeline did not finish within ${opts.budgetMin} minutes (re-run with --budget-min N; no cache saved)`);
          break;
        }
      }
      if (snap) {
        headSha = snap.currentVersion?.headSha ?? snap.versions?.[0]?.headSha ?? null;
        const jobs = await api(opts.port, "GET", `/api/jobs?review=${reviewId}`, undefined, token);
        const errored = (jobs.json?.jobs ?? []).filter((j) => j.state === "error");
        for (const j of errored) failures.push(`job ${j.kind} error: ${(j.error ?? "").slice(0, 160)}`);
        spend.add(jobsUsage(jobs.json?.jobs));
        try {
          spend.check("demo-large build");
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
  } finally {
    await stopService();
  }
  const spendUsd = Math.round(spend.usd() * 10000) / 10000;
  if (failures.length > 0) {
    console.error(`demo-large build FAILED (spend ${formatUsd(spendUsd)} of ${formatUsd(opts.capUsd)}; scratch kept at ${DATA}):\n- ${failures.join("\n- ")}`);
    writeLiveReport({
      dir: path.join(ROOT, "test-results"),
      task: "demo-large-build",
      provider: DEMO_LARGE_MODEL.provider,
      model: DEMO_LARGE_MODEL.model,
      repo: `${owner}/${name}`,
      pr: opts.pr,
      rates: piRates,
      capUsd: opts.capUsd,
      spendUsd,
      tokens: spend.totals,
      failures,
    });
    process.exit(1);
  }
  // Save the cache: DB + managed clone + worktrees + review folders.
  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(CACHE, { recursive: true });
  for (const entry of ["unvibe.db", "repos", "worktrees", "reviews"]) {
    const from = path.join(DATA, entry);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(CACHE, entry), { recursive: true });
  }
  writeDemoLargeMeta(CACHE, {
    repoUrl,
    owner,
    name,
    pr: opts.pr,
    reviewId,
    headSha,
    builtAt: new Date().toISOString(),
    model: `${DEMO_LARGE_MODEL.provider}/${DEMO_LARGE_MODEL.model}`,
    spendUsd,
    tokens: spend.totals,
  });
  const report = writeLiveReport({
    dir: path.join(ROOT, "test-results"),
    task: "demo-large-build",
    provider: DEMO_LARGE_MODEL.provider,
    model: DEMO_LARGE_MODEL.model,
    repo: `${owner}/${name}`,
    pr: opts.pr,
    reviewId,
    rates: piRates,
    capUsd: opts.capUsd,
    spendUsd,
    tokens: spend.totals,
    failures: [],
  });
  try {
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch {
    // scratch cleanup is best-effort
  }
  console.log(`demo-large build: cached ${owner}/${name}#${opts.pr} review ${reviewId} in ${CACHE} (spend ${formatUsd(spendUsd)} of ${formatUsd(opts.capUsd)}; report ${report})`);
  console.log(`open it with: mise run demo:large:open`);
}

function c_urlMatches(r, want) {
  try {
    return (r.url ?? "").replace(/\/+$/, "") === want.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

await main();
