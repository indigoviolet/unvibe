/*global console process setTimeout */
 // macOS end-to-end for the app shell (PRD §14), run as:
 //   node scripts/e2e-macos.mjs [--port N]
 //
 // macOS counterpart of `scripts/e2e-linux.mjs`. Uses a temporary HOME +
 // data dir + port, outside the user's real setup:
 //  1. `unvibe setup` compiles the helper app with `osacompile` (real, on
 //     macOS), patches its Info.plist, and registers it with `lsregister`.
 //  2. The Info.plist contents and quarantine state are asserted directly.
 //  3. URL dispatch is attempted for real (`open "unvibe://start"`). On a
 //     headless runner LaunchServices may not dispatch to GUI apps; when the
 //     service does not come up that way, the helper's own handler binary
 //     (`Contents/MacOS/*`, `on run`) is invoked directly with the test env
 //     instead — which proves the generated app starts the service, while
 //     the LaunchServices dispatch itself stays human-verified (the script
 //     prints exactly which path worked).
 //  4. `unvibe status` reports running; a second `start` reuses.
 //  5. With a short UNVIBE_IDLE_MS the service idle-exits on its own.
 //  6. `unvibe doctor` reports the environment; `setup --uninstall` removes
 //     the helper (token and data kept).
 //
 // NOTE on the `open` path: the helper bakes in absolute node/CLI paths and
 // starts the service with defaults (real HOME data dir, port 4517), exactly
 // as for a real user. The script checks 4517 is free first, stops the
 // dispatched service afterwards, and skips the dispatch probe when 4517 is
 // already taken. Only macOS CI runners and disposable machines should run
 // this; it touches the real LaunchServices database (registration only).
 //
 // Exits nonzero on the first failed assertion. Requires a built service
 // (`mise run build`) and macOS (`osacompile`, `lsregister`, `open`).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunRoot, onExit, removeDir } from "./tmp-guard.mjs";

if (process.platform !== "darwin") {
  console.error("e2e-macos: macOS only (use scripts/e2e-linux.mjs on Linux)");
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4592;
// The helper app starts the service with defaults (see NOTE above).
const DEFAULT_PORT = 4517;

// Per-run temp root (issue #24): HOME + DATA live under one fresh dir,
// removed by exact path on success, failure and interruption. Never
// globs the system temp dir (other suites share it). Not run on Linux
// (`e2e:macos` needs macOS); changed by reading alongside e2e-linux.mjs.
const RUN = createRunRoot();
const HOME = path.join(RUN, "home");
const DATA = path.join(RUN, "data");
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
const ENV = {
  ...process.env,
  HOME,
  UNVIBE_DATA_DIR: DATA,
  UNVIBE_PORT: String(PORT),
  UNVIBE_IDLE_MS: "3000",
};
// Scrubbed env: the dispatched helper starts the service with defaults.
const DEFAULT_ENV = { ...process.env };
for (const k of ["UNVIBE_PORT", "UNVIBE_DATA_DIR", "UNVIBE_IDLE_MS", "UNVIBE_AGENT", "UNVIBE_REPO_ROOTS"]) {
  delete DEFAULT_ENV[k];
}
DEFAULT_ENV.HOME = process.env.HOME ?? os.homedir();

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

function runCli(cmdArgs, env = ENV) {
  const r = spawnSync(process.execPath, [CLI, ...cmdArgs], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// Interruption net: stop only our own daemons (temp-port via ENV, plus a
// dispatched default-port service only when our own `open` call may have
// started it), then remove only our own root. Foreign owners never touched.
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    runCli(["stop"]);
  } catch {
    // best effort
  }
  removeDir(RUN);
}
onExit(cleanup);

function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });
}

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

const lockPid = (dataDir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "unvibe.lock"), "utf8")).pid;
  } catch {
    return null;
  }
};

// 1. setup -----------------------------------------------------------------
const setup = runCli(["setup"]);
console.log(setup.out);
assert(setup.code === 0, "setup exits 0");
const APP = path.join(HOME, "Applications", "Unvibe.app");
assert(fs.existsSync(APP), "helper app written to temp HOME");
if (setup.out.includes("registered unvibe:// with LaunchServices")) {
  console.log("ok: lsregister registration reported by setup");
} else {
  console.log(`NOTE: setup did not confirm lsregister registration (headless?): ${setup.out.split("\n").find((l) => l.includes("lsregister")) ?? "(no lsregister line)"}`);
}

// Nothing else may appear under the fake HOME (token/lock live in DATA).
const seen = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else seen.push(full);
  }
};
walk(HOME);
assert(
  seen.every((f) => f.startsWith(APP + path.sep)),
  `setup wrote only the helper app (saw: ${seen.join(", ")})`,
);

// 2. helper contents ----------------------------------------------------------
const plistPath = path.join(APP, "Contents", "Info.plist");
assert(fs.existsSync(plistPath), "helper Info.plist exists");
const plist = fs.existsSync(plistPath) ? fs.readFileSync(plistPath, "utf8") : "";
assert(plist.includes("CFBundleURLTypes"), "Info.plist registers a URL type");
assert(plist.includes("<string>unvibe</string>"), "Info.plist registers the unvibe:// scheme");
assert(plist.includes("com.unvibe.helper"), "Info.plist carries the helper bundle id");
const macosDir = path.join(APP, "Contents", "MacOS");
let handlerBin = null;
try {
  const cands = fs.readdirSync(macosDir).filter((n) => !n.endsWith(".dSYM"));
  console.log(`helper executable: ${cands.join(", ") || "(none)"}`);
  const pick = cands.includes("applet") ? "applet" : cands.includes("droplet") ? "droplet" : cands.length === 1 ? cands[0] : null;
  handlerBin = pick ? path.join(macosDir, pick) : null;
} catch {
  handlerBin = null;
}
assert(!!handlerBin, "helper has a handler binary (osacompile output)");
const xattr = spawnSync("xattr", [APP], { encoding: "utf8", timeout: 15_000 });
const quarantine = (xattr.stdout ?? "").split("\n").some((l) => l.includes("quarantine"));
assert(!quarantine, "helper carries no quarantine attribute (locally generated, no signing needed)");

