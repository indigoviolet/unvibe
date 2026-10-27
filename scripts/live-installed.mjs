/*global console process setTimeout clearTimeout fetch */
// `mise run test:live:installed` (needs UNVIBE_LIVE=1, agent logins; tiny
// token spend: one short prompt per provider). Runs one real session per
// provider (pi, claude, codex; UNVIBE_LIVE_PROVIDERS filters) against the
// INSTALLED copy (`mise run release` first): for claude/codex it spawns
// `<prefix>/lib/node_modules/unvibe/packages/service/dist/adapters/*.js`
// with CODEX_PATH / CLAUDE_CODE_EXECUTABLE pointed at the user's real CLIs,
// drives initialize → session/new (codename system prompt) → prompt → close
// over ACP stdio, and asserts:
// - the adapter's direct child process IS the user's executable (ps tree),
// - the session works end to end (codename recalled, usage reported).
// pi is native (no adapter bundle ships): the check boots the installed
// service copy and asserts it offers the pi provider and lists pi models
// end to end (no prompt, no spend). Session-level pi coverage stays in
// `test:live:pi` (unchanged by #292).
// Read-only posture, fork, and cache behaviour are covered by `test:live`
// against the source tree; this proves the shipped bundles work.
//
// Default providers are pi, claude and codex (issue #292 adds pi and keeps
// the others because the test is per provider); --provider/--model/--cap
// follow the shared live helper (scripts/live-pi-lib.mjs): --cap (USD) is
// required, free pi pre-checks run before any spend, and the spend +
// per-provider report also lands in test-results/live-installed-*.json
// (gitignored).
import { spawnSync, spawn } from "node:child_process";
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
  worstCaseTurnUsd,
  writeLiveReport,
} from "./live-pi-lib.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(ROOT, "package.json"));
const acp = req("@agentclientprotocol/sdk");

const LIVE = process.env.UNVIBE_LIVE === "1";
const DEFAULT_PROVIDERS = ["pi", "claude", "codex"];
const rawArgs = process.argv.slice(2);

if (!LIVE) {
  console.log("live-installed: skipped (needs UNVIBE_LIVE=1)");
  process.exit(0);
}

// Shared live flags (issue #292): --cap is required; --model selects the pi
// model. --provider (comma-separated) overrides UNVIBE_LIVE_PROVIDERS.
const live = (() => {
  try {
    return parseLiveArgs(rawArgs);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const PROVIDERS = (rawArgs.includes("--provider")
  ? live.provider
  : (process.env.UNVIBE_LIVE_PROVIDERS ?? DEFAULT_PROVIDERS.join(","))
).split(",").map((s) => s.trim()).filter(Boolean);
for (const p of PROVIDERS) {
  if (!["pi", "claude", "codex"].includes(p)) {
    console.error(`unknown provider ${JSON.stringify(p)} (want pi|claude|codex, comma-separated)`);
    process.exit(2);
  }
}
const PI_CMD = resolvePiCmd();
let piRates = null; // catalogue rates when the pi model is priced
const tokenTotals = { inputTokens: 0, outputTokens: 0 };

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.error(`FAIL: ${msg}`);
};
const ok = (msg) => console.log(`ok: ${msg}`);

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  const p = (r.stdout ?? "").split("\n").map((s) => s.trim()).filter(Boolean)[0];
  return p && fs.existsSync(p) ? p : null;
}

function binVersion(bin) {
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 15000 });
  const m = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : "(unknown)";
}

/** Direct children (pid + command) of a pid, via ps (macOS + Linux). */
function childProcesses(pid) {
  const r = spawnSync("ps", ["-eo", "pid,ppid,args"], { encoding: "utf8", timeout: 10000 });
  const out = [];
  for (const line of (r.stdout ?? "").split("\n").slice(1)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (m && Number(m[2]) === pid) out.push({ pid: Number(m[1]), args: m[3] });
  }
  return out;
}

function installRelease() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const tarball = path.join(ROOT, `unvibe-${version}.tgz`);
  if (!fs.existsSync(tarball)) {
    console.error(`live-installed: missing ${tarball} — run \`mise run release\` first`);
    process.exit(1);
  }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-installed-"));
  const PREFIX = path.join(TMP, "prefix");
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal install, no flags (the release needs none).
  const r = spawnSync("npm", ["install", "-g", tarball, "--prefix", PREFIX], {
    cwd: os.tmpdir(),
    encoding: "utf8",
    timeout: 600_000,
  });
  if (r.status !== 0) {
    console.error((r.stdout ?? "").slice(-2000), (r.stderr ?? "").slice(-2000));
    console.error("live-installed: release install failed");
    process.exit(1);
  }
  return { TMP, PREFIX };
}

