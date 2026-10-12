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
import { installSetup, resolveSetupPaths, uninstallSetup } from "./setup/index.js";

export const CLI_USAGE = [
  "unvibe: read and review code changes on your machine",
  "",
  "Usage: unvibe <command>",
  "",
  "  start [--foreground]   start the service (reuses it when already running)",
  "  stop                   stop the running service",
  "  status                 show whether the service is running (exit 1 when it is not)",
  "  setup [--uninstall]    install the unvibe:// link handler that lets the app start the service (safe to run again)",
  "  open                   start if needed, open the app URL in a browser",
  "  token                  print the app URL, including your token",
  "  doctor [--strict]      check node, git, gh, agents, PATH, data dir, port (exit 1 on problems with --strict)",
  "  update --list          list the channels you can install (release, release-rc, preview/*)",
  "  update <channel>       install that channel (npm install -g github:indigoviolet/unvibe#<channel>)",
  "  version                print the installed version",
  "  (no command)           start the service in the foreground",
  "",
  "Environment variables:",
  "  UNVIBE_PORT       port to listen on (default 4517)",
  "  UNVIBE_DATA_DIR   where reviews and settings are kept (default ~/.local/share/unvibe)",
  "  UNVIBE_IDLE_MS    stop the service after this long with no open window (default 600000 = 10 minutes; 0 or less: never)",
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
  if (child.pid === undefined) throw new Error("couldn't start the service process");
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
    // serve() returns after logging while the server lives on in the event
    // loop — never fall through to the dispatcher's process.exit().
    await new Promise<never>(() => {});
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
    console.log("not running");
    return 0;
  }
  if (!isPidAlive(lock.pid)) {
    removeLock(config.dataDir);
    console.log("not running (removed a leftover lock file)");
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
  console.log("stopped");
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
  console.log("not running (start it with: unvibe start)");
  return 1;
}

async function cmdSetup(args: string[]): Promise<number> {
  const config = loadConfig();
  const uninstall = args.includes("--uninstall");
  if (uninstall) {
    const steps = await uninstallSetup(resolveSetupPaths());
    for (const s of steps) console.log(s);
    console.log("removed the link handler (token and data kept)");
    return 0;
  }
  const token = loadOrCreateToken(config.dataDir);
  void token;
  const steps = await installSetup(resolveSetupPaths());
  for (const s of steps) console.log(s);
  console.log(`token ready in ${config.dataDir}/token`);
  console.log("to undo: unvibe setup --uninstall");
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

async function cmdDoctorCmd(args: string[]): Promise<number> {
  const strict = args.includes("--strict");
  const config = loadConfig();
  const { runDoctor, formatDoctor, getDoctorDiagnostics, fetchServiceDiagnostics, diffDiagnostics } = await import(
    "./doctor.js"
  );
  const checks = await runDoctor({ port: config.port, dataDir: config.dataDir });
  console.log(formatDoctor(checks));
  // When a service is running, report what it sees and say plainly when
  // that differs from doctor's own view (issue #20).
  try {
    const { isHealthOk, readLock } = await import("./lock.js");
    const { loadOrCreateToken } = await import("../auth.js");
    if (await isHealthOk(config.port)) {
      const lock = readLock(config.dataDir);
      const port = lock?.port ?? config.port;
      let token = "";
      try {
        token = loadOrCreateToken(config.dataDir);
      } catch {
        token = "";
      }
      if (token) {
        const [local, remote] = await Promise.all([
          getDoctorDiagnostics({ port: config.port, dataDir: config.dataDir }).catch(() => null),
          fetchServiceDiagnostics(port, token).catch(() => null),
        ]);
        if (local && remote) {
          const diffs = diffDiagnostics(local, remote);
          if (diffs.length === 0) {
            console.log(`\nService (pid ${remote.service.pid}, ${remote.service.startMode}) agrees: same PATH and tool choices.`);
          } else {
            console.log(`\nService (pid ${remote.service.pid}, ${remote.service.startMode}) differs from this terminal:`);
            for (const d of diffs) console.log(`  ! ${d}`);
            console.log("Fix your shell startup files, then restart the service (or use Settings → Environment → Reload environment).");
          }
        } else if (local && !remote) {
          console.log("\nThe service is running but did not answer, so the checks above cover this terminal only.");
        }
      }
    } else {
      console.log("\nThe service is not running, so the checks above cover this terminal only. Start it to compare.");
    }
  } catch {
    // Doctor stays informational; comparison failures never break it.
  }
  if (strict) {
    const bad = checks.some((c) => c.status !== "ok");
    return bad ? 1 : 0;
  }
  return 0;
}

async function cmdUpdate(args: string[]): Promise<number> {
  const { UPDATE_USAGE, runUpdateChannelFlow, runUpdateListFlow } = await import("./update-flows.js");
  const { RealCommandRunner } = await import("../exec/runner.js");
  const { SERVICE_VERSION } = await import("../server.js");
  if (args.includes("--help") || args.includes("-h")) {
    console.log(UPDATE_USAGE);
    return 0;
  }
  const config = loadConfig();
  const deps = {
    runner: new RealCommandRunner(),
    dataDir: config.dataDir,
    cliScriptPath: process.argv[1],
    serviceVersion: SERVICE_VERSION,
  };
  if (args.includes("--list")) {
    const outcome = await runUpdateListFlow(deps);
    for (const line of outcome.lines) console.log(line);
    return outcome.code;
  }
  const channel = args.find((a) => !a.startsWith("-"));
  if (!channel) {
    console.error(`missing channel.\n\n${UPDATE_USAGE}`);
    return 2;
  }
  const unknown = args.filter((a) => a.startsWith("-"));
  if (unknown.length > 0) {
    console.error(`unknown flag: ${unknown.join(" ")}\n\n${UPDATE_USAGE}`);
    return 2;
  }
  const outcome = await runUpdateChannelFlow(deps, channel);
  for (const line of outcome.lines) {
    if (outcome.code === 0) console.log(line);
    else console.error(line);
  }
  return outcome.code;
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
      return cmdDoctorCmd(rest);
    case "update":
      return cmdUpdate(rest);
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
