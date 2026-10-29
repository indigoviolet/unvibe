/*global console process fetch setTimeout*/
/**
 * Live submit test (M6). Authorized sandbox: github.com/indigoviolet/lvu.
 *
 * Run as: node ./scripts/live-submit.mjs [--provider pi|claude|codex] [--model <ref>] --cap <usd> [--allow-unpriced]
 *
 * Default provider is pi with muse-spark-1.3-contributor (issue
 * #292): creating the review starts the pipeline's agent turns in the
 * background, so this test DOES involve agent turns and selects the live
 * model through the shared helper (scripts/live-pi-lib.mjs) before
 * ingesting the PR. The submit path itself is deterministic gh writes, not
 * agent work. --cap (USD) is required; free pre-checks (pi --list-models,
 * pi catalogue pricing) run before any GitHub write or spend, priced spend
 * is snapshotted at submit time (the background pipeline may still be
 * running — the report says so), and the spend + results land in
 * test-results/live-submit-*.json (gitignored).
 *
 * Rules (do not widen without the user):
 * - Clone fresh into a temp dir; never touch ~/dev/lvu or its worktrees.
 * - One branch `unvibe-submit-test` with a trivial docs-only change.
 * - ONE draft PR titled "[unvibe test] do not merge" (reuse if it exists).
 * - Never merge, never push any other branch, never touch other PRs/issues.
 * - Leave the PR open as a draft and print its URL.
 *
 * Flow: clone -> branch -> push -> draft PR -> start built service ->
 * ingest PR -> two For-PR threads (diff-line + general) -> edit description
 * -> dryRun preview -> submit -> verify via `gh api` that exactly one review
 * carries those comments and the body changed.
 *
 * Not run by `mise run check` (only by `mise run test:live:submit`).
 */
import { execFileSync, spawn } from "node:child_process";
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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OWNER = "indigoviolet";
const REPO = "lvu";
const BRANCH = "unvibe-submit-test";
const PR_TITLE = "[unvibe test] do not merge";
const INLINE_TEXT = "Unvibe live test inline comment (M6)";
const GENERAL_TEXT = "Unvibe live test general comment (M6)";
const DESC_MARK = "[edited by Unvibe live test]";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function ghEnv() {
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  return env;
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", env: ghEnv(), ...opts }).trim();
}

function log(...args) {
  console.log("[live-submit]", ...args);
}

async function waitForHealth(port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`service did not become healthy on port ${port}`);
}