async function runProvider({ provider, adapterEntry }) {
  const cli = provider === "claude" ? "claude" : "codex";
  const bin = which(cli);
  if (!bin) {
    fail(`${provider}: ${cli} CLI not found on PATH`);
    return;
  }
  const ver = binVersion(bin);
  const codename = `QUOKKA-${provider === "claude" ? "C" : "X"}7-INST`;
  const systemPrompt = `Your codename for this session is ${codename}. When asked for your codename, reply with just the codename and nothing else.`;

  const proc = spawn(process.execPath, [adapterEntry], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(provider === "claude" ? { CLAUDE_CODE_EXECUTABLE: bin } : { CODEX_PATH: bin }),
      NO_BROWSER: "1",
    },
  });
  if (!proc.stdin || !proc.stdout || !proc.pid) {
    fail(`${provider}: adapter failed to spawn`);
    return;
  }
  const diesel = setTimeout(() => {
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
  }, 240_000);
  diesel.unref?.();

  let procError = null;
  try {
    const input = Writable.toWeb(proc.stdin);
    const output = Readable.toWeb(proc.stdout);
    const stream = acp.ndJsonStream(input, output);
    const pending = [];
    const wakers = new Set();
    const wake = () => { for (const w of [...wakers]) w(); };
    const conn = acp.client({ name: "unvibe-live-installed" })
      .onRequest("session/request_permission", async () => ({ outcome: { outcome: "cancelled" } }))
      .onNotification("session/update", async (ctx) => {
        pending.push(ctx.params?.update);
        wake();
      })
      .connect(stream);
    const request = (method, params) => conn.agent.request(method, params);

    await request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    });

    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-inst-"));
    const meta =
      provider === "claude"
        ? { systemPrompt }
        : { jetbrains: { air: { version: 1, customInstructions: systemPrompt } } };
    const created = await request("session/new", { cwd, mcpServers: [], _meta: meta });
    const sessionId = created?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) throw new Error("session/new returned no sessionId");

    // The process that actually runs must be the user's executable.
    await new Promise((r) => setTimeout(r, 3000));
    const kids = childProcesses(proc.pid);
    const hit = kids.find((k) => k.args.startsWith(bin) || k.args.includes(` ${bin} `) || k.args === bin);
    if (!hit) throw new Error(`no child of the adapter runs ${bin} (saw: ${kids.map((k) => k.args.slice(0, 80)).join(" | ") || "none"})`);
    ok(`${provider}: runs the user's executable (${bin} ${ver}; child: ${hit.args.slice(0, 100)})`);

    const seen = [];
    const respP = request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "What is your codename? Reply with just the codename and nothing else." }],
    });
    let resp = null;
    let done = false;
    const waiter = (async () => {
      try { resp = await respP; } catch (e) { procError = e; } finally { done = true; wake(); }
    })();
    void waiter;
    while (!done) {
      while (pending.length > 0) seen.push(pending.shift());
      if (done) break;
      await new Promise((resolve) => {
        wakers.add(resolve);
        setTimeout(resolve, 50);
      });
      for (const w of [...wakers]) { wakers.delete(w); }
    }
    while (pending.length > 0) seen.push(pending.shift());
    if (procError) throw procError;
    const text = seen
      .filter((u) => u?.sessionUpdate === "agent_message_chunk" && u?.content?.type === "text")
      .map((u) => u.content.text)
      .join("");
    if (!text.includes(codename)) throw new Error(`codename not recalled (got: ${JSON.stringify(text).slice(0, 200)})`);
    const usage = resp?.usage;
    if (!usage) throw new Error("prompt response carried no usage");
    tokenTotals.inputTokens += usage.inputTokens ?? 0;
    tokenTotals.outputTokens += usage.outputTokens ?? 0;
    ok(`${provider}: session works end to end from the installed copy (codename recalled, stop=${resp?.stopReason ?? "?"})`);
    try {
      await request("session/close", { sessionId });
    } catch { /* best-effort */ }
    fs.rmSync(cwd, { recursive: true, force: true });
  } catch (e) {
    fail(`${provider}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(diesel);
    try { proc.kill(); } catch { /* gone */ }
    try { proc.stdin?.destroy(); } catch { /* gone */ }
  }
}

/**
 * pi from the installed copy (issue #292): pi is native, so no adapter
 * bundle ships. Boot the installed service, then assert it offers the pi
 * provider and lists pi models end to end. No prompt is sent, no tokens
 * spend. Session-level pi coverage stays in `test:live:pi`.
 */
async function runPiInstalled({ installed }) {
  const entry = path.join(installed, "packages", "service", "dist", "index.js");
  if (!fs.existsSync(entry)) {
    fail(`pi: missing installed service bundle (${entry})`);
    return;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-live-inst-pi-"));
  const proc = spawn(process.execPath, [entry], {
    env: { ...process.env, UNVIBE_DATA_DIR: dataDir, UNVIBE_PORT: "0", UNVIBE_REPO_ROOTS: "", UNVIBE_IDLE_MS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stop = async () => {
    try { proc.kill("SIGTERM"); } catch { /* gone */ }
    await new Promise((r) => setTimeout(r, 2000));
    try { proc.kill("SIGKILL"); } catch { /* gone */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };
  try {
    const started = await new Promise((resolve) => {
      let out = "";
      const timer = setTimeout(() => resolve(null), 30000);
      proc.stdout?.on("data", (d) => {
        out += d.toString();
        const m = out.match(/Unvibe listening on (http:\/\/(?:unvibe\.localhost|127\.0\.0\.1):\d+)\/\?token=(\S+)/);
        if (m) {
          clearTimeout(timer);
          resolve({ origin: m[1], token: m[2] });
        }
      });
      proc.stderr?.on("data", () => { /* service logs drain here */ });
      proc.on("exit", () => { clearTimeout(timer); resolve(null); });
    });
    if (!started) throw new Error("installed service did not print a token URL");
    const get = async (urlPath) => {
      const res = await fetch(`${started.origin}${urlPath}`, { headers: { authorization: `Bearer ${started.token}` } });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* raw */ }
      return { status: res.status, json, text };
    };
    const providers = await get("/api/providers");
    if (providers.status !== 200) throw new Error(`GET /api/providers -> ${providers.status}: ${providers.text.slice(0, 200)}`);
    if (!(providers.json?.providers ?? []).includes("pi")) {
      throw new Error(`installed service does not offer pi (providers: ${JSON.stringify(providers.json?.providers)}); is pi on PATH?`);
    }
    ok("pi: installed service offers the pi provider");
    const models = await get("/api/models?provider=pi");
    if (models.status !== 200) throw new Error(`GET /api/models?provider=pi -> ${models.status}: ${(models.text ?? "").slice(0, 200)}`);
    const ids = (models.json?.models ?? []).map((m) => (typeof m === "string" ? m : m.id));
    if (ids.length === 0) throw new Error("installed service lists no pi models");
    const want = live.model.includes("/") ? live.model.split("/").slice(1).join("/") : live.model;
    if (ids.includes(want)) ok(`pi: installed service lists ${live.model} (login present)`);
    else ok(`pi: installed service lists ${ids.length} pi model(s) (static fallback; ${live.model} needs a login)`);
  } catch (e) {
    fail(`pi: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await stop();
  }
}

