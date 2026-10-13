/**
 * Start-at-login service management (issue #108).
 *
 * Rule: when the login unit is installed ("managed"), all process control
 * goes through the service manager — `launchctl` on macOS, `systemctl
 * --user` on Linux. When it is not installed, the CLI owns the process
 * directly, exactly as before. "Managed" is detected from the unit file's
 * presence under a home dir (the real `os.homedir()` at runtime; tests
 * pass a fake HOME).
 *
 * Why: the units restart the service on crash (macOS `KeepAlive` with
 * `SuccessfulExit: false`, Linux `Restart=on-failure`), so a deliberate
 * stop must go through the manager — SIGTERMing the pid directly would be
 * undone on macOS, and a directly-spawned replacement on Linux would run
 * unmanaged (with idle exit) beside the still-enabled unit. The update
 * helper restarts through the manager for the same reason: a direct spawn
 * would leave an unmanaged generation holding the port while launchd's
 * next login start crashes on EADDRINUSE.
 *
 * Bundle note: this module is imported by the self-contained
 * `dist/update-helper.js` bundle (issue #36), so it may use node builtins
 * only (`fs`/`os`/`path`) and must not import sibling `src/` modules. The
 * content builders (`launchdPlistContent`, `systemdUnitContent`) stay in
 * `cli/setup/login.ts`, which imports the constants and paths from here.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const LAUNCHD_LABEL = "com.unvibe.service";
export const LAUNCHD_PLIST_FILENAME = `${LAUNCHD_LABEL}.plist`;
export const SYSTEMD_UNIT_NAME = "unvibe.service";

export type ManagerPlatform = "darwin" | "linux";

/** `~/Library/LaunchAgents/com.unvibe.service.plist` (macOS). */
export function launchdPlistPath(homeDir: string): string {
  return path.join(homeDir, "Library", "LaunchAgents", LAUNCHD_PLIST_FILENAME);
}

/** `~/.config/systemd/user/unvibe.service` (Linux). */
export function systemdUnitPath(homeDir: string): string {
  return path.join(homeDir, ".config", "systemd", "user", SYSTEMD_UNIT_NAME);
}

/** Unit file for this platform under a home dir. */
export function loginUnitPath(homeDir: string, platform: string): string {
  return platform === "darwin" ? launchdPlistPath(homeDir) : systemdUnitPath(homeDir);
}

/** True when `unvibe setup` installed the start-at-login unit. */
export function isLoginManaged(homeDir: string, platform: string): boolean {
  try {
    return fs.existsSync(loginUnitPath(homeDir, platform));
  } catch {
    return false;
  }
}

/** Current uid for `launchctl ... gui/<uid>/...`, or null when unknown. */
export function currentUid(): number | null {
  try {
    const uid = os.userInfo().uid;
    return typeof uid === "number" && Number.isSafeInteger(uid) ? uid : null;
  } catch {
    return null;
  }
}

export interface ManagerCmd {
  cmd: string;
  args: string[];
}

/** Stop the managed service (deliberate stop; crash-only restart leaves it down). */
export function stopServiceCommands(platform: string, uid: number | null): ManagerCmd[] {
  if (platform === "darwin" && uid !== null) {
    return [{ cmd: "launchctl", args: ["bootout", `gui/${uid}/${LAUNCHD_LABEL}`] }];
  }
  if (platform === "darwin") return [];
  return [{ cmd: "systemctl", args: ["--user", "stop", SYSTEMD_UNIT_NAME] }];
}

/**
 * Start (or reload) the managed service. macOS `bootstrap` loads the job
 * (and starts it via RunAtLoad); when it is already loaded but down,
 * callers fall back to `kickstartServiceCommands`.
 */
export function startServiceCommands(platform: string, uid: number | null, unitPath: string): ManagerCmd[] {
  if (platform === "darwin") {
    if (uid === null) return [];
    return [{ cmd: "launchctl", args: ["bootstrap", `gui/${uid}`, unitPath] }];
  }
  return [{ cmd: "systemctl", args: ["--user", "start", SYSTEMD_UNIT_NAME] }];
}

/** Start an already-loaded but stopped launchd job. */
export function kickstartServiceCommands(uid: number | null): ManagerCmd[] {
  if (uid === null) return [];
  return [{ cmd: "launchctl", args: ["kickstart", `gui/${uid}/${LAUNCHD_LABEL}`] }];
}

/** After a failed manager start, unload again so a broken job cannot crash-loop on the port. */
export function unloadServiceCommands(platform: string, uid: number | null): ManagerCmd[] {
  return stopServiceCommands(platform, uid);
}

export interface ManagerRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ManagerRunner {
  run(cmd: string, args: string[]): Promise<ManagerRunResult>;
}

export interface ManagerOp {
  runner: ManagerRunner;
  log(message: string): void;
  platform: string;
  uid: number | null;
  unitPath: string;
}

async function runManagerCmd(op: ManagerOp, c: ManagerCmd): Promise<ManagerRunResult> {
  try {
    return await op.runner.run(c.cmd, c.args);
  } catch (err) {
    // The stub runner never throws, but stay best-effort regardless.
    return { code: 1, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Stop the managed service. Best-effort, never throws: a failing manager
 * (headless session, job not loaded) just means the caller falls back to
 * the pid-based stop. Returns whether the manager reported success.
 */
export async function stopManagedService(op: ManagerOp): Promise<boolean> {
  const cmds = stopServiceCommands(op.platform, op.uid);
  if (cmds.length === 0) return false;
  let ok = true;
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code !== 0) {
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
      ok = false;
    }
  }
  return ok;
}

/**
 * Start the managed service. Never throws; returns true when a manager
 * command reported success (the caller still verifies health). macOS
 * falls back to `kickstart` when `bootstrap` fails (already loaded).
 */
export async function startManagedService(op: ManagerOp): Promise<boolean> {
  const cmds = startServiceCommands(op.platform, op.uid, op.unitPath);
  if (cmds.length === 0) {
    op.log("warning: cannot drive the service manager here (no login uid); falling back");
    return false;
  }
  for (const c of cmds) {
    const r = await runManagerCmd(op, c);
    if (r.code === 0) return true;
    op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
  }
  if (op.platform === "darwin") {
    for (const c of kickstartServiceCommands(op.uid)) {
      const r = await runManagerCmd(op, c);
      if (r.code === 0) return true;
      op.log(`warning: ${c.cmd} ${c.args.join(" ")} exited ${r.code} (${r.stderr.trim() || r.stdout.trim() || "no output"})`);
    }
  }
  return false;
}

/** Best-effort unload after a failed start, so a broken job cannot crash-loop on the port. */
export async function unloadManagedService(op: ManagerOp): Promise<void> {
  for (const c of unloadServiceCommands(op.platform, op.uid)) {
    await runManagerCmd(op, c);
  }
}

/** `status` suffix naming login management. */
export function managedStatusText(homeDir: string, platform: string): string | null {
  if (!isLoginManaged(homeDir, platform)) return null;
  return "starts at login";
}
