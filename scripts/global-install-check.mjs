/*global console process setTimeout Buffer */
// Global-install check (PRD §14 install path), run as:
//   mise run check-global-install
// which first runs `mise run release` (self-contained tree + tarball +
// local `release` branch), then this script. Every install below is a
// LITERAL command from the README, with no extra flags:
//
//   npm install -g github:<org>/unvibe#release      (git ref; git+file://<bare>#<ref> stands in locally)
//   npm install -g github:<org>/unvibe#release-rc   (release-candidate ref; same mechanism)
//   npm install -g https://…/unvibe-<v>.tgz          (tarball file)
//
// --release-ref <name> (or UNVIBE_RELEASE_REF) selects the git ref under test
// (default `release`); --tarball <path> selects the tarball explicitly.
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
import { createRunRoot, onExit, removeDir } from "./tmp-guard.mjs";

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
// Which local release branch the git phase installs (release for finals,
// release-rc for candidates). Set by the release workflow to the ref it pushed.
const RELEASE_REF = flag("--release-ref", process.env.UNVIBE_RELEASE_REF ?? process.env.UNVIBE_RELEASE_BRANCH ?? "release");
// Explicit tarball path (the release workflow passes the versioned file);
// otherwise resolved from UNVIBE_RELEASE_VERSION or package.json.
const TARBALL_FLAG = flag("--tarball", process.env.UNVIBE_RELEASE_TARBALL ?? null);

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

// Per-run temp root (issue #24): prefixes, caches, homes and data dirs
// all live under one fresh dir, removed by exact path on success,
// failure and interruption. Never globs the system temp dir.
const TMP = createRunRoot();
console.log(`work dir: ${TMP}`);
// Interruption net: remove only our own root. Installed daemons started
// by verifyInstall are stopped on their normal path (`stop` after each
// phase); on SIGINT/SIGTERM the root removal still prevents temp leaks,
// and any surviving daemon keeps running only until stopped by hand.
onExit(() => removeDir(TMP));

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
 * The service spawns the ACP adapters and the update helper as subprocesses
 * from files shipped in the release tree (`packages/service/dist/...`) —
 * they must exist in the installed copy. (No adapter packages exist in
 * node_modules anymore.)
 */
