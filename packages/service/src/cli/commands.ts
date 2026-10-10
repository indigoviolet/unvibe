/**
 * `unvibe` command implementations (PRD §14).
 *
 * - `start`: reuse the running service when the lock is live, else spawn a
 *   detached `start --foreground` child and wait for `/api/health`.
 * - `stop` / `status`: act on the lock with stale-lock detection.
 * - `setup` / `setup --uninstall`: token + platform URL handler.
 * - `open`: ensure running, then open the token URL in the browser.
 * - `token`: print the token URL (does not start the service).
 * - `doctor`: environment checks, always exits 0 (informational).
 */
import { spawn } from "node:child_process";
import os from "node:os";
import { loadOrCreateToken } from "../auth.js";
import { loadConfig } from "../config.js";
import { isHealthOk, isPidAlive, readLock, removeLock, removeOwnLock, waitForHealth, writeLock } from "./lock.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { installSetup, resolveSetupPaths, uninstallSetup } from "./setup/index.js";

export const CLI_USAGE = [
  "unvibe — local code-review service (PRD §14)",
  "",
  "Usage: unvibe <command>",
  "",
  "  start [--foreground]   start the service (reuses it when already running)",
  "  stop                   stop the running service",
  "  status                 running or not (exit 1 when stopped)",
  "  setup [--uninstall]    token + unvibe:// handler (idempotent)",
  "  open                   start if needed, open the app URL in a browser",
  "  token                  print the app URL with the per-install token",
  "  doctor                 check node, git, gh, agents, PATH, data dir, port",
  "",
  "Env: UNVIBE_PORT (default 4517), UNVIBE_DATA_DIR (default",
  "     ~/.local/share/unvibe), UNVIBE_IDLE_MS (default 600000, <=0 disables).",
].join("\n");

export function serviceUrl(port: number, token: string): string {
  return `http://127.0.0.1:${port}/?token=${token}`;
}

function cliScriptPath(): string {
  const script = process.argv[1];
  if (!script) throw new Error("cannot determine CLI script path (process.argv[1] missing)");
  return script;
}

async function ensureRunning(): Promise<{ port: number; token: string; fresh: boolean }> {
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);
  const lock = readLock(config.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    return { port: lock.port, token, fresh: false };
  }
  if (lock) removeLock(config.dataDir);
  await spawnDetached();
  const ok = await waitForHealth(config.port);
  if (!ok) {
    throw new Error(
      `service did not answer on port ${config.port}; run \`unvibe doctor\` and \`unvibe status\``,
    );
  }
  return { port: config.port, token, fresh: true };
}

async function spawnDetached(): Promise<number> {
  const config = loadConfig();
  const child = spawn(process.execPath, [cliScriptPath(), "start", "--foreground"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) throw new Error("failed to spawn the service process");
  writeLock(config.dataDir, { pid: child.pid, port: config.port, startedAt: new Date().toISOString() });
  return child.pid;
}

async function cmdStart(args: string[]): Promise<number> {
  const foreground = args.includes("--foreground");
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);
  const lock = readLock(config.dataDir);
  if (!foreground && lock && isPidAlive(lock.pid)) {
    const healthy = await isHealthOk(lock.port);
    console.log(serviceUrl(lock.port, token));
    console.log(healthy ? `already running (pid ${lock.pid})` : `already running (pid ${lock.pid}; still starting?)`);
    return 0;
  }
  if (lock && !isPidAlive(lock.pid)) removeLock(config.dataDir);
  if (foreground) {
    // Dynamic import avoids loading the server for lightweight commands
    // and keeps `stop`/`status` fast even when Fastify is unavailable.
    const { serve } = await import("../serve.js");
    await serve();
    return 0;
  }
  await spawnDetached();
  const ok = await waitForHealth(config.port);
  if (!ok) {
    console.error(`service did not answer on port ${config.port}; run \`unvibe doctor\``);
    return 1;
  }
  console.log(serviceUrl(config.port, token));
  return 0;
}

async function cmdStop(): Promise<number> {
  const config = loadConfig();
  const lock = readLock(config.dataDir);
  if (!lock) {
    console.log("Unvibe is not running.");
    return 0;
  }
  if (!isPidAlive(lock.pid)) {
    removeLock(config.dataDir);
    console.log("Unvibe was not running (stale lock removed).");
    return 0;
  }
  try {
    process.kill(lock.pid, "SIGTERM");
  } catch {
    // raced with its exit; fall through to cleanup
  }
  const deadline = Date.now() + 5000;
  while (isPidAlive(lock.pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (isPidAlive(lock.pid)) {
    try {
      process.kill(lock.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  removeOwnLock(config.dataDir, lock.pid);
  console.log("Stopped.");
  return 0;
}

async function cmdStatus(): Promise<number> {
  const config = loadConfig();
  const lock = readLock(config.dataDir);
  if (lock && isPidAlive(lock.pid)) {
    const healthy = await isHealthOk(lock.port);
    console.log(
      `running on http://127.0.0.1:${lock.port} (pid ${lock.pid}, since ${lock.startedAt || "unknown"}${healthy ? "" : "; starting?"})`,
    );
    return 0;
  }
  console.log("not running (unvibe start)");
  return 1;
}

async function cmdSetup(args: string[]): Promise<number> {
  const config = loadConfig();
  const uninstall = args.includes("--uninstall");
  if (uninstall) {
    const steps = await uninstallSetup(resolveSetupPaths());
    for (const s of steps) console.log(s);
    console.log("setup removed (token and data kept).");
    return 0;
  }
  const token = loadOrCreateToken(config.dataDir);
  void token;
  const steps = await installSetup(resolveSetupPaths());
  for (const s of steps) console.log(s);
  console.log(`token ready in ${config.dataDir}/token`);
  console.log("undo: unvibe setup --uninstall");
  return 0;
}

async function cmdOpen(): Promise<number> {
  const { port, token } = await ensureRunning();
  const url = serviceUrl(port, token);
  await openBrowser(url);
  console.log(url);
  return 0;
}

async function cmdToken(): Promise<number> {
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);
  console.log(serviceUrl(config.port, token));
  return 0;
}

async function cmdDoctorCmd(): Promise<number> {
  const config = loadConfig();
  const checks = await runDoctor({ port: config.port, dataDir: config.dataDir });
  console.log(formatDoctor(checks));
  return 0;
}

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve) => {
    const platform = os.platform();
    const opener = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    try {
      const child = spawn(opener, args, { detached: true, stdio: "ignore" });
      child.on("error", () => resolve());
      child.unref();
    } catch {
      // headless machine: the printed URL is the fallback
    }
    // Don't block the command on the browser; resolve on next tick.
    setImmediate(resolve);
  });
}

/** Dispatch argv (without the node/script prefix). Returns exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "start":
      return cmdStart(rest);
    case "stop":
      return cmdStop();
    case "status":
      return cmdStatus();
    case "setup":
      return cmdSetup(rest);
    case "open":
      return cmdOpen();
    case "token":
      return cmdToken();
    case "doctor":
      return cmdDoctorCmd();
    case "--version":
    case "-v":
    case "version": {
      const { SERVICE_VERSION } = await import("../server.js");
      console.log(SERVICE_VERSION);
      return 0;
    }
    default:
      console.error(`unknown command: ${cmd ?? "(none)"}\n\n${CLI_USAGE}`);
      return 2;
  }
}
