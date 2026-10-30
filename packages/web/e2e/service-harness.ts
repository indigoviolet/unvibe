/**
 * Shared harness for the real-service Playwright specs.
 *
 * Spawns the built service (`mise run build` first) on an ephemeral port
 * with a caller-provided data dir, parses its origin + token from stdout,
 * and tees all child output to `test-results/service-logs/` so CI can
 * upload service logs as artifacts on failure.
 *
 * Conventions (AGENTS.md / DEVELOPMENT.md):
 * - `UNVIBE_AGENT` is always explicit (`none` unless the spec passes
 *   `agent: "replay"`): no spec may start real agents — except the pi
 *   journey (`liveRunner: true`), which boots the real factory against a
 *   fake `pi` on PATH (no login, no spend, loopback only).
 * - `GITHUB_TOKEN` is never passed through: `gh` must use the login, never
 *   the ambient CI token (PRD §15).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function harnessRealHome(): string {
  if (process.env.UNVIBE_REAL_HOME) return process.env.UNVIBE_REAL_HOME;
  try {
    const info = os.userInfo();
    return info && info.homedir ? info.homedir : os.homedir();
  } catch {
    return os.homedir();
  }
}

export const SERVICE_ENTRY = fileURLToPath(new URL("../../service/dist/index.js", import.meta.url));

const LOG_DIR = fileURLToPath(new URL("../test-results/service-logs", import.meta.url));

export interface RunningService {
  origin: string;
  token: string;
  /** Path of the tee'd service log (kept under test-results/ for CI upload). */
  logFile: string;
  stop: () => Promise<void>;
  /** SIGKILL the child (restart journeys, #188 J6). */
  killHard: () => void;
}

export interface StartServiceOptions {
  /** Agent mode for the spawned service. Default `"none"` (pipeline disabled). */
  agent?: string;
  /**
   * Issue #279: boot the real agent factory against a fake `pi` on PATH
   * (hermetic: no login, no spend, loopback only — the fake answers from
   * fixtures). Requires `agent` unset (the live default). Sets
   * `UNVIBE_ALLOW_LIVE_AGENT=1` for the child only. The only user is the
   * pi journey; every other spec stays on `none`/`replay`.
   */
  liveRunner?: boolean;
  /**
   * Service port. Default `"0"` (ephemeral). The pi journey pins uncommon
   * fixed ports: with `0` the service's MCP mount URL keeps the literal
   * `:0`, so agent sessions cannot reach their review tools.
   */
  port?: string;
  /** Extra env entries for the child (e.g. the fake-gh SHELL/PATH stub). */
  extraEnv?: Record<string, string | undefined>;
  /** Log-file tag. Defaults to the data dir's basename. */
  label?: string;
}

