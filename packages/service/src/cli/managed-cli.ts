/**
 * Manager-aware `start`/`stop`/`status` (issue #108, follow-up).
 *
 * Rule: when the login unit is installed ("managed" — detected from the
 * unit file's presence under `homeDir`), process control goes through the
 * service manager (`launchctl` on macOS, `systemctl --user` on Linux).
 * Otherwise the CLI owns the process directly, exactly as before.
 *
 * - `stop` on a managed service unloads it (`bootout` / `systemctl stop`);
 *   the crash-only restart (`KeepAlive SuccessfulExit:false`,
 *   `Restart=on-failure`) respects the deliberate stop. When the manager
 *   cannot do it (headless session, job not loaded) and the lock still
 *   names a live pid, it falls back to the pid-based stop.
 * - `start` on a managed service loads/starts it through the manager and
 *   verifies health. On failure it unloads again (so a broken job cannot
 *   crash-loop on the port) and, as a last resort, spawns directly with a
 *   warning (unmanaged: idle exit applies until the next login).
 * - `status` names login management.
 *
 * Everything process- or network-shaped comes through `CliDeps` so tests
 * drive the whole matrix with a stub runner, fake HOME and fake probes.
 */
import { spawn } from "node:child_process";
import { writeLock, type ServiceLock } from "./lock.js";
import { bookmarkUrl, serviceUrl } from "./urls.js";
import {
  isLoginManaged,
  loginUnitPath,
  managedStatusText,
  startManagedService,
  stopManagedService,
  unloadManagedService,
  type ManagerRunner,
} from "../update/service-manager.js";