const main = async () => {
  // Free pre-checks before any spend (issue #292): pi must list the model,
  // and the cap is priced from pi's own catalogue.
  let piEntry = null;
  try {
    if (PROVIDERS.includes("pi")) {
      precheckModelOffered(PI_CMD, { provider: "pi", model: live.model });
      const catalog = await fetchPiCatalog(PI_CMD);
      piEntry = findCatalogEntry(catalog, { provider: "pi", model: live.model });
      piRates = assertPriced(piEntry, { provider: "pi", model: live.model, allowUnpriced: live.allowUnpriced });
      const oneTurn = worstCaseTurnUsd(piRates, piEntry);
      preflightCap({
        capUsd: live.capUsd,
        worstCaseUsd: oneTurn === null ? null : oneTurn * PROVIDERS.length,
        what: `${PROVIDERS.length} provider(s) worst case`,
      });
    } else {
      console.log(`live pre-check: pi not selected; skipping pi --list-models and catalogue pricing`);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const spend = createSpendTracker(piRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, live.capUsd);
  const { TMP, PREFIX } = installRelease();
  const installed = path.join(PREFIX, "lib", "node_modules", "unvibe");
  const perProvider = [];
  for (const provider of PROVIDERS) {
    if (provider === "pi") {
      await runPiInstalled({ installed });
      perProvider.push({ provider, kind: "installed-service", spendUsd: 0, tokens: { inputTokens: 0, outputTokens: 0 } });
      continue;
    }
    const entry = path.join(installed, "packages", "service", "dist", "adapters", `${provider}.js`);
    if (!fs.existsSync(entry)) {
      fail(`${provider}: missing installed adapter bundle (${entry})`);
      continue;
    }
    const before = { ...tokenTotals };
    await runProvider({ provider, adapterEntry: entry });
    perProvider.push({
      provider,
      kind: "installed-adapter",
      spendUsd: null,
      tokens: { inputTokens: tokenTotals.inputTokens - before.inputTokens, outputTokens: tokenTotals.outputTokens - before.outputTokens },
    });
  }
  const spendUsd = Math.round(spend.usd() * 10000) / 10000;
  const report = writeLiveReport({
    dir: path.join(ROOT, "test-results"),
    task: "installed",
    provider: PROVIDERS.join(","),
    model: live.model,
    rates: piRates,
    capUsd: live.capUsd,
    spendUsd,
    tokens: { ...tokenTotals, cachedReadTokens: 0, cachedWriteTokens: 0 },
    results: perProvider,
    failures: failures > 0 ? [`${failures} failure(s)`] : [],
  });
  console.log(`live installed: priced pi spend ${formatUsd(spendUsd)} of cap ${formatUsd(live.capUsd)} (claude/codex runs report tokens only); report ${report}`);
  if (failures > 0) {
    console.error(`${failures} failure(s) (work dir kept: ${TMP})`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("live-installed: all green (sessions ran from the installed copy)");
};

await main();