/** Spawn the built service on an ephemeral port; parse origin + token. */
export async function startService(dataDir: string, opts: StartServiceOptions = {}): Promise<RunningService> {
  if (opts.liveRunner) {
    if (opts.agent !== undefined && opts.agent !== "") {
      throw new Error(`service-harness: liveRunner needs the live agent default (agent unset), got ${JSON.stringify(opts.agent)}`);
    }
  } else if (opts.agent !== undefined && opts.agent !== "none" && opts.agent !== "replay") {
    throw new Error(`service-harness: refusing non-hermetic agent mode ${JSON.stringify(opts.agent)} (#188)`);
  }
  if (!existsSync(SERVICE_ENTRY)) {
    throw new Error(`service not built: run \`mise run build\` first (missing ${SERVICE_ENTRY})`);
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const label = (opts.label ?? path.basename(dataDir)).replace(/[^A-Za-z0-9_.-]+/g, "_");
  const logFile = path.join(LOG_DIR, `service-${label}.log`);
  const log = (chunk: Buffer | string) => {
    try {
      appendFileSync(logFile, chunk);
    } catch {
      // Logging must never fail the test.
    }
  };
  log(`--- startService dataDir=${dataDir} agent=${opts.agent ?? "none"} at ${new Date().toISOString()} ---\n`);

  const env: Record<string, string | undefined> = { ...process.env, ...opts.extraEnv };
  delete env.GITHUB_TOKEN;
  // Real-home guard (#313): every spawned service is a test run, and the
  // real home is the one captured at harness start.
  env.UNVIBE_TEST = "1";
  env.UNVIBE_REAL_HOME = harnessRealHome();
  // Update-helper drills (fake updater) must never see the real login
  // unit: give them a scratch HOME unless the spec already set one.
  let harnessHome: string | null = null;
  if (env.UNVIBE_UPDATER_BACKEND === "fake" && !opts.extraEnv?.HOME) {
    harnessHome = mkdtempSync(path.join(os.tmpdir(), "unvibe-harness-home-"));
    env.HOME = harnessHome;
  }
  if (opts.liveRunner) {
    // Hermetic live factory for the pi journey only (fake binary, no spend).
    env.UNVIBE_ALLOW_LIVE_AGENT = "1";
    log(`--- startService LIVE-RUNNER (fake pi, no spend) ---\n`);
  } else {
    delete env.UNVIBE_ALLOW_LIVE_AGENT;
  }
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: {
      ...env,
      UNVIBE_DATA_DIR: dataDir,
      UNVIBE_PORT: opts.port ?? "0",
      UNVIBE_REPO_ROOTS: "",
      // No agent behaviour under test unless the spec opts into replay:
      // a background pipeline must not mutate the review mid-test.
      // liveRunner uses the live default (real factory, fake pi on PATH).
      UNVIBE_AGENT: opts.liveRunner ? "" : (opts.agent ?? "none"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group (issue #300): stop() signals and reaps the whole
    // group, so version probes and login shells the service spawned (real
    // agent CLIs' first-run state, mise, compinit dumps) cannot outlive the
    // service and recreate a removed scratch HOME after cleanup.
    detached: true,
  });
  let out = "";
  const started = new Promise<{ origin: string; token: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`service did not start (see ${logFile}): ${out}`)), 30_000);
    proc.stdout?.on("data", (d: Buffer) => {
      log(d);
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/(?:unvibe\.localhost|127\.0\.0\.1):\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.stderr?.on("data", (d: Buffer) => {
      log(d);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`service exited with ${code} (see ${logFile}): ${out}`));
      }
    });
  });
  const { origin, token } = await started;
  return {
    origin,
    token,
    logFile,
    killHard: () => proc.kill("SIGKILL"),
    stop: async () => {
      await stopService(proc, log, label);
      if (harnessHome) {
        try {
          rmSync(harnessHome, { recursive: true, force: true });
        } catch {
          // best effort; the per-run temp guard will flag a leftover
        }
      }
    },
  };
}

/** Signal the service's whole process group (service + descendants). Never throws. */
function signalGroup(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      // Already gone.
    }
  }
}

/** True when no process remains in the group (ESRCH on signal 0). */
function groupEmpty(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException)?.code === "ESRCH";
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Stop the service and reap its whole process group (issue #300).
 *
 * `proc.kill("SIGTERM")` alone leaves the service's children behind:
 * login-shell PATH probes, `mise which` shim resolutions and version
 * probes of the real agent CLIs keep running reparented, and their
 * first-run writes (a codex plugin clone, claude/pi/mise state, zsh
 * completion dumps) can recreate a scratch HOME after the journey
 * removes it, tripping the e2e temp guard. Signalling the group and
 * waiting for it to drain makes the removal safe. Bounded throughout so
 * a hung child cannot hang the suite; `killHard` stays process-only
 * (it simulates a crash, where orphans are faithful).
 */
async function stopService(
  proc: ChildProcess,
  log: (chunk: string | Buffer) => void,
  label: string,
): Promise<void> {
  const pid = proc.pid;
  if (pid === undefined) return;
  log(`--- stop ${label} pid=${pid} at ${new Date().toISOString()} ---\n`);
  const exited = new Promise<void>((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) resolve();
    else proc.once("exit", () => resolve());
  });
  signalGroup(pid, "SIGTERM");
  const termed = await Promise.race([exited.then(() => true), sleep(8000).then(() => false)]);
  if (!termed) {
    log(`--- stop ${label}: service alive 8s after SIGTERM; SIGKILL group ---\n`);
    signalGroup(pid, "SIGKILL");
    await Promise.race([exited, sleep(5000)]);
  }
  let drained = groupEmpty(pid);
  const drainUntil = Date.now() + 5000;
  while (!drained && Date.now() < drainUntil) {
    await sleep(100);
    drained = groupEmpty(pid);
  }
  if (!drained) {
    log(`--- stop ${label}: group not drained; SIGKILL group ---\n`);
    signalGroup(pid, "SIGKILL");
    const killUntil = Date.now() + 5000;
    while (!groupEmpty(pid) && Date.now() < killUntil) await sleep(100);
    if (!groupEmpty(pid)) log(`--- stop ${label}: WARNING group still alive; continuing ---\n`);
  }
}
