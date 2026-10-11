/*global console process setTimeout Buffer */
// Global-install check (PRD §14 install path), run as:
//   mise run check-global-install
// which first runs `mise run release` (self-contained tree + tarball +
// local `release` branch), then this script. Every install below is a
// LITERAL command from the README, with no extra flags:
//
//   npm install -g github:<org>/unvibe#release   (git ref; git+file://<bare>#release stands in locally)
//   npm install -g https://…/unvibe-<v>.tgz       (tarball file)
//
// Each source is installed with npm 11 (default `npm`) and npm 10
// (`npx --yes npm@10`; `--npms 11,10` selects), into a temp prefix with a
// FRESH isolated npm cache, then verified from OUTSIDE the repo: bin link,
// doctor, start/status/stop, prompts + web shell, demo pipeline end to end,
// readiness (agent executables), adapter bundles present, no lifecycle
// script ran, no agent platform binary downloaded, install time + size.
//
// The release tree needs no build and defines no lifecycle scripts, so npm's
// git-URL handling (dangling symlinks / preparation races on npm 10/11 for
// packages with `prepare`) is out of the picture by construction.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const PORT = Number(flag("--port", "4593"));
const NPMS = String(flag("--npms", process.env.UNVIBE_GLOBAL_CHECK_NPMS ?? "11,10"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PHASES = String(flag("--phases", process.env.UNVIBE_GLOBAL_CHECK_PHASES ?? "tarball,git"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-global-"));
console.log(`work dir: ${TMP}`);

/** `npm` (11) or `npx --yes npm@10` argv prefix for the literal install. */
function npmArgv(npmMajor) {
  if (npmMajor === "10") return ["npx", "--yes", "npm@10"];
  return ["npm"];
}

function npmVersion(npmMajor, env) {
  const [cmd, ...rest] = npmArgv(npmMajor);
  const r = spawnSync(cmd, [...rest, "--version"], { encoding: "utf8", timeout: 120_000, env });
  return (r.stdout ?? "").trim();
}

/** Portable directory size (bytes); `du -b` is GNU-only, macOS lacks it. */
function dirSizeBytes(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory() && !e.isSymbolicLink()) walk(full);
        else if (e.isFile()) total += fs.statSync(full).size;
      } catch {
        // ignore unreadable entries
      }
    }
  };
  try {
    walk(dir);
  } catch {
    // missing dir: size 0
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function s(secMs) {
  return `${(secMs / 1000).toFixed(1)}s`;
}

/**
 * The service spawns the ACP adapters as subprocesses from files shipped in
 * the release tree (`packages/service/dist/adapters/*.js`) — they must exist
 * in the installed copy. (No adapter packages exist in node_modules anymore.)
 */
function checkAdapterBundles(installedPkgDir, label) {
  for (const f of ["packages/service/dist/index.js", "packages/service/dist/adapters/claude.js", "packages/service/dist/adapters/codex.js"]) {
    const full = path.join(installedPkgDir, f);
    assert(fs.existsSync(full), `${label}: ships ${f}`);
  }
  for (const pkg of ["@openai/codex-linux-x64", "@anthropic-ai/claude-agent-sdk-linux-x64"]) {
    const [scope, name] = pkg.split("/");
    assert(
      !fs.existsSync(path.join(installedPkgDir, "node_modules", scope, name)),
      `${label}: no bundled platform binary ${pkg} in the installed tree`,
    );
  }
}

/** No platform-binary tarball may have been fetched into this install's isolated cache. */
function checkCacheClean(cacheDir, label) {
  let hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith(".json")) {
          const text = fs.readFileSync(full, "utf8");
          if (/codex-(linux|darwin|win32)-|claude-agent-sdk-(linux|darwin|win32)-/.test(text)) hits.push(full);
        }
      } catch {
        // ignore
      }
    }
  };
  try {
    walk(path.join(cacheDir, "_cacache", "index-v5"));
  } catch {
    // no index yet: clean
  }
  assert(hits.length === 0, `${label}: npm cache fetched no agent platform binaries${hits.length ? ` (${hits[0]})` : ""}`);
}

const health = (port) =>
  new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });

