/*global console process setTimeout Buffer */
// Live pipeline smoke test (M3), run as:
//   mise run test:live:pipeline [--port N] [--provider pi|claude|codex|both|all] [--model <ref>] --cap <usd> [--allow-unpriced]
//
// Default provider is pi with muse-spark-1.3-contributor (issue #292);
// --provider/--model keep the other providers selectable. --cap (USD) is
// required: spend is tracked job by job (failed jobs included) and the run
// stops over the cap. Free pre-checks (pi --list-models, pi catalogue
// pricing) run before any spend; the spend + per-run report also lands in
// test-results/live-pipeline-*.json (gitignored).
//
// Spins up the BUILT service (real agent logins; modest token spend), creates a review of a small scratch change
// (temp git repo, 3 files, deleted afterwards), and lets the whole pipeline
// run once per provider. Records: time to first card, total tokens and
// cache-hit rate, citation valid/repaired/unverified counts, card
// streaming, critic findings + suggested comments, and hunk hide-rule
// compliance. Results go to docs/live-pipeline-results.md.
//
// Never run by `mise run check`. Requires built service (`mise run build`)
// and logged-in `claude`/`codex` CLIs.
import { spawn, spawnSync } from "node:child_process";
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
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4595;
const live = (() => {
  try {
    return parseLiveArgs(args); // --provider/--model/--cap/--allow-unpriced (issue #292)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const PI_CMD = resolvePiCmd();

const LEGACY = {
  claude: { name: "claude", main: { provider: "claude", model: "sonnet" }, small: { provider: "claude", model: "haiku" } },
  // Codex has no settable "default" value (set_config_option rejects it);
  // use the concrete default from docs/acp-runner.md.
  codex: { name: "codex", main: { provider: "codex", model: "gpt-5.6-terra" }, small: { provider: "claude", model: "haiku" } },
};
const piRun = {
  name: "pi",
  main: { provider: "pi", model: live.model },
  small: { provider: "pi", model: live.model },
};
const RUNS = (() => {
  switch (live.provider) {
    case "pi": return [piRun];
    case "claude": return [LEGACY.claude];
    case "codex": return [LEGACY.codex];
    case "both": return [LEGACY.claude, LEGACY.codex];
    case "all": return [piRun, LEGACY.claude, LEGACY.codex];
    default: break;
  }
  console.error(`unknown --provider ${live.provider} (want pi|claude|codex|both|all)`);
  process.exit(2);
})();

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-pipe-data-"));
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-pipe-repo-"));
const ENV = {
  ...process.env,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "0",
};
delete ENV.UNVIBE_AGENT; // default ACP runner (real agents)
ENV.UNVIBE_ALLOW_LIVE_AGENT = "1"; // default ACP runner (real agents)

function git(gitArgs, cwd = REPO) {
  const r = spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(" ")} failed: ${r.stderr}`);
  return (r.stdout ?? "").trim();
}

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

function wsWatch(reviewId, token, budgetMs) {
  // Minimal WS client over raw http (no ws dependency): GET with
  // Upgrade headers, then count text/patch/job frames as opaque bytes.
  // We only need stream evidence (bytes flowing before completion), which
  // the HTTP poll below corroborates with rev growth.
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: `/api/events?review=${reviewId}`,
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      },
      (res) => resolve({ streamed: false, bytes: 0, note: `unexpected status ${res.statusCode}` }),
    );
    let bytes = 0;
    let firstByteAt = null;
    req.on("upgrade", (res, socket) => {
      void res;
      socket.on("data", (d) => {
        bytes += d.length;
        if (firstByteAt === null) firstByteAt = Date.now() - start;
      });
      setTimeout(() => {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        resolve({ streamed: bytes > 0, bytes, firstByteMs: firstByteAt });
      }, budgetMs);
    });
    req.on("error", () => resolve({ streamed: false, bytes: 0, note: "ws error" }));
    req.end();
  });
}

// Scratch change: 3 files, small hunks, one import-only hunk (hide
// candidate), one one-line hunk (must never hide).
function makeScratchRepo() {
  git(["init", "-b", "main"]);
  git(["config", "user.email", "live-pipeline@example.com"]);
  git(["config", "user.name", "live-pipeline"]);
  fs.writeFileSync(path.join(REPO, "calc.py"), '"""Tiny calculator."""\n\n\ndef add(a, b):\n    return a + b\n');
  fs.writeFileSync(path.join(REPO, "test_calc.py"), '"""Tests."""\n\nfrom calc import add\n\n\ndef test_add():\n    assert add(1, 2) == 3\n');
  fs.writeFileSync(path.join(REPO, "notes.md"), "# Notes\n\nNothing yet.\n");
  git(["add", "."]);
  git(["commit", "-m", "base"]);
  git(["checkout", "-b", "feature"]);
  fs.writeFileSync(
    path.join(REPO, "calc.py"),
    '"""Tiny calculator."""\n\nimport os\n\n\ndef add(a, b):\n    """Add two numbers, treating None as zero."""\n    a = 0 if a is None else a\n    b = 0 if b is None else b\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n',
  );
  fs.writeFileSync(
    path.join(REPO, "test_calc.py"),
    '"""Tests."""\n\nimport os\n\nfrom calc import add, mul\n\n\ndef test_add():\n    assert add(1, 2) == 3\n\n\ndef test_add_none():\n    assert add(None, 2) == 2\n\n\ndef test_mul():\n    assert mul(3, 4) == 12\n',
  );
  fs.writeFileSync(path.join(REPO, "notes.md"), "# Notes\n\nmul added.\n");
  git(["commit", "-am", "feature: none-safe add, mul, tests"]);
}

async function runOnce(run, token) {
  const out = { run: run.name, failures: [] };
  console.log(`\n=== live pipeline: ${run.name} (main ${run.main.provider}/${run.main.model}, small ${run.small.provider}/${run.small.model}) ===`);
  const t0 = Date.now();
  // Single model-selection place (issue #292): fails loudly when the
  // runner does not offer the model (it offers every pi model; the bare id maps to its provider).
  const put = async (patch) => {
    const r = await api("PUT", "/api/settings", patch, token);
    return { ok: r.code === 200, status: r.code, detail: (r.json?.errors ?? [r.raw.slice(0, 200)]).join("; "), body: r.json };
  };
  try {
    await selectLiveModel(put, run.main, ["main"]);
    await selectLiveModel(put, run.small, ["small"]);
  } catch (e) {
    out.failures.push(e instanceof Error ? e.message : String(e));
    return out;
  }
  // Spend for this run is priced when pi catalogue rates are known;
  // legacy-provider runs report tokens only (no invented prices).
  const runRates = run.main.provider === "pi" ? piRates : null;
  // Mid-run cap guard: every poll re-sums usage over ALL jobs (failed
  // jobs included) and stops the run once priced spend passes the cap.
  const runJobsUsage = (jobs) => {
    const u = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
    for (const j of jobs ?? []) {
      if (!j.usage) continue;
      u.inputTokens += j.usage.inputTokens ?? 0;
      u.cachedReadTokens += j.usage.cachedReadTokens ?? j.usage.cachedTokens ?? 0;
      u.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
      u.outputTokens += j.usage.outputTokens ?? 0;
    }
    return u;
  };
  const added = await api("POST", "/api/repos", { path: REPO }, token);
  const repos = added.json?.repos ?? [];
  const repo = repos.find((r) => r.localPath === REPO) ?? repos.find((r) => r.id !== "demo");
  if (!repo) {
    out.failures.push(`repo add failed: ${added.code} ${added.raw.slice(0, 200)}`);
    return out;
  }
  const created = await api("POST", "/api/reviews", { repoId: repo.id, branch: "feature" }, token);
  if (created.code !== 201) {
    out.failures.push(`review create -> ${created.code}: ${created.raw.slice(0, 300)}`);
    return out;
  }
  const id = created.json.review.id;
  const createdAt = created.json.review.createdAt;
  out.reviewId = id;
  console.log(`review ${id} created; watching stream…`);
  const wsP = wsWatch(id, token, 10000);

  // Poll until the pipeline looks done (root cards + findings + hunk
  // summaries) or the budget runs out.
  let snap = null;
  const deadline = Date.now() + 12 * 60_000;
  let lastRev = 1;
  let revGrowth = 0;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const got = await api("GET", `/api/reviews/${id}`, undefined, token);
    if (got.code !== 200) {
      out.failures.push(`GET review -> ${got.code}`);
      break;
    }
    snap = got.json;
    if (snap.rev !== lastRev) {
      revGrowth += 1;
      lastRev = snap.rev;
    }
    const root = (snap.pages ?? []).find((p) => p.id === "root");
    const findings = (snap.pages ?? []).filter((p) => p.kind === "finding");
    const hunksum = (snap.hunkStates ?? []).filter((h) => h.summary).length;
    const totalHunks = (snap.files ?? []).reduce((n, f) => n + (f.hunks ?? []).length, 0);
    console.log(
      `  t=${Math.round((Date.now() - t0) / 1000)}s rev=${snap.rev} root=${root?.cards.length ?? 0} findings=${findings.length} hunksum=${hunksum}/${totalHunks}`,
    );
    const plausibleTotal = totalHunks > 0 ? hunksum >= totalHunks : true;
    const liveJobs = await api("GET", `/api/jobs?review=${id}`, undefined, token);
    const busy = ((liveJobs.json?.jobs ?? []).some((j) => j.state === "running" || j.state === "backing-off" || j.state === "queued"));
    if (runRates) {
      const estimate = spend.usd() + costOf(runJobsUsage(liveJobs.json?.jobs), runRates);
      if (estimate > live.capUsd) {
        out.failures.push(`cap exceeded mid-run: priced spend ${formatUsd(estimate)} > cap ${formatUsd(live.capUsd)} (failed jobs included)`);
        break;
      }
    }
    if ((root?.cards.length ?? 0) >= 2 && findings.length >= 1 && plausibleTotal && !busy) break;
    if (Date.now() > deadline) {
      out.failures.push("pipeline did not finish within 12 minutes");
      break;
    }
  }
  const ws = await wsP;
  out.wsStreamed = ws.streamed;
  out.wsBytes = ws.bytes;
  if (!ws.streamed) out.failures.push("no WS bytes observed in the first 10s (streaming unconfirmed)");

  if (!snap) {
    out.failures.push("no snapshot captured");
    return out;
  }
  const u = snap.usageTotals ?? {};
  out.secondsToFirstCard =
    u.firstCardAt && createdAt ? Math.round((u.firstCardAt - createdAt) / 100) / 10 : null;
  out.inputTokens = u.inputTokens ?? 0;
  out.cachedTokens = u.cachedTokens ?? 0;
  out.outputTokens = u.outputTokens ?? 0;
  out.cacheHitRate = u.cacheHitRate ?? null;
  out.rev = snap.rev;
  out.revGrowth = revGrowth;

  // Citations: total vs unverified (repaired are stored resolved).
  let total = 0;
  let unverified = 0;
  for (const page of snap.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const b of card.blocks ?? []) {
        for (const c of b.citations ?? []) {
          total += 1;
          if (c.unverified) unverified += 1;
        }
        for (const it of b.items ?? []) {
          for (const c of it.citations ?? []) {
            total += 1;
            if (c.unverified) unverified += 1;
          }
        }
      }
    }
  }
  out.citationsTotal = total;
  out.citationsUnverified = unverified;
  let logUnverified = 0;
  for (const e of snap.logTail ?? []) {
    const p = e.payload;
    if (p && typeof p.unverified === "number") logUnverified += p.unverified;
  }
  out.logUnverifiedSum = logUnverified;

  // Critic: separate finding pages + suggested comments (comment-kind
  // replies carrying `suggested`, NOT marked for PR).
  const findingPages = (snap.pages ?? []).filter((p) => p.kind === "finding");
  out.findingPages = findingPages.map((p) => ({ id: p.id, title: p.title, confidence: p.confidence, cards: p.cards.length }));
  const replyText = (r) => {
    const first = (r.blocks ?? []).find((b) => b && typeof b === "object" && b.type === "paragraph");
    const s = first?.text?.standard;
    return (typeof s === "string" ? s : "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  };
  const suggested = (snap.annotations ?? []).filter((a) => (a.replies ?? []).some((r) => r.suggested));
  out.suggestedComments = suggested.map((a) => ({
    anchor: a.anchor?.host,
    post: a.post,
    text: (replyText((a.replies ?? []).find((r) => r.suggested) ?? {}).slice(0, 120)),
  }));
  for (const s of suggested) {
    if (s.post !== false) out.failures.push(`suggested comment ${s.id} marked for PR`);
  }
  if (findingPages.length === 0) out.failures.push("critic produced no finding pages");

  // Hunk hide rules: never hide a guide-cited hunk; never hide one-liners.
  const cited = new Set();
  const citeRe = /diff:([^:]+):(\d+)-?(\d+)?/g;
  const allTargets = [];
  for (const page of snap.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const b of card.blocks ?? []) {
        for (const c of b.citations ?? []) allTargets.push(c.target);
      }
    }
  }
  const hunksByHash = new Map();
  for (const f of snap.files ?? []) for (const h of f.hunks ?? []) hunksByHash.set(h.contentHash, { file: f, hunk: h });
  for (const t of allTargets) {
    const m = /diff:([^:]+):(\d+)(?:-(\d+))?/.exec(t);
    if (!m) continue;
    void citeRe;
    const [, fk, s1, s2] = m;
    const start = Number(s1);
    const end = Number(s2 ?? s1);
    const file = (snap.files ?? []).find((f) => f.fileKey === fk);
    if (!file) continue;
    for (const h of file.hunks) {
      if (start <= h.newEnd && end >= h.newStart) cited.add(h.contentHash);
    }
  }
  out.hideViolations = [];
  for (const [hash, { file, hunk }] of hunksByHash) {
    const hidden = hunk.hiddenReason;
    if (!hidden) continue;
    if (cited.has(hash)) out.hideViolations.push(`${file.path}@${hash.slice(0, 8)} hidden but cited`);
    if ((hunk.added ?? 0) + (hunk.removed ?? 0) <= 1) out.hideViolations.push(`${file.path}@${hash.slice(0, 8)} one-line hidden`);
  }
  if (out.hideViolations.length > 0) out.failures.push(`hide-rule violations: ${out.hideViolations.join("; ")}`);

  const jobs = await api("GET", `/api/jobs?review=${id}`, undefined, token);
  out.jobStates = (jobs.json?.jobs ?? []).map((j) => `${j.kind}:${j.state}`).join(",");
  const errored = (jobs.json?.jobs ?? []).filter((j) => j.state === "error");
  for (const j of errored) out.failures.push(`job ${j.kind} error: ${(j.error ?? "").slice(0, 160)}`);
  // Final priced spend for this run (all jobs, failed included).
  out.spendUsd = null;
  if (runRates) {
    const usage = runJobsUsage(jobs.json?.jobs);
    spend.add(usage);
    out.spendUsd = Math.round(spend.usd() * 10000) / 10000;
    out.usageByJobs = usage;
    try {
      spend.check(`live pipeline (${run.name})`);
    } catch (e) {
      out.failures.push(e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`done ${run.name}: firstCard=${out.secondsToFirstCard}s tokens=${out.inputTokens}/${out.cachedTokens}/${out.outputTokens} hitRate=${out.cacheHitRate} cites=${total} unverified=${unverified}`);
  if (out.failures.length > 0) console.log(`FAILURES:\n- ${out.failures.join("\n- ")}`);
  return out;
}

let spend = null;
let piRates = null;

const main = async () => {
  // Free pre-checks before any spend (issue #292): pi must list each pi
  // model, and the cap is priced from pi's own catalogue.
  try {
    const piPicks = [...new Set(RUNS.flatMap((r) => [r.main, r.small]).filter((p) => p.provider === "pi").map((p) => p.model))];
    for (const model of piPicks) precheckModelOffered(PI_CMD, { provider: "pi", model });
    let piEntry = null;
    if (piPicks.length > 0) {
      const catalog = await fetchPiCatalog(PI_CMD);
      piEntry = findCatalogEntry(catalog, { provider: "pi", model: piPicks[0] });
      piRates = assertPriced(piEntry, { provider: "pi", model: piPicks[0], allowUnpriced: live.allowUnpriced });
    } else {
      console.log(`live pre-check: no pi runs selected; skipping pi --list-models and catalogue pricing (tokens reported, no USD conversion)`);
    }
    const oneTurn = piEntry ? worstCaseTurnUsd(piRates, piEntry) : null;
    preflightCap({
      capUsd: live.capUsd,
      worstCaseUsd: oneTurn === null ? null : oneTurn * RUNS.length,
      what: `${RUNS.length} run(s) worst case`,
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  spend = createSpendTracker(piRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, live.capUsd);
  makeScratchRepo();
  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  let logged = "";
  child.stdout.on("data", (d) => (logged += d.toString()));
  child.stderr.on("data", (d) => (logged += d.toString()));
  const health = () =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
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
    console.error(`service did not start:\n${logged.slice(-2000)}`);
    child.kill("SIGKILL");
    process.exit(1);
  }
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const results = [];
  try {
    for (const run of RUNS) results.push(await runOnce(run, token));
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }

  const lines = [
    "# Live pipeline results (M3 smoke, real agents)",
    "",
    `Date: ${new Date().toISOString()}. Service: built \`dist/index.js\`, default ACP runner. Scratch repo: 3 files (calc.py, test_calc.py, notes.md), temp dir, deleted below.`,
    "",
    "## Settings per run",
    "",
    ...RUNS.map((r) => `- ${r.name}: main \`${r.main.provider}/${r.main.model}\`, small \`${r.small.provider}/${r.small.model}\``),
    "",
  ];
  for (const r of results) {
    lines.push(
      `## ${r.run}`,
      "",
      `- review: \`${r.reviewId ?? "(none)"}\`, rev ${r.rev ?? "?"}, rev growth during watch: ${r.revGrowth ?? "?"}`,
      `- time to first card: ${r.secondsToFirstCard ?? "(unknown)"}s`,
      `- tokens: input ${r.inputTokens}, cached ${r.cachedTokens}, output ${r.outputTokens}, cache-hit rate ${r.cacheHitRate ?? "(n/a)"}`,
      `- citations: ${r.citationsTotal ?? 0} total, ${r.citationsUnverified ?? 0} unverified (repaired are stored resolved; per-stage unverified sums in logTail: ${r.logUnverifiedSum ?? 0})`,
      `- WS streaming in first 10s: ${r.wsStreamed ? `yes (${r.wsBytes} bytes)` : "NO (failure recorded)"}`,
      `- findings: ${JSON.stringify(r.findingPages ?? [])}`,
      `- suggested comments: ${JSON.stringify(r.suggestedComments ?? [])}`,
      `- hide violations: ${(r.hideViolations ?? []).length === 0 ? "none" : JSON.stringify(r.hideViolations)}`,
      `- jobs: ${r.jobStates ?? "(unknown)"}`,
      `- failures: ${(r.failures ?? []).length === 0 ? "none" : ""}`,
      ...((r.failures ?? []).map((f) => `  - ${f}`)),
      "",
    );
  }
  lines.push("## Notes", "", "- Repairs: the pipeline sends at most one repair turn per reply when ≥2 citations fail validation; the follow-up text is not persisted as a separate job.", "");
  const doc = path.join(ROOT, "docs", "live-pipeline-results.md");
  fs.writeFileSync(doc, `${lines.join("\n")}\n`);
  console.log(`wrote ${doc}`);
  const spendUsd = Math.round(spend.usd() * 10000) / 10000;
  const report = writeLiveReport({
    dir: path.join(ROOT, "test-results"),
    task: "pipeline",
    provider: live.provider,
    model: live.model,
    rates: piRates,
    capUsd: live.capUsd,
    spendUsd,
    tokens: spend.totals,
    results,
    failures: results.flatMap((r) => (r.failures ?? []).map((f) => `${r.run}: ${f}`)),
  });
  console.log(`live pipeline: priced spend ${formatUsd(spendUsd)} of cap ${formatUsd(live.capUsd)} (failed jobs included); report ${report}`);
  try {
    fs.rmSync(REPO, { recursive: true, force: true });
    fs.rmSync(DATA, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
  const failed = results.some((r) => (r.failures ?? []).length > 0);
  process.exit(failed ? 1 : 0);
};

await main();
