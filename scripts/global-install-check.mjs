/*global console process setTimeout clearTimeout Buffer */
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
// readiness (agent executables), adapter bundles present, no agent platform
// binary for this platform downloaded, one outline request that must be
// answered by a loaded grammar (issue #157), install time + size.
//
// Issue #42: the release package declares no lifecycle scripts (a
// script makes npm link a git install to its temporary preparation
// clone and then delete the clone, dangling the bin), so a plain
// install must land a real package whose bin target exists and runs.
// Setup (the `unvibe://` handler, start-at-login unit, token) runs from
// the CLI on first `unvibe start` — asserted by `checkSetupPlaced`
// after start in every full phase, under a fake HOME with a temp data
// dir so nothing touches the real home. A final tarball phase with
// `--ignore-scripts` asserts the install still succeeds and places no
// helper when scripts are off; the first-start/manual `unvibe setup`
// path covers it.
//
// The release tree needs no build and defines no `prepare`, so npm's
// git-URL handling (dangling symlinks / preparation races on npm 10/11 for
// packages with `prepare`) is out of the picture by construction.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunRoot, onExit, removeDir } from "./tmp-guard.mjs";
import { findRepoByPath, isParserOutline, platformBinaryPackages } from "./global-install-lib.mjs";

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
const PHASES = String(flag("--phases", process.env.UNVIBE_GLOBAL_CHECK_PHASES ?? "tarball,git,doomed,mise"))
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
  // Issue #157: name the current platform's packages (darwin on macOS,
  // win32 on Windows), not only the Linux ones — on macOS the Linux names
  // can never be present, so that assertion checked nothing there.
  for (const pkg of platformBinaryPackages(process.platform, process.arch)) {
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

/**
 * Issue #42: the install itself runs no setup, so after the first
 * `unvibe start` (no `unvibe setup` by hand) the handler and the
 * start-at-login unit must be placed under the fake HOME, baked with
 * the installed CLI path, the per-install token created, and the
 * setup-version marker recorded (asserted at the call site).
 */
function checkSetupPlaced({ installedPkg, home, dataDir, label }) {
  const cliPath = path.join(installedPkg, "packages/service/dist/index.js");
  const read = (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  if (process.platform === "darwin") {
    const plist = path.join(home, "Applications", "Unvibe.app", "Contents", "Info.plist");
    assert(fs.existsSync(plist), `${label}: first start placed the macOS helper app`);
    assert(read(plist).includes("<string>unvibe</string>"), `${label}: helper app registers unvibe://`);
    const unit = path.join(home, "Library", "LaunchAgents", "com.unvibe.service.plist");
    assert(fs.existsSync(unit), `${label}: first start placed the launchd login unit`);
    assert(read(unit).includes(cliPath), `${label}: launchd unit bakes the installed CLI path`);
  } else {
    const desktop = path.join(home, ".local", "share", "applications", "unvibe-open.desktop");
    assert(fs.existsSync(desktop), `${label}: first start placed the Linux link handler`);
    assert(read(desktop).includes(cliPath), `${label}: link handler bakes the installed CLI path`);
    const unit = path.join(home, ".config", "systemd", "user", "unvibe.service");
    assert(fs.existsSync(unit), `${label}: first start placed the systemd login unit`);
    assert(read(unit).includes(cliPath), `${label}: systemd unit bakes the installed CLI path`);
  }
  const token = path.join(dataDir, "token");
  assert(fs.existsSync(token) && read(token).trim().length > 0, `${label}: first start created the install token`);
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

const OUTLINE_PY = [
  "class Store:",
  '    """Keep things."""',
  "",
  "    def get(self, key):",
  "        return self._data[key]",
  "",
  "    def put(self, key, value):",
  "        self._data[key] = value",
].join("\n");

function gitIn(dir, env, ...gitArgs) {
  const r = spawnSync("git", gitArgs, { cwd: dir, env, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(" ")}: ${(r.stderr ?? "").trim()}`);
}

/** A tiny local repo (base + one changed line on `feature`) for the outline check. */
function makeOutlineRepo(label, env) {
  const dir = path.join(TMP, `outline-repo-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "store.py"), `${OUTLINE_PY}\n`);
  gitIn(dir, env, "init", "-b", "main");
  gitIn(dir, env, "config", "user.email", "check@example.com");
  gitIn(dir, env, "config", "user.name", "Install Check");
  gitIn(dir, env, "add", ".");
  gitIn(dir, env, "commit", "-m", "base");
  gitIn(dir, env, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(dir, "store.py"), `${OUTLINE_PY.replace("return self._data[key]", "return self._data.get(key)")}\n`);
  gitIn(dir, env, "add", "-A");
  gitIn(dir, env, "commit", "-m", "change");
  return dir;
}

/**
 * Issue #157: prove a grammar actually loads from the installed package.
 * `checkGrammarFiles` only proves the `.wasm` files are present; this
 * opens a review of a local Python repo in the installed service and
 * asks for the enclosing units of a method body. The answer must come
 * from the parser (`how: "parser"` with the real chain), not the
 * indentation heuristic fallback that runs when a grammar fails to load.
 */
async function checkInstalledOutline({ port, token, label, env }) {
  let repoDir;
  try {
    repoDir = makeOutlineRepo(label, env);
  } catch (e) {
    assert(false, `${label}: outline sample repo created (${e instanceof Error ? e.message : String(e)})`);
    return;
  }
  const added = await api(port, token, "POST", "/api/repos", { path: repoDir });
  let repoId = null;
  try {
    const repos = JSON.parse(added.body)?.repos ?? [];
    // The response is the full repo list, not the added row, and the
    // added repo is not last in it (remembered repos are most-recent
    // first; the demo row created by the demo review above follows it).
    // Find it by the path just added, as the web UI finds its clone.
    repoId = findRepoByPath(repos, path.resolve(repoDir))?.id ?? null;
  } catch {
    repoId = null;
  }
  assert(!!repoId, `${label}: installed service adds the outline sample repo`);
  if (!repoId) return;
  const created = await api(port, token, "POST", "/api/reviews", { repoId, branch: "feature" });
  assert([201, 202].includes(created.code), `${label}: installed service opens the outline sample review`);
  let reviewId = null;
  try {
    reviewId = JSON.parse(created.body)?.review?.id ?? null;
  } catch {
    reviewId = null;
  }
  if (typeof reviewId !== "string") {
    assert(false, `${label}: outline sample review has an id`);
    return;
  }
  let headSha = null;
  for (let i = 0; i < 60 && !headSha; i++) {
    const got = await api(port, token, "GET", `/api/reviews/${reviewId}`);
    try {
      const snap = JSON.parse(got.body);
      if ((snap.ingest?.status ?? "ready") === "failed") break;
      if ((snap.ingest?.status ?? "ready") === "ready" && snap.version?.headSha) headSha = snap.version.headSha;
    } catch {
      // keep polling
    }
    if (!headSha) await new Promise((r) => setTimeout(r, 500));
  }
  assert(typeof headSha === "string", `${label}: outline sample review finishes loading`);
  if (!headSha) return;
  const outline = await api(
    port,
    token,
    "GET",
    `/api/reviews/${reviewId}/outline?path=store.py&commit=${headSha}&start=5&end=5`,
  );
  let body = null;
  try {
    body = JSON.parse(outline.body);
  } catch {
    body = null;
  }
  assert(
    outline.code === 200 && isParserOutline(body),
    `${label}: installed service loads a grammar (outline answers how=parser, got ${body?.how ?? body?.error ?? outline.code}; a heuristic answer would mean the packaged .wasm did not load)`,
  );
  if (body && isParserOutline(body)) {
    assert(body.language === "python", `${label}: outline reports the python grammar`);
    assert(
      body.chain.map((u) => u.name).join(",") === "get,Store",
      `${label}: outline chain is the parsed units (get inside Store)`,
    );
  }
}

/**
 * Verify one global install: bin link, no lifecycle scripts, doctor,
 * start/status/stop outside the repo, prompts + web shell, readiness agent
 * executables, demo pipeline end to end, adapter bundles, size + time.
 */
async function verifyInstall({ prefix, port, label, cacheDir, npmOut, home, dataDir }) {
  const HOME = home;
  const DATA = dataDir;
  fs.mkdirSync(HOME, { recursive: true });
  const ENV = {
    ...process.env,
    HOME,
    UNVIBE_DATA_DIR: DATA,
    UNVIBE_PORT: String(port),
    UNVIBE_IDLE_MS: "0",
    UNVIBE_AGENT: "replay",
    // No user session bus in the sandbox: the login unit is managed on
    // disk, but start/stop exercise the direct-spawn fallback.
    XDG_RUNTIME_DIR: path.join(TMP, "no-runtime"),
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
  // The owner's dangling-bin failure (issue #42): the bin link exists
  // but its target inside the package does not. Assert the target file
  // itself, not just the link.
  assert(
    fs.existsSync(path.join(installedPkg, "packages/service/dist/index.js")),
    `${label}: bin target packages/service/dist/index.js exists in the installed package`,
  );
  // No lifecycle scripts at all (issue #42): any install script makes
  // npm link a git install to its temporary preparation clone and then
  // delete the clone, leaving the bin dangling.
  let installedVersion = null;
  try {
    const pj = JSON.parse(fs.readFileSync(installedPkgJson, "utf8"));
    installedVersion = pj.version ?? null;
    assert(
      !pj.scripts || Object.keys(pj.scripts).length === 0,
      `${label}: release package.json defines no lifecycle scripts`,
    );
    assert(!pj.workspaces, `${label}: release package.json defines no workspaces`);
    assert(!pj.devDependencies, `${label}: release package.json has no devDependencies`);
  } catch {
    assert(false, `${label}: installed package.json parses`);
  }
  assert(!/^> \S+ (prepare|preinstall|prepack|install|postinstall)\b/m.test(npmOut), `${label}: no lifecycle script ran during install`);
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
  // Issue #42: that first start (not `unvibe setup`) completed setup.
  checkSetupPlaced({ installedPkg, home: HOME, dataDir: DATA, label });
  {
    let marker = "";
    try {
      marker = fs.readFileSync(path.join(DATA, "setup-version"), "utf8").trim();
    } catch {
      marker = "";
    }
    assert(!installedVersion || marker === installedVersion, `${label}: first start recorded setup-version ${installedVersion} (got ${JSON.stringify(marker)})`);
  }
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

  await checkInstalledOutline({ port, token, label, env: ENV });

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
/** Env shared by every install in this check (fake HOME, isolated cache). */
function installEnv({ cacheDir, prefix, home, dataDir, port }) {
  return {
    ...process.env,
    npm_config_cache: cacheDir,
    HOME: home,
    UNVIBE_DATA_DIR: dataDir,
    UNVIBE_PORT: String(port),
    // Fake HOME so nothing lands in the real one. No session bus, so
    // the login unit is written but no service is started by the manager.
    XDG_RUNTIME_DIR: path.join(TMP, "no-runtime"),
    // The real node bin first: with a fake HOME, a version-manager shim
    // later in PATH cannot resolve its toolset and `node` in lifecycle
    // scripts fails to start (seen in npm's git-dep preparation, whose
    // nested install inherits this env).
    PATH: `${path.join(prefix, "bin")}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

function installArgsFor({ installArgs, prefix, ignoreScripts }) {
  return ["install", "-g", ...installArgs, "--prefix", prefix, ...(ignoreScripts ? ["--ignore-scripts"] : [])];
}

function installLiteral({ npmMajor, installArgs, prefix, label, home, dataDir, port, ignoreScripts = false, extraEnv = {} }) {
  const cacheDir = path.join(TMP, `cache-${label}`);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const [cmd, ...rest] = npmArgv(npmMajor);
  const ENV = { ...installEnv({ cacheDir, prefix, home, dataDir, port }), ...extraEnv };
  const t0 = Date.now();
  const r = spawnSync(
    cmd,
    [...rest, ...installArgsFor({ installArgs, prefix, ignoreScripts })],
    {
      cwd: os.tmpdir(),
      env: ENV,
      encoding: "utf8",
      timeout: 600_000,
    },
  );
  const ms = Date.now() - t0;
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? ""), ms, cacheDir };
}

async function phaseTarball(npmMajor, tarballPath, port) {
  const label = `tarball-npm${npmMajor}`;
  console.log(`--- ${label}: npm ${npmVersion(npmMajor, process.env)} ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  const home = path.join(TMP, `home-${label}`);
  const dataDir = path.join(TMP, `data-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal README command (tarball URL variant).
  const { code, out, ms, cacheDir } = installLiteral({
    npmMajor,
    installArgs: [tarballPath],
    prefix: PREFIX,
    label,
    home,
    dataDir,
    port,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g <tarball> --prefix (exit ${code})`);
  if (code !== 0) return;
  console.log(`${label}: install time ${s(ms)}`);
  await verifyInstall({ prefix: PREFIX, port, label, cacheDir, npmOut: out, home, dataDir });
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

async function phaseGit(npmMajor, bareRepo, port) {
  const label = `git-${RELEASE_REF}-npm${npmMajor}`;
  console.log(`--- ${label}: npm ${npmVersion(npmMajor, process.env)} (ref ${RELEASE_REF}) ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  const home = path.join(TMP, `home-${label}`);
  const dataDir = path.join(TMP, `data-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  // Literal README command (git-ref variant); git+file://<bare>#<ref>
  // stands in for github:<org>/unvibe#<ref> with no network to GitHub.
  // No extra flags: with no lifecycle scripts in the release package,
  // npm copies the prepared tree into the prefix (the owner's dangling
  // bin came from the old postinstall forcing link mode). verifyInstall
  // asserts the package is a real dir and the bin target exists.
  const { code, out, ms, cacheDir } = installLiteral({
    npmMajor,
    installArgs: [`git+file://${bareRepo}#${RELEASE_REF}`],
    prefix: PREFIX,
    label,
    home,
    dataDir,
    port,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g git+file://<bare>#${RELEASE_REF} --prefix (exit ${code})`);
  if (code !== 0) return;
  console.log(`${label}: install time ${s(ms)}`);
  await verifyInstall({ prefix: PREFIX, port, label, cacheDir, npmOut: out, home, dataDir });
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

/**
 * Issue #42: with `--ignore-scripts` the install must still succeed and
 * the binary must work; no helper is placed at install time (setup runs
 * on first `unvibe start`, or by hand with `unvibe setup`). One npm-11
 * tarball install only.
 */
async function phaseIgnoreScripts(tarballPath, port) {
  const label = "tarball-ignore-scripts";
  console.log(`--- ${label}: npm ${npmVersion("11", process.env)} ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  const home = path.join(TMP, `home-${label}`);
  const dataDir = path.join(TMP, `data-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  const { code, out } = installLiteral({
    npmMajor: "11",
    installArgs: [tarballPath],
    prefix: PREFIX,
    label,
    home,
    dataDir,
    port,
    ignoreScripts: true,
  });
  if (code !== 0) console.error(out.slice(-3000));
  assert(code === 0, `${label}: npm install -g --ignore-scripts exits 0 (exit ${code})`);
  if (code !== 0) return;
  const bin = path.join(PREFIX, "bin", "unvibe");
  assert(fs.existsSync(bin), `${label}: unvibe bin linked with scripts ignored`);
  const handler =
    process.platform === "darwin"
      ? path.join(home, "Applications", "Unvibe.app")
      : path.join(home, ".local", "share", "applications", "unvibe-open.desktop");
  assert(!fs.existsSync(handler), `${label}: no helper placed with scripts ignored (run \`unvibe setup\`)`);
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

/**
 * Issue #42 regressions (owner, macOS): the in-app switch and
 * `unvibe update` spawn npm from the running service, whose cwd can be
 * inside the package npm is replacing — npm deletes that directory
 * mid-install. With a lifecycle script that killed the install
 * (`ENOENT uv_cwd`, then the dangling-bin rollback); with none, the
 * reinstall must simply succeed: exit 0, no `uv_cwd`, the package a
 * real dir whose bin target exists and runs. This phase reproduces
 * that path without the app: install once normally, then install again
 * with npm's own cwd inside the installed package dir. Runs on npm 11
 * only (npm 10/11 plain installs are covered above).
 */
async function phaseDoomedCwd({ kind, installArgs, port }) {
  const label = `switch-cwd-${kind}`;
  console.log(`--- ${label}: npm ${npmVersion("11", process.env)} (npm cwd inside the package being replaced) ---`);
  const PREFIX = path.join(TMP, `prefix-${label}`);
  const home = path.join(TMP, `home-${label}`);
  const dataDir = path.join(TMP, `data-${label}`);
  fs.mkdirSync(PREFIX, { recursive: true });
  const first = installLiteral({ npmMajor: "11", installArgs, prefix: PREFIX, label, home, dataDir, port });
  if (first.code !== 0) console.error(first.out.slice(-3000));
  assert(first.code === 0, `${label}: first install exits 0 (exit ${first.code})`);
  if (first.code !== 0) return;
  const pkgDir = path.join(PREFIX, "lib", "node_modules", "unvibe");
  assert(fs.existsSync(path.join(pkgDir, "package.json")), `${label}: first install landed in the prefix`);

  const cacheDir = path.join(TMP, `cache-${label}-2`);
  fs.mkdirSync(cacheDir, { recursive: true });
  const [cmd, ...rest] = npmArgv("11");
  // npm starts with its cwd inside the package being replaced (the
  // running service's cwd on the owner's machine); npm's reify deletes
  // and recreates that directory mid-install. Nothing may rely on a
  // live inherited cwd, and nothing may link to a deleted temp dir.
  const out = await new Promise((resolve) => {
    const child = spawn(cmd, [...rest, ...installArgsFor({ installArgs, prefix: PREFIX })], {
      cwd: pkgDir,
      env: installEnv({ cacheDir, prefix: PREFIX, home, dataDir, port }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    child.stdout.on("data", (d) => (buf += String(d)));
    child.stderr.on("data", (d) => (buf += String(d)));
    const timer = setTimeout(() => child.kill("SIGKILL"), 600_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, out: `${buf}\n${String(err)}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out: buf });
    });
  });
  if (out.code !== 0) console.error(out.out.slice(-3000));
  assert(out.code === 0, `${label}: reinstall from inside the replaced package exits 0 (exit ${out.code})`);
  assert(!/uv_cwd/.test(out.out), `${label}: no uv_cwd (the owner's error)`);
  if (out.code !== 0) return;
  const st = fs.lstatSync(pkgDir, { throwIfNoEntry: false });
  assert(!!st && !st.isSymbolicLink() && fs.existsSync(path.join(pkgDir, "package.json")), `${label}: package re-landed as a real dir`);
  assert(
    fs.existsSync(path.join(pkgDir, "packages/service/dist/index.js")),
    `${label}: bin target exists after the switch-path install (no dangling bin)`,
  );
  const ver = spawnSync(process.execPath, [path.join(PREFIX, "bin", "unvibe"), "--version"], {
    cwd: os.tmpdir(),
    env: installEnv({ cacheDir, prefix: PREFIX, home, dataDir, port }),
    encoding: "utf8",
    timeout: 60_000,
  });
  assert(ver.status === 0, `${label}: installed bin still runs after the switch-path install`);
  fs.rmSync(PREFIX, { recursive: true, force: true });
}

/**
 * Issue #42 (owner's Mac): with mise-managed Node, npm's global prefix
 * is one Node version's prefix and only the mise shims dir is on PATH,
 * so the installed `unvibe` bin is not runnable by name until a reshim.
 * Faithful stand-in with a temp HOME (the real mise config is never
 * touched): a real node binary hardlinked under
 * `~/.local/share/mise/installs/node/99.0.0`, npm beside it, only the
 * shims dir on PATH, and a fake `mise` whose `reshim` links the
 * version's bins into the shims. Asserts npm's prefix really is the
 * version dir before installing (never install into a real prefix),
 * that doctor names the exact fix, and that after `mise reshim` the
 * bin runs by name.
 */
async function phaseMise(tarballPath, port) {
  const label = "mise-managed-node";
  console.log(`--- ${label}: stand-in (version prefix + shims-only PATH, temp HOME) ---`);
  const home = path.join(TMP, `home-${label}`);
  const dataDir = path.join(TMP, `data-${label}`);
  const versionDir = path.join(home, ".local", "share", "mise", "installs", "node", "99.0.0");
  const vbin = path.join(versionDir, "bin");
  const shims = path.join(home, ".local", "share", "mise", "shims");
  fs.mkdirSync(vbin, { recursive: true });
  fs.mkdirSync(shims, { recursive: true });
  fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
  try {
    fs.linkSync(process.execPath, path.join(vbin, "node"));
  } catch {
    fs.copyFileSync(process.execPath, path.join(vbin, "node"));
  }
  const realNpmDir = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm");
  const npmCli = path.join(realNpmDir, "bin", "npm-cli.js");
  assert(fs.existsSync(npmCli), `${label}: host npm layout found for the stand-in`);
  if (!fs.existsSync(npmCli)) return;
  fs.mkdirSync(path.join(versionDir, "lib", "node_modules"), { recursive: true });
  fs.symlinkSync(realNpmDir, path.join(versionDir, "lib", "node_modules", "npm"), "dir");
  fs.symlinkSync(npmCli, path.join(vbin, "npm"));
  fs.symlinkSync(path.join(vbin, "node"), path.join(shims, "node"));
  fs.symlinkSync(path.join(vbin, "npm"), path.join(shims, "npm"));
  const miseBin = path.join(home, ".local", "bin", "mise");
  fs.writeFileSync(
    miseBin,
    [
      "#!/bin/sh",
      'if [ "$1" = reshim ]; then',
      '  for f in "$HOME/.local/share/mise/installs/node"/*/bin/*; do ln -sf "$f" "$HOME/.local/share/mise/shims/"; done',
      "fi",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const ENV = {
    ...process.env,
    HOME: home,
    UNVIBE_DATA_DIR: dataDir,
    UNVIBE_PORT: String(port),
    npm_config_cache: path.join(TMP, `cache-${label}`),
    XDG_RUNTIME_DIR: path.join(TMP, "no-runtime"),
    PATH: `${shims}${path.delimiter}/usr/bin${path.delimiter}/bin`,
  };
  const prefixRes = spawnSync("npm", ["prefix", "-g"], { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 120_000 });
  const gotPrefix = (prefixRes.stdout ?? "").trim();
  assert(gotPrefix === versionDir, `${label}: npm global prefix is the mise version prefix (got ${gotPrefix || prefixRes.stderr?.trim() || "?"})`);
  if (gotPrefix !== versionDir) return; // never install into a real prefix
  const inst = spawnSync("npm", ["install", "-g", tarballPath], { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 600_000 });
  if (inst.status !== 0) console.error(((inst.stdout ?? "") + (inst.stderr ?? "")).slice(-3000));
  assert(inst.status === 0, `${label}: npm install -g <tarball> under mise-managed node exits 0 (exit ${inst.status})`);
  if (inst.status !== 0) return;
  assert(fs.existsSync(path.join(vbin, "unvibe")), `${label}: global bin linked into the version prefix bin`);
  assert(
    fs.existsSync(path.join(versionDir, "lib", "node_modules", "unvibe", "packages", "service", "dist", "index.js")),
    `${label}: bin target exists under the version prefix`,
  );
  const byName = () => spawnSync("unvibe --version", { shell: "/bin/sh", cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 60_000 });
  const before = byName();
  assert(before.status !== 0, `${label}: before reshim, \`unvibe\` is not runnable by name from the shims-only PATH (the owner's failure)`);
  const doctor = spawnSync(process.execPath, [path.join(vbin, "unvibe"), "doctor"], {
    cwd: os.tmpdir(),
    env: ENV,
    encoding: "utf8",
    timeout: 120_000,
  });
  const doctorOut = (doctor.stdout ?? "") + (doctor.stderr ?? "");
  assert(doctorOut.includes("unvibe on PATH"), `${label}: doctor reports the bin-reachability check`);
  assert(doctorOut.includes(vbin), `${label}: doctor prints the exact fix (names ${vbin})`);
  const reshim = spawnSync(miseBin, ["reshim"], { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 60_000 });
  assert(reshim.status === 0, `${label}: mise reshim (stand-in) exits 0`);
  const after = byName();
  const version = JSON.parse(fs.readFileSync(path.join(versionDir, "lib", "node_modules", "unvibe", "package.json"), "utf8")).version;
  assert(
    after.status === 0 && (after.stdout ?? "").trim() === version,
    `${label}: after reshim, \`unvibe --version\` runs by name (${version}; got ${JSON.stringify((after.stdout ?? "").trim())} exit ${after.status})`,
  );
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
  if (PHASES.includes("tarball")) {
    await phaseIgnoreScripts(tarballPath, port);
    port += 10;
  }
  if (PHASES.includes("doomed")) {
    await phaseDoomedCwd({ kind: "tarball", installArgs: [tarballPath], port });
    port += 10;
    await phaseDoomedCwd({ kind: "git", installArgs: [`git+file://${BARE}#${RELEASE_REF}`], port });
    port += 10;
  }
  if (PHASES.includes("mise")) {
    await phaseMise(tarballPath, port);
    port += 10;
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
