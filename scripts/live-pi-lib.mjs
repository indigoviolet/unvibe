/*global console process setTimeout clearTimeout*/
// Shared live-test helper (issue #292): pi-first defaults, free pre-checks,
// pi-catalogue pricing, the spend cap, and test-results reports.
//
// Every switched `test:live:*` harness uses this module, so the owner
// answer on #292 (the settings shape for the pi model) lands in one place:
// `selectLiveModel` (marked TODO below). Until that answer, the helper goes
// through the settings API and fails loudly when the model is not offered.
//
// What each harness does, in order (all free until the run itself):
//   1. `parseLiveArgs` — --provider/--model overrides (default pi +
//      muse-spark-1.3-contributor) and the required --cap (USD).
//   2. `precheckModelOffered` — `pi --list-models <model>`; refuses before
//      any spend when the model is not listed. Sends no prompt.
//   3. `fetchPiCatalog` + `assertPriced` — pi's own RPC catalogue
//      (`get_available_models`, no prompt, no spend) prices the cap from
//      pi's reported per-M-token cost. Missing or all-zero cost refuses
//      unless --allow-unpriced is passed; never assumed $0.
//   4. `preflightCap` — refuses to start when the worst case is over the cap.
//   5. `selectLiveModel` — the single settings-API call (TODO #292).
//   6. During the run, `createSpendTracker` counts every token from the
//      first one, failed jobs included, and stops the run over the cap.
//   7. `writeLiveReport` — spend + per-task results to a gitignored file
//      under test-results/, not only to the console.
//
// Only `test:live:*` harnesses use real pi (the owner's login in place —
// never read, copy or point anything at ~/.pi or other credentials). Every
// other test uses the scratch-HOME stub binaries (AGENTS.md).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Owner rule (#292): live tests default to pi with this model. */
export const LIVE_PI_DEFAULT = { provider: "pi", model: "muse-spark-1.3-contributor" };

/**
 * Parse the shared live flags out of a harness argv. Harness-specific flags
 * (--port, --case, --caps, …) are ignored here. --cap is required: every
 * live run needs an explicit spend cap from the owner.
 */
export function parseLiveArgs(argv) {
  const out = {
    provider: LIVE_PI_DEFAULT.provider,
    model: LIVE_PI_DEFAULT.model,
    capUsd: null,
    allowUnpriced: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--provider") out.provider = argv[++i] ?? "";
    else if (arg === "--model") out.model = argv[++i] ?? "";
    else if (arg === "--cap") out.capUsd = Number(argv[++i]);
    else if (arg === "--allow-unpriced") out.allowUnpriced = true;
  }
  if (!out.provider) throw new Error("live: --provider needs a value (e.g. --provider pi)");
  if (!out.model) throw new Error("live: --model needs a value (e.g. --model muse-spark-1.3-contributor)");
  if (out.capUsd === null || !Number.isFinite(out.capUsd) || out.capUsd <= 0) {
    throw new Error(
      `live: --cap <usd> is required (every live run needs an explicit spend cap; e.g. --cap 5). Got: ${argv.includes("--cap") ? "invalid value" : "missing"}.`,
    );
  }
  return out;
}

/** Split "provider/id" into { provider, id }; a bare id has provider null. */
export function splitModelRef(ref) {
  const i = ref.indexOf("/");
  if (i < 0) return { provider: null, id: ref };
  return { provider: ref.slice(0, i), id: ref.slice(i + 1) };
}

/**
 * pi command for spawning (array, for use with spawn/spawnSync + shell off).
 * Tests pass an explicit stub; harnesses default to UNVIBE_PI_BIN or PATH.
 */
export function resolvePiCmd(env = process.env) {
  const override = (env.UNVIBE_PI_BIN ?? "").trim();
  if (override) return [override];
  return ["pi"];
}