async function waitFor(port, want, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await health(port)) === want) return true;
    if (Date.now() >= deadline) {
      console.error(`timeout waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function api(port, token, method, apiPath, body) {
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
        res.on("end", () => resolve({ code: res.statusCode, body: data }));
      },
    );
    req.on("error", () => resolve({ code: 0, body: "" }));
    if (payload) req.write(payload);
    req.end();
  });
}

function simpleGet(port, getPath, headers) {
  return new Promise((resolve) => {
    http
      .get({ host: "127.0.0.1", port, path: getPath, headers }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ code: res.statusCode, body }));
      })
      .on("error", () => resolve({ code: 0, body: "" }));
  });
}

/**
 * Verify one global install: bin link, no lifecycle scripts, doctor,
 * start/status/stop outside the repo, prompts + web shell, readiness agent
 * executables, demo pipeline end to end, adapter bundles, size + time.
 */
async function verifyInstall({ prefix, port, label, cacheDir, npmOut }) {
  const HOME = path.join(TMP, `home-${label}`);
  const DATA = path.join(TMP, `data-${label}`);
  fs.mkdirSync(HOME, { recursive: true });
  const ENV = {
    ...process.env,
    HOME,
    UNVIBE_DATA_DIR: DATA,
    UNVIBE_PORT: String(port),
    UNVIBE_IDLE_MS: "0",
    UNVIBE_AGENT: "replay",
    PATH: `${path.join(prefix, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  const UNVIBE = path.join(prefix, "bin", "unvibe");
  assert(fs.existsSync(UNVIBE), `${label}: unvibe bin linked in the prefix`);
  const installedPkg = path.join(prefix, "lib", "node_modules", "unvibe");
  const installedPkgJson = path.join(installedPkg, "package.json");
  assert(fs.existsSync(installedPkgJson), `${label}: installed package dir exists`);
  {
    const st = fs.lstatSync(installedPkg, { throwIfNoEntry: false });
    const isLink = !!st?.isSymbolicLink();
    const real = fs.existsSync(installedPkg);
    assert(!isLink && real, `${label}: installed package is a real dir, not a symlink`);
  }
  // No lifecycle scripts: the release package.json defines none, and npm
  // must not have run any (would print `> pkg@ver <script>` lines).
  try {
    const pj = JSON.parse(fs.readFileSync(installedPkgJson, "utf8"));
    assert(!pj.scripts || Object.keys(pj.scripts).length === 0, `${label}: release package.json defines no scripts`);
    assert(!pj.workspaces, `${label}: release package.json defines no workspaces`);
    assert(!pj.devDependencies, `${label}: release package.json has no devDependencies`);
  } catch {
    assert(false, `${label}: installed package.json parses`);
  }
  assert(!/^> \S+ (postinstall|prepare|preinstall|install)\b/m.test(npmOut), `${label}: no lifecycle script ran during install`);

  checkAdapterBundles(installedPkg, label);
  console.log(`${label}: install size ${mb(dirSizeBytes(prefix))} (prefix ${prefix})`);

  const runInstalled = (cmdArgs) => {
    const r = spawnSync(process.execPath, [UNVIBE, ...cmdArgs], {
      cwd: os.tmpdir(),
      env: ENV,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
  };

  const d = runInstalled(["doctor"]);
  assert(d.code === 0, `${label}: unvibe doctor exits 0 from the global install`);
  assert(d.out.includes("[ok] node"), `${label}: doctor reports node`);
  assert(d.out.includes("data dir"), `${label}: doctor reports the data dir`);
  for (const cli of ["claude", "codex"]) {
    const line = d.out.split("\n").find((l) => l.includes(`] ${cli}:`)) ?? "";
    assert(/\[ok\]|\[warn\]/.test(line), `${label}: doctor reports ${cli}`);
    // Either the executable it will run (path) or the install hint when missing.
    assert(/at |does not install it for you/.test(line), `${label}: doctor says which ${cli} executable it runs (or how to install it)`);
  }

  const start = runInstalled(["start"]);
  assert(start.code === 0, `${label}: unvibe start (${start.out.trim().split("\n")[0]})`);
  assert(await waitFor(port, true, 20_000, `${label} health`), `${label}: globally installed service answers`);
  assert(start.out.includes(`http://127.0.0.1:${port}/?token=`), `${label}: start prints the token URL`);

  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const prompts = await simpleGet(port, "/api/prompts", { authorization: `Bearer ${token}` });
  assert(prompts.code === 200 && prompts.body.includes("instructions"), `${label}: prompts resolve from the installed package`);
  const shell = await simpleGet(port, "/start.html");
  assert(shell.code === 200, `${label}: web dist serves from the installed package`);

  const readiness = await simpleGet(port, "/api/readiness", { authorization: `Bearer ${token}` });
  assert(readiness.code === 200, `${label}: readiness answers from the installed package`);
  try {
    const checks = JSON.parse(readiness.body)?.checks ?? [];
    for (const role of ["agent:main", "agent:small", "agent:secondOpinion"]) {
      const c = checks.find((x) => x.id === role);
      assert(!!c && typeof c.summary === "string" && c.summary.length > 0, `${label}: readiness reports ${role}`);
    }
  } catch {
    assert(false, `${label}: readiness body parses`);
  }

  const created = await api(port, token, "POST", "/api/reviews", { repoId: "demo" });
  assert(created.code === 201, `${label}: installed copy creates the demo review`);
  let id = null;
  try {
    id = JSON.parse(created.body)?.review?.id ?? null;
  } catch {
    id = null;
  }
  assert(typeof id === "string", `${label}: demo review has an id`);
  if (typeof id === "string") {
    let done = false;
    for (let i = 0; i < 40 && !done; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const got = await api(port, token, "GET", `/api/reviews/${id}`);
      try {
        const s = JSON.parse(got.body);
        const root = (s.pages ?? []).find((p) => p.id === "root");
        done =
          got.code === 200 &&
          (root?.cards ?? []).length >= 6 &&
          !(root?.cards ?? []).some((c) => c.pending) &&
          (s.pages ?? []).filter((p) => p.kind === "finding").length >= 2;
        if (done) {
          assert(true, `${label}: demo pipeline completes from the installed copy`);
          const hunks = (s.hunkStates ?? []).filter((h) => h.summary).length;
          assert(hunks >= 8, `${label}: demo hunk summaries present (${hunks})`);
        }
      } catch {
        // keep polling
      }
    }
    assert(done, `${label}: demo snapshot ends complete (60s budget)`);
  }

  const status = runInstalled(["status"]);
  assert(status.code === 0 && status.out.includes("running"), `${label}: status reports running`);
  const stop = runInstalled(["stop"]);
  assert(stop.code === 0 && (await waitFor(port, false, 10_000, `${label} shutdown`)), `${label}: stop shuts the service down`);

  checkCacheClean(cacheDir, label);
}

/**
 * Run one literal install command with an isolated npm cache, timing it.
 * Returns { code, out, ms }.
 */
function installLiteral({ npmMajor, installArgs, prefix, label }) {
  const cacheDir = path.join(TMP, `cache-${label}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const [cmd, ...rest] = npmArgv(npmMajor);
  const ENV = {
    ...process.env,
    npm_config_cache: cacheDir,
    PATH: `${path.join(prefix, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  };
  const t0 = Date.now();
  const r = spawnSync(cmd, [...rest, "install", "-g", ...installArgs, "--prefix", prefix], {
    cwd: os.tmpdir(),
    env: ENV,
    encoding: "utf8",
    timeout: 600_000,
  });
  const ms = Date.now() - t0;
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), ms, cacheDir };
}

async function phaseTarball(npmMajor, tarballPath, port) {
  const label = `tarball-npm${npmMajor}`;
  console.log(`--- ${label}: npm ${npmVersion(npmMajor, process.env)} ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal README command (tarball URL variant).
  const { code, out, ms, cacheDir } = installLiteral({
    npmMajor,
    installArgs: [tarballPath],
    prefix: PREFIX,
    label,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g <tarball> --prefix (exit ${code})`);
  if (code !== 0) return;
  console.log(`${label}: install time ${s(ms)}`);
  await verifyInstall({ prefix: PREFIX, port, label, cacheDir, npmOut: out });
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

async function phaseGit(npmMajor, bareRepo, port) {
  const label = `git-npm${npmMajor}`;
  console.log(`--- ${label}: npm ${npmVersion(npmMajor, process.env)} ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal README command (git-ref variant); git+file://<bare>#release
  // stands in for github:<org>/unvibe#release with no network to GitHub.
  const { code, out, ms, cacheDir } = installLiteral({
    npmMajor,
    installArgs: [`git+file://${bareRepo}#release`],
    prefix: PREFIX,
    label,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g git+file://<bare>#release --prefix (exit ${code})`);
  if (code !== 0) return;
  console.log(`${label}: install time ${s(ms)}`);
  await verifyInstall({ prefix: PREFIX, port, label, cacheDir, npmOut: out });
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

const main = async () => {
  // `mise run release` must have run first (check-global-install chains it):
  // the tarball and the local `release` branch are its outputs.
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const tarballPath = path.join(ROOT, `unvibe-${version}.tgz`);
  assert(fs.existsSync(tarballPath), `release tarball exists (${tarballPath}; run \`mise run release\` first)`);
  const hasRelease = spawnSync("git", ["rev-parse", "--verify", "--quiet", "refs/heads/release"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert(hasRelease.status === 0, "local release branch exists (run `mise run release` first)");
  if (failures > 0) process.exit(1);

  // A local bare clone stands in for github:<org>/unvibe (same mechanism).
  const BARE = path.join(TMP, "upstream.git");
  const clone = spawnSync("git", ["clone", "--bare", ROOT, BARE], { encoding: "utf8", timeout: 120_000 });
  assert(clone.status === 0, "bare clone for the git-ref source");
  if (clone.status !== 0) process.exit(1);

  let port = PORT;
  for (const npmMajor of NPMS) {
    if (PHASES.includes("tarball")) {
      await phaseTarball(npmMajor, tarballPath, port);
      port += 10;
    }
    if (PHASES.includes("git")) {
      await phaseGit(npmMajor, BARE, port);
      port += 10;
    }
  }
  if (failures > 0) {
    console.error(`${failures} assertion(s) failed (work dir kept: ${TMP})`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("global-install-check: all green");
};

await main();