function checkAdapterBundles(installedPkgDir, label) {
  for (const f of ["packages/service/dist/index.js", "packages/service/dist/adapters/claude.js", "packages/service/dist/adapters/codex.js", "packages/service/dist/update-helper.js"]) {
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

/**
 * Tree-sitter grammars (issue #133) ship as plain `.wasm` files beside
 * the service bundle — present in the installed copy with no node_modules
 * behind them, so the outline parser runs on every platform.
 */
function checkGrammarFiles(installedPkgDir, label) {
  for (const f of [
    "packages/service/dist/grammars/web-tree-sitter.wasm",
    "packages/service/dist/grammars/tree-sitter-python.wasm",
    "packages/service/dist/grammars/tree-sitter-go.wasm",
    "packages/service/dist/grammars/tree-sitter-rust.wasm",
    "packages/service/dist/grammars/tree-sitter-java.wasm",
    "packages/service/dist/grammars/tree-sitter-ruby.wasm",
    "packages/service/dist/grammars/tree-sitter-javascript.wasm",
    "packages/service/dist/grammars/tree-sitter-typescript.wasm",
    "packages/service/dist/grammars/tree-sitter-tsx.wasm",
  ]) {
    assert(fs.existsSync(path.join(installedPkgDir, f)), `${label}: ships ${f}`);
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
  let installedVersion = null;
  try {
    const pj = JSON.parse(fs.readFileSync(installedPkgJson, "utf8"));
    installedVersion = pj.version ?? null;
    assert(!pj.scripts || Object.keys(pj.scripts).length === 0, `${label}: release package.json defines no scripts`);
    assert(!pj.workspaces, `${label}: release package.json defines no workspaces`);
    assert(!pj.devDependencies, `${label}: release package.json has no devDependencies`);
  } catch {
    assert(false, `${label}: installed package.json parses`);
  }
  assert(!/^> \S+ (postinstall|prepare|preinstall|install)\b/m.test(npmOut), `${label}: no lifecycle script ran during install`);
  // The built service bundle must report the release version (for tag
  // builds the bundle is patched from the source version to the tag).
  if (installedVersion) {
    const ver = spawnSync(process.execPath, [UNVIBE, "--version"], {
      cwd: os.tmpdir(),
      env: ENV,
      encoding: "utf8",
      timeout: 60_000,
    });
    assert(
      ver.status === 0 && (ver.stdout ?? "").trim() === installedVersion,
      `${label}: unvibe --version matches package ${installedVersion} (got ${JSON.stringify((ver.stdout ?? "").trim())})`,
    );
  }

  checkAdapterBundles(installedPkg, label);
  checkGrammarFiles(installedPkg, label);
  console.log(`${label}: install size ${mb(dirSizeBytes(prefix))} (prefix ${prefix})`);

  // Third-party notices (issue #14): the installed package must contain the
  // complete notices — web bundle rows, font licences, fixture + D2 notes.
  {
    const noticesPath = path.join(installedPkg, "THIRD-PARTY-NOTICES.md");
    assert(fs.existsSync(noticesPath), `${label}: ships THIRD-PARTY-NOTICES.md`);
    let notices = "";
    try {
      notices = fs.readFileSync(noticesPath, "utf8");
    } catch {
      notices = "";
    }
    for (const marker of [
      "web dist/assets",
      "react",
      "Web bundle MIT licences",
      "Web fonts (SIL Open Font License 1.1)",
      "urllib3/urllib3/pull/5020",
      "Andrey Petrov",
      "Source Sans Pro",
      "Tree-sitter grammars",
      "Unvibe's own licence",
    ]) {
      assert(notices.includes(marker), `${label}: notices cover ${marker}`);
    }
  }

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
    // Doctor names a single choice with `at <path>`; with several installs
    // it reports `(N candidates; chose <path>: <reason>)` instead (issue #33).
    assert(/at |candidates|does not install it for you/.test(line), `${label}: doctor says which ${cli} executable it runs (or how to install it)`);
  }

  const start = runInstalled(["start"]);
  assert(start.code === 0, `${label}: unvibe start (${start.out.trim().split("\n")[0]})`);
  assert(await waitFor(port, true, 20_000, `${label} health`), `${label}: globally installed service answers`);
  assert(start.out.includes(`http://unvibe.localhost:${port}/?token=`), `${label}: start prints the token URL`);

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
  const label = `git-${RELEASE_REF}-npm${npmMajor}`;
  console.log(`--- ${label}: npm ${npmVersion(npmMajor, process.env)} (ref ${RELEASE_REF}) ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal README command (git-ref variant); git+file://<bare>#<ref>
  // stands in for github:<org>/unvibe#<ref> with no network to GitHub.
  const { code, out, ms, cacheDir } = installLiteral({
    npmMajor,
    installArgs: [`git+file://${bareRepo}#${RELEASE_REF}`],
    prefix: PREFIX,
    label,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g git+file://<bare>#${RELEASE_REF} --prefix (exit ${code})`);
  if (code !== 0) return;
  console.log(`${label}: install time ${s(ms)}`);
  await verifyInstall({ prefix: PREFIX, port, label, cacheDir, npmOut: out });
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

const main = async () => {
  // `mise run release` must have run first (check-global-install chains it):
  // the tarball and the local release branch are its outputs.
  const pkgVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const stripV = (v) => (v.startsWith("v") ? v.slice(1) : v);
  const refName = process.env.GITHUB_REF_NAME ?? "";
  const wantVersion =
    TARBALL_FLAG != null
      ? null
      : stripV((process.env.UNVIBE_RELEASE_VERSION ?? (/^v\d/.test(refName) ? refName : "")) || pkgVersion);
  const tarballPath =
    TARBALL_FLAG != null ? path.resolve(ROOT, TARBALL_FLAG) : path.join(ROOT, `unvibe-${wantVersion}.tgz`);
  assert(fs.existsSync(tarballPath), `release tarball exists (${tarballPath}; run \`mise run release\` first)`);
  const hasRelease = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${RELEASE_REF}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert(hasRelease.status === 0, `local release branch exists (${RELEASE_REF}; run \`mise run release\` first)`);
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
    console.error(`${failures} assertion(s) failed (work dir removed: ${TMP})`);
    removeDir(TMP);
    process.exit(1);
  }
  removeDir(TMP);
  console.log("global-install-check: all green");
};

await main();