export interface CliDeps {
  homeDir: string;
  platform: string;
  uid: number | null;
  runner: ManagerRunner;
  dataDir: string;
  port: number;
  token: string;
  cliScriptPath: string;
  readLock(dataDir: string): ServiceLock | null;
  removeLock(dataDir: string): void;
  removeOwnLock(dataDir: string, pid: number): void;
  isPidAlive(pid: number): boolean;
  isHealthOk(port: number): Promise<boolean>;
  waitForHealth(port: number): Promise<boolean>;
  kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  /** Spawn a detached `start --foreground` child (legacy path); resolves its pid. */
  spawnDetached(): Promise<number>;
  /** Run the service in this process (foreground). */
  serveForeground(): Promise<void>;
  log(line: string): void;
  err(line: string): void;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** Spawn a detached `start --foreground` child and record its lock. */
export async function spawnDetachedService(d: CliDeps): Promise<number> {
  const child = spawn(process.execPath, [d.cliScriptPath, "start", "--foreground"], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  if (child.pid === undefined) throw new Error("couldn't start the service process");
  const lock: ServiceLock = { pid: child.pid, port: d.port, startedAt: new Date().toISOString() };
  writeLock(d.dataDir, lock);
  return child.pid;
}

/** True when health stops answering within the bound. */
async function waitForDown(d: CliDeps, timeoutMs = 8000): Promise<boolean> {
  const deadline = d.now() + timeoutMs;
  for (;;) {
    if (!(await d.isHealthOk(d.port))) return true;
    if (d.now() >= deadline) return false;
    await d.sleep(250);
  }
}

function managedOp(d: CliDeps): { platform: string; uid: number | null; unitPath: string } {
  return { platform: d.platform, uid: d.uid, unitPath: loginUnitPath(d.homeDir, d.platform) };
}

function isManaged(d: CliDeps): boolean {
  return isLoginManaged(d.homeDir, d.platform);
}

/** Legacy pid-based stop (today's behaviour, unchanged). Returns the exit code. */
async function legacyStop(d: CliDeps): Promise<number> {
  const lock = d.readLock(d.dataDir);
  if (!lock) {
    d.log("not running");
    return 0;
  }
  if (!d.isPidAlive(lock.pid)) {
    d.removeLock(d.dataDir);
    d.log("not running (removed a leftover lock file)");
    return 0;
  }
  try {
    d.kill(lock.pid, "SIGTERM");
  } catch {
    // raced with its exit; fall through to cleanup
  }
  const deadline = d.now() + 5000;
  while (d.isPidAlive(lock.pid) && d.now() < deadline) {
    await d.sleep(100);
  }
  if (d.isPidAlive(lock.pid)) {
    try {
      d.kill(lock.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  d.removeOwnLock(d.dataDir, lock.pid);
  d.log("stopped");
  return 0;
}

export async function cliStop(d: CliDeps): Promise<number> {
  if (isManaged(d)) {
    const op = { runner: d.runner, log: d.log, ...managedOp(d) };
    await stopManagedService(op);
    if (await waitForDown(d)) {
      // A stale lock from a dead generation must not linger.
      const lock = d.readLock(d.dataDir);
      if (lock && !d.isPidAlive(lock.pid)) d.removeLock(d.dataDir);
      d.log("stopped");
      return 0;
    }
    // Still answering: not ours to unload (a manual instance?), or the
    // manager is unreachable — fall back to the pid stop.
    d.log("warning: the service is still answering; stopping it directly");
    return legacyStop(d);
  }
  return legacyStop(d);
}

/** Start through the manager and verify health; unload + false when it never answers. */
async function managerStartAndVerify(d: CliDeps): Promise<boolean> {
  const op = { runner: d.runner, log: d.log, ...managedOp(d) };
  // A stale lock must not read as "already running" below.
  const lock = d.readLock(d.dataDir);
  if (lock && !d.isPidAlive(lock.pid)) d.removeLock(d.dataDir);
  if (!(await startManagedService(op))) return false;
  if (await d.waitForHealth(d.port)) return true;
  // Never healthy: unload again so a broken job cannot crash-loop on the
  // port (two instances must never fight for it).
  await unloadManagedService(op);
  return false;
}

async function legacyStartBackground(d: CliDeps): Promise<number> {
  await d.spawnDetached();
  const ok = await d.waitForHealth(d.port);
  if (!ok) {
    d.err(`service did not answer on port ${d.port}; run \`unvibe doctor\``);
    return 1;
  }
  d.log(serviceUrl(d.port, d.token));
  return 0;
}

export async function cliStart(d: CliDeps, args: string[]): Promise<number> {
  const foreground = args.includes("--foreground");
  if (foreground) {
    // The managed child itself, or a manual foreground run: no manager
    // logic (it IS the process being managed).
    const lock = d.readLock(d.dataDir);
    if (lock && !d.isPidAlive(lock.pid)) d.removeLock(d.dataDir);
    await d.serveForeground();
    // serve() returns after logging while the server lives on in the event
    // loop — never fall through to the dispatcher's process.exit().
    await new Promise<never>(() => {});
  }
  const managed = isManaged(d);
  const lock = d.readLock(d.dataDir);
  if (lock && d.isPidAlive(lock.pid)) {
    const healthy = await d.isHealthOk(lock.port);
    d.log(serviceUrl(lock.port, d.token));
    d.log(healthy ? `already running (pid ${lock.pid})` : `already running (pid ${lock.pid}; still starting?)`);
    return 0;
  }
  if (lock && !d.isPidAlive(lock.pid)) d.removeLock(d.dataDir);
  if (managed) {
    if (await managerStartAndVerify(d)) {
      d.log(serviceUrl(d.port, d.token));
      return 0;
    }
    d.log("warning: login start unavailable; starting directly instead (idle exit applies until the next login)");
  }
  return legacyStartBackground(d);
}

export async function cliStatus(d: CliDeps): Promise<number> {
  const managed = managedStatusText(d.homeDir, d.platform);
  const lock = d.readLock(d.dataDir);
  if (lock && d.isPidAlive(lock.pid)) {
    const healthy = await d.isHealthOk(lock.port);
    d.log(
      `running on ${bookmarkUrl(lock.port)} (pid ${lock.pid}, since ${lock.startedAt || "unknown"}${healthy ? "" : "; starting?"}${managed ? "; starts at login" : ""})`,
    );
    return 0;
  }
  d.log(managed ? "not running (starts at login; start it with: unvibe start)" : "not running (start it with: unvibe start)");
  return 1;
}

export async function cliEnsureRunning(d: CliDeps): Promise<{ port: number; token: string; fresh: boolean }> {
  const lock = d.readLock(d.dataDir);
  if (lock && d.isPidAlive(lock.pid)) {
    return { port: lock.port, token: d.token, fresh: false };
  }
  if (lock) d.removeLock(d.dataDir);
  if (isManaged(d)) {
    if (await managerStartAndVerify(d)) {
      return { port: d.port, token: d.token, fresh: true };
    }
    d.log("warning: login start unavailable; starting directly instead (idle exit applies until the next login)");
  }
  await d.spawnDetached();
  const ok = await d.waitForHealth(d.port);
  if (!ok) {
    throw new Error(`service did not answer on port ${d.port}; run \`unvibe doctor\` and \`unvibe status\``);
  }
  return { port: d.port, token: d.token, fresh: true };
}
