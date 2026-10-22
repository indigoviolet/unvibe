#!/usr/bin/env node
/**
 * Detached switch-helper entry (issue #36, step 2).
 *
 * Usage: `node update-helper.js <argsFile>` where `<argsFile>` is a
 * `HelperArgs` JSON file the service wrote. Runs `runSwitchFlow` with real
 * deps (exit wait, `Updater` seam, service restart, loopback health probe,
 * outcome record) and exits 0 once the outcome is recorded, 1 on
 * entry-level failure (bad args, unwritable outcome).
 *
 * Self-containment hazard: `npm install -g` replaces the package directory
 * this file was loaded from, so this entry imports only node builtins plus
 * the pure `update/` modules (bundled into one file — see `build:helper`
 * in `packages/service/package.json`). Everything is imported up front;
 * nothing is lazily loaded from the old install after the swap. The
 * service copies the bundle into `<dataDir>/update/` and spawns the copy,
 * so even the file itself survives the swap.
 *
 * The helper never kills: it only waits for the PID it was told about and
 * aborts (outcome `failed`, install untouched) when that PID stays alive.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { RealCommandRunner } from "../exec/runner.js";
import { readLock } from "../cli/lock.js";
import { FakeUpdater, RealUpdater, type Updater } from "./updater.js";
import { clearPendingSwitch, updateDir, writeSwitchOutcome } from "./state.js";
import {
  isLoginManaged,
  refreshLoginUnitIfManaged,
  startManagedService,
  stopManagedService,
} from "./service-manager.js";
import { runSwitchFlow, type HelperArgs, type ObservedHealth, applyEffectivePath } from "./helper.js";
import { findMiseBinStatic } from "./mise-find.js";
import type { SwitchOutcome } from "@unvibe/shared";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

interface HealthBody {
  ok?: unknown;
  version?: unknown;
  build?: { version?: unknown } | null;
}

/** One loopback health GET (127.0.0.1 only); null on any failure. */
function getHealthOnce(port: number, timeoutMs: number): Promise<HealthBody | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: HealthBody | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += String(chunk);
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return finish(null);
        try {
          finish(JSON.parse(body) as HealthBody);
        } catch {
          finish(null);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
  });
}

function parseArgs(raw: unknown): HelperArgs {
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => {
    if (typeof o[k] !== "string" || (o[k] as string) === "") throw new Error(`helper args: missing ${k}`);
    return o[k] as string;
  };
  const num = (k: string): number => {
    if (typeof o[k] !== "number" || !Number.isSafeInteger(o[k]) || (o[k] as number) <= 0) {
      throw new Error(`helper args: missing ${k}`);
    }
    return o[k] as number;
  };
  const versionOrNull = (k: string): string | null => {
    const v = o[k];
    if (v !== null && typeof v !== "string") throw new Error(`helper args: bad ${k}`);
    return v;
  };
  // Optional forced-switch job count (service-side only; absent otherwise).
  const interruptedJobs = (() => {
    const v = o["interruptedJobs"];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) {
      throw new Error("helper args: bad interruptedJobs");
    }
    return v;
  })();
  if (typeof o["managed"] !== "boolean") throw new Error("helper args: missing managed");
  if (typeof o["loginUnitPath"] !== "string" || (o["loginUnitPath"] as string) === "") {
    throw new Error("helper args: missing loginUnitPath");
  }
  const loginUid = o["loginUid"];
  if (loginUid !== null && (typeof loginUid !== "number" || !Number.isSafeInteger(loginUid) || loginUid < 0)) {
    throw new Error("helper args: bad loginUid");
  }
  return {
    from: str("from"),
    to: str("to"),
    targetVersion: versionOrNull("targetVersion"),
    fromVersion: versionOrNull("fromVersion"),
    port: num("port"),
    dataDir: str("dataDir"),
    servicePid: num("servicePid"),
    exitWaitMs: num("exitWaitMs"),
    healthTimeoutMs: num("healthTimeoutMs"),
    pollIntervalMs: num("pollIntervalMs"),
    stopWaitMs: num("stopWaitMs"),
    logPath: str("logPath"),
    scriptPath: str("scriptPath"),
    serviceVersion: str("serviceVersion"),
    managed: o["managed"] as boolean,
    loginUnitPath: o["loginUnitPath"] as string,
    loginUid: loginUid as number | null,
    effectivePath: str("effectivePath"),
    ...(interruptedJobs !== undefined ? { interruptedJobs } : {}),
  };
}

/** Keep the newest few per-switch files (logs, helper copies, args); best-effort. */
function pruneLogs(dataDir: string, keep = 5): void {
  let files: string[];
  try {
    files = fs.readdirSync(updateDir(dataDir)).sort();
  } catch {
    return;
  }
  const groups: Record<string, string[]> = { "switch-": [], "helper-": [], "helper-args-": [] };
  for (const f of files) {
    for (const prefix of Object.keys(groups)) {
      if (f.startsWith(prefix)) groups[prefix].push(f);
    }
  }
  for (const list of Object.values(groups)) {
    for (const f of list.slice(0, Math.max(0, list.length - keep))) {
      try {
        fs.unlinkSync(path.join(updateDir(dataDir), f));
      } catch {
        // ignore
      }
    }
  }
}

