/*global console process setTimeout Buffer */
 // Global-install check (PRD §14 install path), run as:
//   node scripts/global-install-check.mjs [--port N] [--git-port M] [--phases tarball,git]
//
// Phase "tarball": `npm install -g <tarball>` into a temporary prefix, then
// `unvibe doctor` and `unvibe start`/`status`/`stop` from OUTSIDE the repo,
// plus the demo pipeline from the installed copy. This exercises the hard
// parts: workspaces + devDependencies in the packed tree, root bin linkage,
// and dist/prompts/fixtures resolution relative to the installed package
// (not the repo).
// Phase "git": the documented `npm install -g github:<org>/unvibe` path,
// tested with a local bare clone as the git source
// (`npm install -g git+file://<bare>#<branch>`), which additionally
// exercises the `prepare` build-from-source step.
// Both phases assert the ACP adapter packages resolve from the installed
// tree (the bundled service spawns them as subprocesses) and report the
// install size.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
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
const GIT_PORT = Number(flag("--git-port", "4594"));
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

/**
 * The bundled service spawns the ACP adapters as subprocesses, resolving
 * them with `createRequire` from the bundle location — they must be real,
 * resolvable files in the installed tree, not inlined code.
 */
function checkAdapterResolution(installedPkgDir, label) {
  const fromBundle = createRequire(path.join(installedPkgDir, "packages", "service", "dist", "index.js"));
  for (const spec of [
    "@agentclientprotocol/sdk",
    "@agentclientprotocol/claude-agent-acp/dist/index.js",
    "@agentclientprotocol/codex-acp/dist/index.js",
  ]) {
    let resolved = null;
    try {
      resolved = fromBundle.resolve(spec);
    } catch (e) {
      assert(false, `${label}: ${spec} resolves from the installed bundle (${String(e).slice(0, 120)})`);
      continue;
    }
    assert(fs.existsSync(resolved), `${label}: ${spec} resolves to a real file (${resolved})`);
  }
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
 * Verify one global install: doctor, start/status/stop outside the repo,
 * prompts + web shell resolution, ACP adapter resolvability, install size.
 * With `full`, also runs the recorded demo pipeline end to end (proves
 * fixtures/ + prompts/ resolve outside the repo).
 */
async function verifyInstall({ prefix, port, label, full }) {
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
  assert(fs.existsSync(path.join(installedPkg, "package.json")), `${label}: installed package dir exists`);
  // npm ≥11 links (rather than copies) global installs from a git URL when
  // the package has a `prepare` script, then removes the clone's working
  // tree — leaving a dangling symlink (reproducible with a trivial
  // package; not specific to this repo). Fail loudly with the diagnosis
  // instead of running a broken install.
  {
    const st = fs.lstatSync(installedPkg, { throwIfNoEntry: false });
    const isLink = !!st?.isSymbolicLink();
    const real = fs.existsSync(installedPkg);
    assert(!isLink || real, `${label}: installed package is a real dir, not a dangling symlink` +
      (isLink && !real ? ` (npm ${process.env.npm_config_user_agent ?? "unknown"} linked the git clone and removed it; see README troubleshooting)` : ""));
    if (isLink && !real) return;
  }

  checkAdapterResolution(installedPkg, label);
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

  const start = runInstalled(["start"]);
  assert(start.code === 0, `${label}: unvibe start (${start.out.trim().split("\n")[0]})`);
  assert(await waitFor(port, true, 20_000, `${label} health`), `${label}: globally installed service answers`);
  assert(start.out.includes(`http://127.0.0.1:${port}/?token=`), `${label}: start prints the token URL`);

  const token = fs.readFileSync(path.join(DATA, "token"), "utf8").trim();
  const prompts = await simpleGet(port, "/api/prompts", { authorization: `Bearer ${token}` });
  assert(prompts.code === 200 && prompts.body.includes("instructions"), `${label}: prompts resolve from the installed package`);
  const shell = await simpleGet(port, "/start.html");
  assert(shell.code === 200, `${label}: web dist serves from the installed package`);

  if (full) {
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
  }

  const status = runInstalled(["status"]);
  assert(status.code === 0 && status.out.includes("running"), `${label}: status reports running`);
  const stop = runInstalled(["stop"]);
  assert(stop.code === 0 && (await waitFor(port, false, 10_000, `${label} shutdown`)), `${label}: stop shuts the service down`);
}

async function phaseTarball() {
  const PREFIX = path.join(TMP, "prefix-tarball");
  fs.mkdirSync(PREFIX, { recursive: true });
  const ENV = { ...process.env, PATH: `${path.join(PREFIX, "bin")}${path.delimiter}${process.env.PATH ?? ""}` };
  const pack = spawnSync("npm", ["pack", "--pack-destination", TMP], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
  assert(pack.status === 0, `npm pack (${(pack.stderr ?? "").split("\n").slice(-2).join(" ")})`);
  const tarball = fs.readdirSync(TMP).find((f) => f.endsWith(".tgz"));
  assert(!!tarball, `tarball produced (${tarball ?? "none"})`);
  if (!tarball) return;
  console.log(`tarball: ${tarball} (${mb(fs.statSync(path.join(TMP, tarball)).size)})`);
  const inst = spawnSync("npm", ["install", "-g", path.join(TMP, tarball), "--prefix", PREFIX], {
    cwd: os.tmpdir(),
    env: ENV,
    encoding: "utf8",
    timeout: 300_000,
  });
  if (inst.status !== 0) console.error(inst.stdout, inst.stderr);
  assert(inst.status === 0, "npm install -g <tarball> --prefix");
  await verifyInstall({ prefix: PREFIX, port: PORT, label: "tarball", full: true });
}

async function phaseGit() {
  // The documented path installs from a git URL; a local bare clone stands
  // in for github:<org>/unvibe (same mechanism, no network to GitHub).
  // Install the CURRENT commit so the check covers this branch's packaging.
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  assert(head.status === 0, "git rev-parse HEAD");
  const sha = (head.stdout ?? "").trim();
  const branch = `check-${sha.slice(0, 12)}`;
  const BARE = path.join(TMP, "upstream.git");
  const clone = spawnSync("git", ["clone", "--bare", ROOT, BARE], { encoding: "utf8", timeout: 120_000 });
  assert(clone.status === 0, `bare clone for the git-URL source (${(clone.stderr ?? "").split("\n")[0]})`);
  const upd = spawnSync("git", ["--git-dir", BARE, "update-ref", `refs/heads/${branch}`, sha], {
    encoding: "utf8",
  });
  assert(upd.status === 0, `bare clone pins ${branch} at ${sha.slice(0, 12)}`);

  const PREFIX = path.join(TMP, "prefix-git");
  fs.mkdirSync(PREFIX, { recursive: true });
  const ENV = { ...process.env, PATH: `${path.join(PREFIX, "bin")}${path.delimiter}${process.env.PATH ?? ""}` };
  // `prepare` builds from source inside the cloned tree (needs devDeps +
  // build tools there) — this is the step the tarball phase skips.
  const inst = spawnSync(
    "npm",
    ["install", "-g", `git+file://${BARE}#${branch}`, "--prefix", PREFIX],
    { cwd: os.tmpdir(), env: ENV, encoding: "utf8", timeout: 600_000 },
  );
  if (inst.status !== 0) console.error((inst.stdout ?? "").slice(-3000), (inst.stderr ?? "").slice(-3000));
  assert(inst.status === 0, `npm install -g git+file://<bare>#${branch} --prefix`);
  if (inst.status !== 0) return;
  await verifyInstall({ prefix: PREFIX, port: GIT_PORT, label: "git", full: false });
}

const main = async () => {
  if (PHASES.includes("tarball")) await phaseTarball();
  if (PHASES.includes("git")) await phaseGit();
  if (failures > 0) {
    console.error(`${failures} assertion(s) failed (work dir kept: ${TMP})`);
    process.exit(1);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("global-install-check: all green");
};

await main();
