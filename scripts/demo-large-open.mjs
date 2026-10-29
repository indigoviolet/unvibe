/*global console process setTimeout Buffer */
// Cached large-demo open (issue #309), run as:
//   mise run demo:large:open [-- --mode browse|interactive] [--port N] [--cap <usd>]
//
// Copies the build cache into a fresh scratch data dir (so every pass
// starts clean), repairs the managed clone + worktree links for the new
// location, and starts the built service on a temp port.
//
// - Browse mode (default, free): `UNVIBE_AGENT=none`; everything already
//   built is visible, no tokens spent.
// - Interactive mode: real pi + muse-spark-1.3-contributor for Ask,
//   Explain and Add diagram, with a $0.25/pass cap enforced the same way
//   as the build (catalogue pricing, spend tracked from the first token
//   across all jobs, service stopped over the cap).
//
// Refuses when the cache schema version does not match (rebuild, no
// migration). Requires a build (`mise run build`).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import {
  DEMO_LARGE_MODEL,
  copyCacheToScratch,
  demoLargeCacheDir,
  parseDemoLargeOpenArgs,
  readDemoLargeMeta,
  repairWorktrees,
  rewriteManagedPaths,
} from "./demo-large-lib.mjs";
import {
  assertPriced,
  costOf,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  precheckModelOffered,
  preflightCap,
  resolvePiCmd,
  worstCaseTurnUsd,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "Cached large-demo open (issue #309): fresh scratch dir, temp port, browse free / interactive capped.",
    "",
    "Usage: mise run demo:large:open [-- --mode browse|interactive] [--port N] [--cap <usd>]",
    "",
    "  --mode  browse (default, free, UNVIBE_AGENT=none) or interactive (real pi, $0.25/pass cap)",
    "  --port  service port (default: a free temp port)",
    "  --cap   interactive spend cap in USD (default 0.25)",
  ].join("\n"));
  process.exit(0);
}
const opts = (() => {
  try {
    return parseDemoLargeOpenArgs(args);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
})();
const CACHE = demoLargeCacheDir();

function pickFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      s.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });
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

const main = async () => {
  const meta = (() => {
    try {
      return readDemoLargeMeta(CACHE);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(2);
    }
  })();
  const port = opts.port ?? (await pickFreePort());
  if (!fs.existsSync(CLI)) {
    console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
    process.exit(2);
  }  if (!port) {
    console.error("demo-large open: could not pick a free port (pass --port N)");
    process.exit(2);
  }

  // Interactive mode spends: free pre-checks before the service starts.
  let piRates = null;
  if (opts.mode === "interactive") {
    const PI_CMD = resolvePiCmd();
    try {
      precheckModelOffered(PI_CMD, DEMO_LARGE_MODEL);
      const catalog = await fetchPiCatalog(PI_CMD);
      const entry = findCatalogEntry(catalog, DEMO_LARGE_MODEL);
      piRates = assertPriced(entry, { ...DEMO_LARGE_MODEL, allowUnpriced: false });
      preflightCap({ capUsd: opts.capUsd, worstCaseUsd: worstCaseTurnUsd(piRates, entry), what: "one full-context turn" });
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(2);
    }
  }

  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-demo-large-open-"));
  const copied = copyCacheToScratch(CACHE, DATA);
  const db = new DatabaseSync(path.join(DATA, "unvibe.db"));
  let rewritten = 0;
  try {
    rewritten = rewriteManagedPaths(db, DATA);
  } finally {
    db.close();
  }
  const repaired = repairWorktrees(DATA);

  const ENV = { ...process.env, UNVIBE_DATA_DIR: DATA, UNVIBE_PORT: String(port), UNVIBE_IDLE_MS: "0" };
  if (opts.mode === "browse") {
    ENV.UNVIBE_AGENT = "none";
  } else {
    delete ENV.UNVIBE_AGENT; // default ACP runner (real pi)
    ENV.UNVIBE_ALLOW_LIVE_AGENT = "1";
  }
  console.log(`demo-large open (${opts.mode}): ${meta.owner}/${meta.name}#${meta.pr} review ${meta.reviewId} from ${CACHE} (${copied.join(",")}; ${rewritten} repo path(s), ${repaired} worktree(s) fixed)`);
  const child = spawn(process.execPath, [CLI], { env: ENV, stdio: "inherit" });
  const cleanup = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      try {
        fs.rmSync(DATA, { recursive: true, force: true });
      } catch {
        // best-effort
      }
      process.exit(0);
    }, 2000).unref();
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const health = () =>
    new Promise((resolve) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (res) => {
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
    if (child.exitCode !== null) {
      console.error("demo-large open: service exited before becoming healthy");
      process.exit(1);
    }
  }
  if (!up) {
    console.error("demo-large open: service did not start");
    cleanup();
    return;
  }
  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  if (opts.mode === "interactive") {
    // Point every role at pi + muse-spark (the cache was built that way;
    // re-assert after the copy so Ask/Explain/diagram spend on the cap).
    const patch = {
      main: { ...DEMO_LARGE_MODEL, effort: "" },
      small: { ...DEMO_LARGE_MODEL, effort: "" },
      secondOpinion: { ...DEMO_LARGE_MODEL, effort: "" },
    };
    const r = await api(port, "PUT", "/api/settings", patch, token);
    if (r.code !== 200) {
      console.error(`demo-large open: settings refused pi model (HTTP ${r.code}): ${r.raw.slice(0, 200)}`);
      cleanup();
      return;
    }
    console.log(`demo-large open: interactive roles on ${DEMO_LARGE_MODEL.provider}/${DEMO_LARGE_MODEL.model}, cap ${formatUsd(opts.capUsd)} per pass`);
    // Spend watcher: polls priced usage over ALL jobs (failed included)
    // and stops the service over the cap, like the build does.
    const watch = async () => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 10000));
        if (child.exitCode !== null) return;
        const jobs = await api(port, "GET", `/api/jobs?review=${meta.reviewId}`, undefined, token);
        if (jobs.code !== 200) continue;
        const u = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
        for (const j of jobs.json?.jobs ?? []) {
          if (!j.usage) continue;
          u.inputTokens += j.usage.inputTokens ?? 0;
          u.cachedReadTokens += j.usage.cachedReadTokens ?? j.usage.cachedTokens ?? 0;
          u.cachedWriteTokens += j.usage.cachedWriteTokens ?? 0;
          u.outputTokens += j.usage.outputTokens ?? 0;
        }
        const spend = costOf(u, piRates);
        if (spend > opts.capUsd) {
          console.error(`\ndemo-large open: spend ${formatUsd(spend)} passed cap ${formatUsd(opts.capUsd)} — stopping the service (reopen for a fresh pass)`);
          cleanup();
          return;
        }
      }
    };
    watch();
  } else {
    console.log("demo-large open: browse mode is free (UNVIBE_AGENT=none); interactive needs --mode interactive");
  }
  console.log(`open: http://127.0.0.1:${port}/?token=${token} (Ctrl-C stops and wipes the scratch dir)`);
  await new Promise(() => {});
};

await main();
