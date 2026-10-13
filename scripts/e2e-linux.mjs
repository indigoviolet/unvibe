/*global console process setTimeout */
 // Linux end-to-end for the app shell (PRD §14), run as:
//   node scripts/e2e-linux.mjs [--port N]
//
// Uses a temporary HOME + data dir + port, outside the user's real setup:
//  1. `unvibe setup --no-login` writes the .desktop handler (and nothing
//     else). The start-at-login unit is skipped here on purpose: enabling
//     it would touch the real login session; its contents and enable
//     commands are covered by `setup.test.ts` with a fake HOME.
//  2. Invoking the registered handler (xdg-open, else the desktop Exec
//     line directly) starts the service; a second `start` reuses it.
//  3. `unvibe status` reports running.
//  4. With a short UNVIBE_IDLE_MS the service idle-exits on its own.
//  5. `unvibe setup --uninstall` removes the handler.
//
// Exits nonzero on the first failed assertion. Requires a built service
// (`mise run build`).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRunRoot, onExit, removeDir } from "./tmp-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "packages", "service", "dist", "index.js");
if (!fs.existsSync(CLI)) {
  console.error(`missing build: ${CLI} (run \`mise run build\` first)`);
  process.exit(2);
}

const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const PORT = portIdx >= 0 ? Number(args[portIdx + 1]) : 4591;

// Per-run temp root (issue #24): HOME + DATA live under one fresh dir,
// removed by exact path on success, failure and interruption. Never
// globs the system temp dir (other suites share it).
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
// Interruption net: stop only our own daemon (via its lock file under our
// DATA), then remove only our own root. Never kills by pattern or port.
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    spawnSync(process.execPath, [CLI, "stop"], { env: ENV, timeout: 30_000 });
  } catch {
    // best effort
  }
  removeDir(RUN);
}
onExit(cleanup);

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log(`ok: ${msg}`);
  else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

function runCli(cmdArgs, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...cmdArgs], {
    env: ENV,
    encoding: "utf8",
    timeout: 60_000,
    ...opts,
  });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function health() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.on("close", () => resolve(false));
  });
}

async function waitFor(cond, want, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await cond()) === want) return true;
    if (Date.now() >= deadline) {
      console.error(`timeout waiting for ${label}`);
      return false;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const lockPid = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "unvibe.lock"), "utf8")).pid;
  } catch {
    return null;
  }
};

// 1. setup -----------------------------------------------------------------
// --no-login keeps this hermetic: no real systemd enable/start.
const setup = runCli(["setup", "--no-login"]);
console.log(setup.out);
assert(setup.code === 0, "setup exits 0");
assert(setup.out.includes(`http://unvibe.localhost:${PORT}`), "setup prints the new URL");
const desktop = path.join(HOME, ".local", "share", "applications", "unvibe-open.desktop");
assert(fs.existsSync(desktop), "desktop handler written to temp HOME");
const execLine = fs
  .readFileSync(desktop, "utf8")
  .split("\n")
  .find((l) => l.startsWith("Exec="))
  ?.slice("Exec=".length)
  .replace(/ %u$/, "");
assert(!!execLine && execLine.includes("start"), "desktop Exec starts the service");

// No login items, anywhere under the fake HOME. `mimeinfo.cache` is the
// system desktop-database cache rewritten by update-desktop-database.
const SYSTEM_CACHE = path.join(HOME, ".local", "share", "applications", "mimeinfo.cache");
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
  seen.every((f) => f === desktop || f === SYSTEM_CACHE),
  `setup wrote only the desktop file (saw: ${seen.join(", ")})`,
);

// 2. invoke the handler ------------------------------------------------------
// Prefer the real dispatch path; fall back to the Exec line when no desktop
// session exists (headless CI).
let via = "exec";
{
  const xdg = spawnSync("xdg-open", ["unvibe://start"], { env: ENV, timeout: 8000 });
  if (xdg.status === 0 && (await health())) via = "xdg-open";
}
if (via === "exec") {
  // Run the registered command the way a launcher would (through sh, so
  // the desktop quoting is exercised for real).
  const child = spawn("/bin/sh", ["-c", `${execLine} > /dev/null 2>&1`], {
    env: ENV,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
assert(await waitFor(health, true, 20_000, "service health"), `service starts via handler (${via})`);
const pid1 = lockPid();
assert(typeof pid1 === "number", "lock file holds the daemon pid");

// 3. second start reuses ------------------------------------------------------
const start2 = runCli(["start"]);
assert(start2.code === 0 && lockPid() === pid1, "second start reuses the running service");
assert(start2.out.includes("already running"), "second start says it reused the service");

// 4. status -------------------------------------------------------------------
const status = runCli(["status"]);
assert(status.code === 0 && status.out.includes("running"), `status reports running (${status.out.trim()})`);

// 5. idle exit ------------------------------------------------------------------
assert(
  await waitFor(health, false, 25_000, "idle exit (UNVIBE_IDLE_MS=3000)"),
  "service idle-exits with no windows/jobs",
);
const after = runCli(["status"]);
assert(after.code === 1 && after.out.includes("not running"), "status reports stopped after idle exit");

// 6. uninstall -------------------------------------------------------------------
const uninstall = runCli(["setup", "--uninstall"]);
assert(uninstall.code === 0 && !fs.existsSync(desktop), "uninstall removes the handler");

if (failures > 0) {
  console.error(`${failures} assertion(s) failed`);
  cleanup();
  process.exit(1);
}
cleanup();
console.log(`e2e-linux: all green (via ${via})`);