// 3. URL dispatch --------------------------------------------------------------
// Prefer the real dispatch path (`open "unvibe://start"`); fall back to
// invoking the helper's handler directly when LaunchServices cannot
// dispatch on a headless runner.
let via = "none";
// Set when OUR `open` call may have dispatched (exit 0), even if the
// service is slow to appear: only then may the script stop the
// default-port service. A 4517 already healthy beforehand is foreign and
// must never be touched.
let mayHaveDispatched = false;
if (await health(DEFAULT_PORT)) {
  console.log(`NOTE: port ${DEFAULT_PORT} already answers; skipping the dispatch probe (foreign service?)`);
} else {
  const opened = spawnSync("open", ["unvibe://start"], { env: ENV, encoding: "utf8", timeout: 15_000 });
  mayHaveDispatched = opened.status === 0;
  if (mayHaveDispatched && (await waitFor(DEFAULT_PORT, true, 20_000, "dispatched service health"))) {
    via = "open";
    const stop = runCli(["stop"], DEFAULT_ENV);
    assert(stop.code === 0 && (await waitFor(DEFAULT_PORT, false, 10_000, "dispatched service shutdown")), "dispatched service stops cleanly");
  } else {
    console.log(`NOTE: \`open "unvibe://start"\` did not start a service here (exit ${opened.status ?? "?"}; headless runner?) — invoking the helper handler directly`);
  }
}
if (via === "none" && handlerBin) {
  // `on run` starts the service; run it the way the helper would, with the
  // test env so it lands on the temp port + data dir.
  const child = spawn(handlerBin, [], {
    env: ENV,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  if (await waitFor(PORT, true, 20_000, "service health via helper handler")) via = "applet-direct";
}
assert(via !== "none", `service starts via the helper (${via})`);
// A late `open` dispatch may still have started the default service after
// we fell back to the handler: stop it if it is ours, so only the
// temp-port service below remains (best effort; the dispatch probe already
// reported its verdict).
if (via !== "open" && mayHaveDispatched && (await health(DEFAULT_PORT))) {
  console.log(`NOTE: default-port service appeared late; stopping it`);
  runCli(["stop"], DEFAULT_ENV);
}

// 4. start through the CLI; a second start reuses --------------------------------
// (`open`-dispatch ran on defaults, so the temp-port service starts here;
// the handler path already runs it, and `start` reuses it either way.)
const start1 = runCli(["start"]);
assert(start1.code === 0, `start exits 0 (${start1.out.trim().split("\n")[0]})`);
const pid1 = lockPid(DATA);
assert(typeof pid1 === "number", "lock file holds the daemon pid");
const start2 = runCli(["start"]);
assert(start2.code === 0 && lockPid(DATA) === pid1, "second start reuses the running service");
assert(start2.out.includes("already running"), "second start says it reused the service");

// 5. status + doctor ------------------------------------------------------------
const status = runCli(["status"]);
assert(status.code === 0 && status.out.includes("running"), `status reports running (${status.out.trim()})`);
const doctor = runCli(["doctor"]);
assert(doctor.code === 0, "doctor exits 0");
assert(doctor.out.includes("[ok] node"), "doctor reports node");
assert(doctor.out.includes("data dir"), "doctor reports the data dir");

// 6. idle exit ------------------------------------------------------------------
assert(
  await waitFor(PORT, false, 25_000, "idle exit (UNVIBE_IDLE_MS=3000)"),
  "service idle-exits with no windows/jobs",
);
const after = runCli(["status"]);
assert(after.code === 1 && after.out.includes("not running"), "status reports stopped after idle exit");

// 7. uninstall -------------------------------------------------------------------
const uninstall = runCli(["setup", "--uninstall"]);
assert(uninstall.code === 0 && !fs.existsSync(APP), "uninstall removes the helper");
const uninstall2 = runCli(["setup", "--uninstall"]);
assert(uninstall2.code === 0 && uninstall2.out.includes("nothing to remove"), "uninstall is idempotent");

// Final cleanup: a service we dispatched (but never confirmed) must not be
// left running on the defaults. Foreign 4517 owners are never touched.
if (mayHaveDispatched && via !== "open" && (await health(DEFAULT_PORT))) {
  const s = runCli(["stop"], DEFAULT_ENV);
  assert(s.code === 0 && !(await waitFor(DEFAULT_PORT, false, 10_000, "late dispatched service shutdown")), "no dispatched service left running");
}

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  cleanup();
  process.exit(1);
}
cleanup();
console.log(`e2e-macos: all green (service start via ${via})`);
if (via !== "open") {
  console.log(
    "NOTE (stays human-verified, docs/macos-testing.md step 4): LaunchServices dispatch of " +
      "`unvibe://start` through `open`/Safari/Finder was not exercised on this headless machine; " +
      "only the helper binary itself was.",
  );
}