async function api(base, token, method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 500)}`);
  return json;
}

async function main() {
  // Shared live flags (issue #292): --cap is required. Free pre-checks run
  // before any GitHub write or spend.
  const live = (() => {
    try {
      return parseLiveArgs(process.argv.slice(2));
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
  let piRates = null;
  let piEntry = null;
  try {
    if (live.provider === "pi") {
      precheckModelOffered(PI_CMD, { provider: "pi", model: live.model });
      const catalog = await fetchPiCatalog(PI_CMD);
      piEntry = findCatalogEntry(catalog, { provider: "pi", model: live.model });
      piRates = assertPriced(piEntry, { provider: "pi", model: live.model, allowUnpriced: live.allowUnpriced });
    } else {
      console.log(`live pre-check: provider ${live.provider} is not pi; skipping pi --list-models and catalogue pricing (tokens reported, no USD conversion)`);
    }
    const oneTurn = piEntry ? worstCaseTurnUsd(piRates, piEntry) : null;
    preflightCap({ capUsd: live.capUsd, worstCaseUsd: oneTurn, what: "submit run worst case" });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const spend = createSpendTracker(piRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, live.capUsd);
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-clone-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-data-"));
  log("clone dir:", cloneDir);
  let child = null;
  try {
    run("gh", ["auth", "status"]);
    run("git", ["clone", `https://github.com/${OWNER}/${REPO}.git`, cloneDir]);
    run("git", ["fetch", "origin"], { cwd: cloneDir });
    const remoteHeads = run("git", ["ls-remote", "--heads", "origin", BRANCH], { cwd: cloneDir });
    if (remoteHeads) {
      run("git", ["fetch", "origin", `${BRANCH}:${BRANCH}`], { cwd: cloneDir });
      run("git", ["checkout", BRANCH], { cwd: cloneDir });
      run("git", ["pull", "--ff-only", "origin", BRANCH], { cwd: cloneDir });
      log("reusing remote branch", BRANCH);
    } else {
      run("git", ["checkout", "-b", BRANCH], { cwd: cloneDir });
      log("created branch", BRANCH);
    }

    const docsDir = path.join(cloneDir, "docs");
    if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
    const testFile = path.join(docsDir, "unvibe-submit-test.md");
    fs.writeFileSync(testFile, `# Unvibe submit test\n\nDo not merge. Sandbox file for the Unvibe M6 submit live test.\n`, "utf8");
    run("git", ["add", "docs/unvibe-submit-test.md"], { cwd: cloneDir });
    const status = run("git", ["status", "--porcelain"], { cwd: cloneDir });
    if (status) {
      run("git", ["-c", "user.email=unvibe-test@example.com", "-c", "user.name=unvibe-test", "commit", "-m", "docs: unvibe submit test file"], { cwd: cloneDir });
      log("committed trivial docs change");
    } else {
      log("no changes to commit");
    }
    run("git", ["push", "-u", "origin", BRANCH], { cwd: cloneDir });
    log("pushed", BRANCH);

    // `gh` is a mise shim here: a fresh clone containing an untrusted
    // mise.toml makes every `gh` call from the service fail. Trust the
    // clone (user-level trust db; the repo itself is untouched) so ingest
    // and submit can run `gh` with cwd inside it.
    if (fs.existsSync(path.join(cloneDir, "mise.toml"))) {
      run("mise", ["trust", path.join(cloneDir, "mise.toml")]);
      log("trusted clone mise.toml");
    }

    let prList = JSON.parse(run("gh", ["pr", "list", "--head", BRANCH, "--json", "number,title,url,isDraft"], { cwd: cloneDir }) || "[]");
    if (prList.length === 0) {
      const base = run("gh", ["repo", "view", `${OWNER}/${REPO}`, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { cwd: cloneDir });
      run("gh", ["pr", "create", "--title", PR_TITLE, "--body", "Unvibe M6 live submit test. Do not merge.", "--draft", "--base", base, "--head", BRANCH], { cwd: cloneDir });
      prList = JSON.parse(run("gh", ["pr", "list", "--head", BRANCH, "--json", "number,title,url,isDraft"], { cwd: cloneDir }) || "[]");
    }
    if (prList.length === 0) throw new Error("could not find or create the test PR");
    const pr = prList[0];
    const prNumber = pr.number;
    const prUrl = pr.url;
    log(`PR #${prNumber}: ${prUrl} (draft=${pr.isDraft})`);

    // Start the built service.
    const distIndex = path.join(root, "packages", "service", "dist", "index.js");
    if (!fs.existsSync(distIndex)) throw new Error(`build missing: ${distIndex} (run mise run build first)`);
    const port = 4519;
    child = spawn("node", [distIndex], {
      env: { ...process.env, UNVIBE_DATA_DIR: dataDir, UNVIBE_PORT: String(port), UNVIBE_ALLOW_LIVE_AGENT: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (d) => process.stdout.write(`[service] ${d}`));
    child.stderr.on("data", (d) => process.stderr.write(`[service] ${d}`));
    await waitForHealth(port);
    const token = fs.readFileSync(path.join(dataDir, "token"), "utf8").trim();
    const base = `http://127.0.0.1:${port}`;

    // Single model-selection place (issue #292): the review create below
    // starts the pipeline's agent turns in the background, so the live
    // model is selected first. Fails loudly when the runner does not offer
    // it (the runner offers every pi model) — before any review exists.
    // (This harness's api() helper throws on non-2xx, so the 400 becomes
    // the refusal detail selectLiveModel reports.)
    const put = async (patch) => {
      try {
        const body = await api(base, token, "PUT", "/api/settings", patch);
        return { ok: true, status: 200, detail: "", body };
      } catch (e) {
        return { ok: false, status: 400, detail: e instanceof Error ? e.message : String(e), body: null };
      }
    };
    await selectLiveModel(put, { provider: live.provider, model: live.model }, ["main", "small"]);

    const reposRes = await api(base, token, "POST", "/api/repos", { path: cloneDir });
    const repo = reposRes.repos.find((r) => r.localPath === cloneDir) ?? reposRes.repos[0];
    log("repo:", repo.id, `${repo.owner}/${repo.name}`);

    const snap = await api(base, token, "POST", "/api/reviews", { repoId: repo.id, pr: prNumber });
    const reviewId = snap.review.id;
    log("review:", reviewId, "head:", snap.version.headSha.slice(0, 7), "files:", snap.files.length);

    const file = snap.files[0];
    if (!file) throw new Error("PR has no changed files; cannot place an inline comment");
    const row = file.hunks.flatMap((h) => h.lines).find((l) => l.newLine !== undefined);
    if (!row) throw new Error("no commentable line found");
    const fileKey = file.fileKey;
    const line = row.newLine;
    log("inline target:", file.path, line);

    const inline = await api(base, token, "POST", `/api/reviews/${reviewId}/comments`, {
      anchor: { where: "diff-line", fileKey, line },
      quote: "",
      note: true,
      text: INLINE_TEXT,
    });
    await api(base, token, "PATCH", `/api/reviews/${reviewId}/comments/${inline.id}`, { post: true });
    log("inline thread:", inline.id);

    const paraMatch = (snap.description?.html ?? "").match(/id="(d-p\d+)"/);
    if (!paraMatch) throw new Error("no description paragraph found");
    const general = await api(base, token, "POST", `/api/reviews/${reviewId}/comments`, {
      anchor: { where: "description", paragraphId: paraMatch[1] },
      quote: "",
      note: true,
      text: GENERAL_TEXT,
    });
    await api(base, token, "PATCH", `/api/reviews/${reviewId}/comments/${general.id}`, { post: true });
    log("general thread:", general.id);

    const origHtml = snap.description.html;
    const editedHtml = origHtml.replace(/(<p[^>]*>)([\s\S]*?)(<\/p>)/, `$1$2 ${DESC_MARK}$3`);
    if (editedHtml === origHtml) throw new Error("could not edit the first description paragraph");
    await api(base, token, "PUT", `/api/reviews/${reviewId}/description`, { html: editedHtml });
    log("description edited");

    const dry = await api(base, token, "POST", `/api/reviews/${reviewId}/submit`, { dryRun: true });
    log("preview:", JSON.stringify(dry.preview, null, 2).slice(0, 2000));

    const submitted = await api(base, token, "POST", `/api/reviews/${reviewId}/submit`, {});
    log("submit:", JSON.stringify(submitted));

    // Verify through gh api. The sandbox PR is reused across runs by design,
    // so prior runs may have left matching reviews/comments already — expect
    // at least one (audit #10: repeat runs accumulate; the submit itself
    // posted exactly one review with both comments, asserted above via
    // `submitted.commentCount === 2`).
    const reviewsJson = JSON.parse(run("gh", ["api", `repos/${OWNER}/${REPO}/pulls/${prNumber}/reviews`, "--paginate"], { cwd: cloneDir }));
    const matchingReviews = reviewsJson.filter((r) => (r.body ?? "").includes(GENERAL_TEXT));
    const commentsJson = JSON.parse(run("gh", ["api", `repos/${OWNER}/${REPO}/pulls/${prNumber}/comments`], { cwd: cloneDir }));
    const matchingComments = commentsJson.filter((c) => (c.body ?? "").includes(INLINE_TEXT));
    const prBody = run("gh", ["pr", "view", String(prNumber), "--json", "body", "--jq", ".body"], { cwd: cloneDir });
    log(`reviews with general text: ${matchingReviews.length} (of ${reviewsJson.length})`);
    log(`inline comments with marker: ${matchingComments.length} (of ${commentsJson.length})`);
    log(`description edited: ${prBody.includes(DESC_MARK)}`);
    if (submitted.commentCount !== 2) throw new Error(`expected the submit to post 2 comments, got ${submitted.commentCount}`);
    if (matchingReviews.length < 1) throw new Error(`expected at least 1 review with the general comment, found ${matchingReviews.length}`);
    if (matchingComments.length < 1) throw new Error("inline comment not found on the PR");
    if (!prBody.includes(DESC_MARK)) throw new Error("PR body does not contain the edit marker");

    // Priced spend snapshot at submit time (all jobs, failed included). The
    // background pipeline may still be running, so this is partial by
    // design — the report says whether jobs were still live.
    let spendUsd = null;
    let jobsLive = null;
    if (piRates) {
      const jobsRes = await api(base, token, "GET", `/api/jobs?review=${reviewId}`);
      const jobs = jobsRes.jobs ?? [];
      const usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
      for (const j of jobs) {
        if (!j.usage) continue;
        usage.inputTokens += j.usage.inputTokens ?? 0;
        usage.cachedReadTokens += j.usage.cachedReadTokens ?? j.usage.cachedTokens ?? 0;
        usage.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
        usage.outputTokens += j.usage.outputTokens ?? 0;
      }
      spend.add(usage);
      spendUsd = Math.round(spend.usd() * 10000) / 10000;
      jobsLive = jobs.filter((j) => ["running", "backing-off", "queued"].includes(j.state)).length;
      spend.check("live submit");
    }
    const report = writeLiveReport({
      dir: path.join(root, "test-results"),
      task: "submit",
      provider: live.provider,
      model: live.model,
      rates: piRates,
      capUsd: live.capUsd,
      spendUsd,
      tokens: spend.totals,
      backgroundPipelineStillLive: jobsLive,
      results: [{ pr: prUrl, commentCount: submitted.commentCount }],
      failures: [],
    });
    log(`priced spend ${spendUsd === null ? "(tokens only, non-pi run)" : formatUsd(spendUsd)} of cap ${formatUsd(live.capUsd)}; background pipeline still live: ${jobsLive ?? "(unknown, non-pi run)"}; report ${report}`);

    console.log(`\nLIVE TEST PASSED\nPR: ${prUrl}\n`);
  } finally {
    if (child) child.kill();
    fs.rmSync(cloneDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`LIVE TEST FAILED: ${(err && err.message) || err}`);
  process.exit(1);
});