/** Free check: `pi --list-models <pattern>` output (no prompt, no spend). */
export function runPiListModels(piCmd, pattern, { env = process.env, timeoutMs = 30000 } = {}) {
  const r = spawnSync(piCmd[0], [...piCmd.slice(1), "--list-models", pattern], {
    encoding: "utf8",
    timeout: timeoutMs,
    env,
  });
  if (r.error) {
    throw new Error(
      `live pre-flight: cannot run ${[...piCmd, "--list-models", pattern].join(" ")}: ${r.error.message}. Is pi installed and on PATH? (https://pi.dev)`,
    );
  }
  return `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
}

/** Parse `pi --list-models` output into [{ provider, model }] rows. */
export function parseListModels(output) {
  const rows = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^provider\s+model\b/i.test(trimmed)) continue; // header
    if (/^no models matching\b/i.test(trimmed)) return [];
    const cols = trimmed.split(/\s+/);
    if (cols.length < 2) continue;
    rows.push({ provider: cols[0], model: cols[1] });
  }
  return rows;
}

/**
 * Free pre-check (pi only): refuse before any spend when pi does not list
 * the model. Non-pi providers skip this — their own CLIs and logins are the
 * prerequisite, as before. Returns the matched { provider, model } row.
 */
export function precheckModelOffered(piCmd, { provider, model }, { env = process.env } = {}) {
  if (provider !== "pi") {
    console.log(`live pre-check: provider ${provider} is not pi; skipping pi --list-models (its own CLI login applies)`);
    return { provider, model };
  }
  const output = runPiListModels(piCmd, model, { env });
  const rows = parseListModels(output);
  const want = splitModelRef(model);
  const hit = rows.find((r) => r.model === want.id && (!want.provider || r.provider === want.provider));
  if (!hit) {
    const saw = rows.length === 0 ? "no models" : rows.slice(0, 8).map((r) => `${r.provider}/${r.model}`).join(", ");
    throw new Error(
      `live pre-flight: pi does not offer model ${JSON.stringify(model)} (pi --list-models found: ${saw}). Refusing to run before any spend.`,
    );
  }
  console.log(`live pre-check: pi offers ${hit.provider}/${hit.model} (free pi --list-models, no prompt sent)`);
  return hit;
}

/**
 * Free catalogue read: pi's own RPC `get_available_models` over an
 * ephemeral `--no-session --offline` probe (no prompt, no model call, no
 * spend). Returns the raw model entries (each may carry cost, contextWindow
 * and maxTokens).
 */
export async function fetchPiCatalog(piCmd, { env = process.env, timeoutMs = 60000 } = {}) {
  const child = spawn(
    piCmd[0],
    [
      ...piCmd.slice(1),
      "--mode",
      "rpc",
      "--no-session",
      "--offline",
      "--no-context-files",
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
    ],
    {
      cwd: os.tmpdir(),
      env: { ...env, PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", PI_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const kill = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  };
  try {
    let buf = "";
    const seen = [];
    let seq = 0;
    const pending = new Map();
    child.stdout?.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let event = null;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        seen.push(event);
        const resolve = pending.get(event?.id);
        if (resolve && event?.type === "response") {
          pending.delete(event.id);
          resolve(event);
        }
      }
    });
    const call = (cmd) =>
      new Promise((resolve, reject) => {
        const id = `live-pi-${++seq}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`live pricing: pi ${cmd.type} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
        pending.set(id, (event) => {
          clearTimeout(timer);
          resolve(event);
        });
        try {
          child.stdin?.write(JSON.stringify({ ...cmd, id }) + "\n");
        } catch (e) {
          clearTimeout(timer);
          pending.delete(id);
          reject(e);
        }
      });
    const exited = new Promise((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", () => resolve(null));
    });
    const state = await Promise.race([
      call({ type: "get_state" }),
      exited.then(() => {
        throw new Error("live pricing: pi exited before answering get_state");
      }),
    ]);
    if (state?.success !== true) throw new Error(`live pricing: pi get_state failed: ${state?.error ?? "unknown error"}`);
    const res = await Promise.race([
      call({ type: "get_available_models" }),
      exited.then(() => {
        throw new Error("live pricing: pi exited before answering get_available_models");
      }),
    ]);
    if (res?.success !== true) throw new Error(`live pricing: pi get_available_models failed: ${res?.error ?? "unknown error"}`);
    const models = res?.data?.models;
    if (!Array.isArray(models)) throw new Error("live pricing: pi get_available_models returned no models array");
    return models;
  } finally {
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    kill();
  }
}

/** Find the catalogue entry for a selected model (provider-qualified when given). */
export function findCatalogEntry(catalog, { provider, model }) {
  if (provider !== "pi") return null;
  const want = splitModelRef(model);
  return catalog.find((e) => e?.id === want.id && (!want.provider || e?.provider === want.provider)) ?? null;
}

/**
 * Price the cap from pi's own reported cost (USD per M tokens). Missing or
 * all-zero cost refuses unless --allow-unpriced is passed; never assumes $0.
 * Returns the { input, output, cacheRead, cacheWrite } rates.
 */
export function assertPriced(entry, { provider, model, allowUnpriced = false }) {
  const cost = entry?.cost;
  const rates = {
    input: Number(cost?.input ?? 0),
    output: Number(cost?.output ?? 0),
    cacheRead: Number(cost?.cacheRead ?? 0),
    cacheWrite: Number(cost?.cacheWrite ?? 0),
  };
  const priced = [rates.input, rates.output, rates.cacheRead, rates.cacheWrite].some((v) => Number.isFinite(v) && v > 0);
  const label = `${provider}/${splitModelRef(model).id}`;
  if (!priced) {
    const why = !entry
      ? `pi reports no catalogue entry for ${JSON.stringify(label)}`
      : `pi reports no cost for ${JSON.stringify(label)} (all zeros)`;
    console.log(`live pricing: ${why}; refusing to run (pass --allow-unpriced to run blind — never assumed $0)`);
    if (!allowUnpriced) {
      throw new Error(
        `live pricing: ${why}. Refusing to run before any spend (pass --allow-unpriced to run blind; spend then reports $0 and is untracked).`,
      );
    }
    return rates;
  }
  console.log(
    `live pricing: ${label} at $${rates.input}/M in, $${rates.output}/M out, $${rates.cacheRead}/M cache-read, $${rates.cacheWrite}/M cache-write (pi catalogue)`,
  );
  return rates;
}

/** USD cost of a token usage at catalogue rates. */
export function costOf(usage, rates) {
  const u = {
    inputTokens: usage?.inputTokens ?? 0,
    cachedReadTokens: usage?.cachedReadTokens ?? usage?.cachedTokens ?? 0,
    cachedWriteTokens: usage?.cachedWriteTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  };
  return (
    (u.inputTokens * rates.input +
      u.outputTokens * rates.output +
      u.cachedReadTokens * rates.cacheRead +
      u.cachedWriteTokens * rates.cacheWrite) /
    1_000_000
  );
}

export function formatUsd(n) {
  return `$${(Math.round(n * 10000) / 10000).toFixed(4)}`;
}

/**
 * Worst-case cost of one full-context turn at catalogue rates: a full
 * context window of input (counted as fresh input, a cache read and a cache
 * write — the upper bound) plus a full max-output reply. Null when the
 * catalogue gives no window (then only the live tracker guards the cap).
 */
export function worstCaseTurnUsd(rates, entry) {
  const ctx = Number(entry?.contextWindow ?? 0);
  const maxOut = Number(entry?.maxTokens ?? 0);
  if (!ctx && !maxOut) return null;
  return (ctx * (rates.input + rates.cacheRead + rates.cacheWrite) + maxOut * rates.output) / 1_000_000;
}

/**
 * Pre-flight: refuse to start when the worst case is over the cap.
 * `units` is the harness's count of planned top-level runs (runs, cases,
 * caps, providers) — the floor the cap must at least cover; the live spend
 * tracker below is the real guard during the run.
 */
export function preflightCap({ capUsd, worstCaseUsd, what = "worst case" }) {
  if (worstCaseUsd !== null && worstCaseUsd > capUsd) {
    throw new Error(
      `live pre-flight: ${what} ≈ ${formatUsd(worstCaseUsd)} exceeds cap ${formatUsd(capUsd)}. Raise --cap or reduce scope; refusing to start before any spend.`,
    );
  }
  console.log(`live pre-flight: ${what} ≈ ${worstCaseUsd === null ? "(unknown; live tracker guards)" : formatUsd(worstCaseUsd)} within cap ${formatUsd(capUsd)}`);
  return worstCaseUsd;
}

/**
 * Live spend tracker: every token counts from the first one, failed jobs
 * included (harnesses feed usage from all jobs, whatever their state).
 * `check` throws once the priced spend passes the cap.
 */
export function createSpendTracker(rates, capUsd) {
  const totals = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
  return {
    totals,
    add(usage) {
      totals.inputTokens += usage?.inputTokens ?? 0;
      totals.cachedReadTokens += usage?.cachedReadTokens ?? usage?.cachedTokens ?? 0;
      totals.cachedWriteTokens += usage?.cachedWriteTokens ?? 0;
      totals.outputTokens += usage?.outputTokens ?? 0;
      return totals;
    },
    usd() {
      return costOf(totals, rates);
    },
    check(what = "live run") {
      const spend = costOf(totals, rates);
      if (spend > capUsd) {
        throw new Error(
          `live cap: ${what} spend ${formatUsd(spend)} exceeds cap ${formatUsd(capUsd)} (tokens so far: ${JSON.stringify(totals)}). Stopping before further spend.`,
        );
      }
      return spend;
    },
  };
}

/** Settings patch putting every listed role on the selected model. */
export function liveModelPatch({ provider, model }, roles = ["main", "small"]) {
  const patch = {};
  for (const role of roles) patch[role] = { provider, model };
  return patch;
}

// Single place every live harness selects its model (issue #292, owner
// decision option 1): the pi runner offers every model pi offers, so the
// pick goes through the normal settings API with pi's bare id
// (muse-spark-1.3-contributor — the runner maps it to provider meta), and
// the model appears in the Settings pickers like any other model.
/**
 * Single place every live harness selects its model: PUT the pick through
 * the normal settings API (fails loudly when not offered) and return the body.
 * `putSettings` adapts the harness's HTTP helper to
 * `(patch) => ({ ok, status, detail })`.
 */
export async function selectLiveModel(putSettings, { provider, model }, roles = ["main", "small"]) {
  const patch = liveModelPatch({ provider, model }, roles);
  const res = await putSettings(patch);
  if (!res.ok) {
    throw new Error(
      `live model: settings refused ${provider}/${model} for ${roles.join(",")} (HTTP ${res.status}): ${res.detail}. Refusing to run before any spend.`,
    );
  }
  console.log(`live model: settings now ${roles.map((r) => `${r}=${provider}/${model}`).join(", ")}`);
  return res.body;
}

/**
 * Write the spend + per-task report to a gitignored file under
 * test-results/ (not only to the console). Returns the file path.
 */
export function writeLiveReport({ dir, task, ...payload }) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = task.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  const file = path.join(dir, `live-${safe}-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ task, finishedAt: new Date().toISOString(), ...payload }, null, 2)}\n`);
  console.log(`live report: ${file}`);
  return file;
}