async function main(): Promise<number> {
  const argsFile = process.argv[2];
  if (!argsFile) {
    console.error("usage: node update-helper.js <argsFile>");
    return 2;
  }
  let args: HelperArgs;
  try {
    args = parseArgs(JSON.parse(fs.readFileSync(argsFile, "utf8")) as unknown);
  } catch (err) {
    console.error(`update helper: ${(err as Error).message}`);
    return 2;
  }

  const exitWaitMs = intEnv("UNVIBE_UPDATE_EXIT_WAIT_MS", args.exitWaitMs);
  const healthTimeoutMs = intEnv("UNVIBE_UPDATE_HEALTH_TIMEOUT_MS", args.healthTimeoutMs);
  const pollIntervalMs = intEnv("UNVIBE_UPDATE_POLL_MS", args.pollIntervalMs);
  const stopWaitMs = intEnv("UNVIBE_UPDATE_STOP_WAIT_MS", args.stopWaitMs);

  const logLines: string[] = [];
  const log = (message: string): void => {
    const line = `[${new Date().toISOString()}] ${message}`;
    logLines.push(line);
    try {
      fs.mkdirSync(path.dirname(args.logPath), { recursive: true });
      fs.appendFileSync(args.logPath, line + "\n");
    } catch {
      // The outcome file is the record that matters; a wedged log must not stop the switch.
    }
  };

  try {
    pruneLogs(args.dataDir);
  } catch {
    // ignore
  }
  log(`helper starting (args ${argsFile}, pid ${process.pid})`);

  // Issue #170: restore the service's login-shell-repaired PATH before
  // running npm (mise's npm wrapper calls bare `mise` after a global
  // install). The helper outlives the service, so it inherits the snapshot
  // instead of re-probing from a detached, possibly headless context.
  applyEffectivePath(args.effectivePath);
  // Issue #170 (reopened): also find mise without a shell (well-known
  // locations / current PATH) and put it first — the service's repaired
  // PATH snapshot missed mise on the owner's Mac. Static only: the
  // helper stays fast and headless-safe (no shell probe here).
  let updatePath = args.effectivePath;
  try {
    const mise = findMiseBinStatic({ inheritedPath: process.env.PATH ?? "" });
    if (mise) updatePath = [path.dirname(mise), updatePath].filter(Boolean).join(path.delimiter);
  } catch {
    // Finding mise must never stop a switch.
  }
  log(`update PATH: ${updatePath}`);

  // The installed build is identified from the service entry path in
  // the args — never from this copy's own location (it lives in the data
  // dir precisely so the npm swap cannot move it).
  const updater: Updater =
    process.env.UNVIBE_UPDATER_BACKEND === "fake"
      ? new FakeUpdater(args.dataDir)
      : new RealUpdater({
          runner: new RealCommandRunner(),
          dataDir: args.dataDir,
          serviceScriptPath: args.scriptPath,
          serviceVersion: args.serviceVersion,
          log,
          env: { PATH: updatePath },
        });

  const waitForExit = async (pid: number, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!isPidAlive(pid)) return true;
      if (Date.now() >= deadline) return !isPidAlive(pid);
      await sleep(250);
    }
  };

  const startService = async (): Promise<number | null> => {
    if (args.managed) {
      const started = await startManagedGeneration();
      if (started) return started;
      log("warning: service-manager start failed; starting directly instead (unmanaged until the next login)");
    }
    // Our own node: the helper was spawned by the service through this
    // same executable, so it always runs the restart (no stale path).
    const child = spawn(process.execPath, [args.scriptPath, "start", "--foreground"], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, UNVIBE_PORT: String(args.port), UNVIBE_DATA_DIR: args.dataDir },
    });
    child.unref();
    if (child.pid === undefined) throw new Error("failed to spawn the service restart");
    log(`service restart spawned (pid ${child.pid})`);
    // Let a missing entry fail fast instead of burning the health timeout.
    await sleep(500);
    return child.pid;
  };

  // Stop a generation the helper itself started (never the told-about
  // service PID, which is only waited on). Best-effort, never throws.
  const stopService = async (pid: number): Promise<void> => {
    if (args.managed) {
      // Never SIGTERM a manager-owned generation: with crash-only
      // restart the manager would revive it at once and fight the next
      // generation for the port. Unload through the manager instead.
      await stopManagedService(managerOp());
      return;
    }
    try {
      if (!isPidAlive(pid)) return;
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
    const deadline = Date.now() + stopWaitMs;
    for (;;) {
      await sleep(250);
      if (!isPidAlive(pid)) return;
      if (Date.now() >= deadline) {
        log(`previous generation (pid ${pid}) still alive after SIGTERM; proceeding anyway`);
        return;
      }
    }
  };

  const isCurrentService = async (pid: number): Promise<boolean> => {
    try {
      return readLock(args.dataDir)?.pid === pid;
    } catch {
      return false;
    }
  };

  /**
   * Manager plumbing for the helper's own restarts (issue #108
   * follow-up). `runManager` spawns one manager command (30 s bound —
   * a hung manager must fail the start, never the switch).
   */
  function managerOp(): {
    runner: { run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> };
    log(message: string): void;
    platform: string;
    uid: number | null;
    unitPath: string;
  } {
    return {
      runner: { run: (cmd, a) => runManager(cmd, a) },
      log,
      platform: process.platform,
      uid: args.loginUid,
      unitPath: args.loginUnitPath,
    };
  }

  function runManager(cmd: string, a: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let out = "";
      let errOut = "";
      let done = false;
      const finish = (code: number): void => {
        if (done) return;
        done = true;
        resolve({ code, stdout: out, stderr: errOut });
      };
      let child;
      try {
        child = spawn(cmd, a, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        resolve({ code: 127, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
        return;
      }
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        finish(1);
      }, 30_000);
      child.stdout?.on("data", (d) => {
        out += String(d);
      });
      child.stderr?.on("data", (d) => {
        errOut += String(d);
      });
      child.on("error", () => {
        clearTimeout(timer);
        finish(127);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        finish(typeof code === "number" ? code : 1);
      });
    });
  }

  /**
   * Restart through the service manager: stop whatever generation is
   * loaded first (covers a stacked generation the flow lost track of),
   * start, then read the generation's pid back from the data-dir lock.
   * Null when the pid could not be read (the flow skips its
   * stale-generation check for it) or when the manager failed (the
   * caller falls back to a direct spawn).
   */
  async function startManagedGeneration(): Promise<number | null> {
    const op = managerOp();
    await stopManagedService(op);
    if (!(await startManagedService(op))) return null;
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        const lock = readLock(args.dataDir);
        if (lock && isPidAlive(lock.pid)) {
          log(`managed generation holds the lock (pid ${lock.pid})`);
          return lock.pid;
        }
      } catch {
        // keep polling
      }
      if (Date.now() >= deadline) {
        log("warning: managed generation started but holds no lock yet; continuing without a pid");
        return null;
      }
      await sleep(250);
    }
  }

  /**
   * Rewrite the login unit with the just-installed paths (Q2): the global
   * npm install can move the installed files, and the helper's own node
   * plus the renewed-in-place entry are the fresh values. No-op when
   * unmanaged.
   */
  function refreshUnit(when: string): void {
    try {
      const home = process.env.HOME ?? os.homedir();
      const ok = refreshLoginUnitIfManaged(home, process.platform, {
        nodePath: process.execPath,
        cliPath: args.scriptPath,
        port: args.port,
        dataDir: args.dataDir,
      });
      // Believe the file check, not the args flag: when the unit is gone
      // (user uninstalled mid-switch) there is nothing to refresh.
      if (ok) log(`login unit refreshed ${when}`);
      else if (args.managed && !isLoginManaged(home, process.platform)) {
        log("login unit no longer installed; leaving the restart unmanaged");
      }
    } catch (err) {
      log(`warning: login unit refresh failed (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  // Wait for a sample reporting `expectVersion` (null = any healthy
  // build): the install waits for the target, the rollback waits for the
  // previous build's version — without this the rollback always burns the
  // full timeout before reporting. Resolves the last-seen state on
  // timeout (mismatch diagnostics), null when nothing answered at all.
  const pollHealth = async (
    timeoutMs: number,
    intervalMs: number,
    expectVersion: string | null,
  ): Promise<ObservedHealth | null> => {
    const deadline = Date.now() + timeoutMs;
    let last: ObservedHealth | null = null;
    for (;;) {
      const body = await getHealthOnce(args.port, 2000);
      if (body && body.ok === true && typeof body.version === "string") {
        const buildVersion =
          body.build && typeof body.build.version === "string" ? body.build.version : null;
        last = { version: body.version, buildVersion };
        const seen = buildVersion ?? body.version;
        log(`health: ${seen}`);
        if (expectVersion === null || seen === expectVersion) return last;
      }
      if (Date.now() >= deadline) return last;
      await sleep(intervalMs);
    }
  };

  const outcome = await runSwitchFlow(
    { ...args, exitWaitMs, healthTimeoutMs, pollIntervalMs, stopWaitMs },
    {
      waitForExit,
      switchTo: async (ref, opts) => {
        const switched = await updater.switchTo(ref, opts);
        refreshUnit("after install of " + switched.to);
        return switched;
      },
      startService,
      stopService,
      isCurrentService,
      pollHealth,
      recordOutcome: (o: SwitchOutcome) => writeSwitchOutcome(args.dataDir, o),
      clearPending: () => clearPendingSwitch(args.dataDir),
      log,
      nowIso: () => new Date().toISOString(),
    },
  );
  // No automatic setup (issue #220): `unvibe setup` is a manual step.
  void outcome;
  return 0;
}

const code = await main().catch((err) => {
  console.error(`update helper failed: ${(err as Error).message}`);
  return 1;
});
process.exit(code);
