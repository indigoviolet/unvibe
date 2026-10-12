/**
 * Detached switch helper: state machine (issue #36, step 2).
 *
 * The service cannot replace itself in place, so a switch runs here, in a
 * detached process that outlives the service:
 *
 * 1. wait for the service PID to exit (never kill — abort instead);
 * 2. `switchTo(to)` via the `Updater` seam (step 1 backs up the DB and
 *    installs `github:indigoviolet/unvibe#<ref>` globally);
 * 3. start the service again on the same port + data dir;
 * 4. poll `/api/health` until it reports the target version;
 * 5. on install failure or an unhealthy new build: `switchTo(from)`,
 *    restart that, and record `rolled-back` (+ reason); when the rollback
 *    itself fails, record `failed`.
 *
 * Every step is injected through `HelperDeps` (clock, exit wait, Updater,
 * spawn, health probe, outcome record) so unit tests drive the whole
 * matrix — success, install failure → rollback, unhealthy → rollback,
 * rollback failing — without real processes, npm or network. The real
 * wiring lives in `helper-entry.ts` (the self-contained bundle the service
 * copies to the data dir and spawns detached).
 */
import type { SwitchOutcome } from "@unvibe/shared";

export interface SwitchPlan {
  from: string;
  to: string;
  /** Channel version the new build must report; null skips the version check (healthy is enough). */
  targetVersion: string | null;
  port: number;
  dataDir: string;
  /** Service PID the helper was told about (waited on, never killed). */
  servicePid: number;
  exitWaitMs: number;
  healthTimeoutMs: number;
  pollIntervalMs: number;
  /** Bound for stopping the helper's own previous generation before a later start. */
  stopWaitMs: number;
  logPath: string;
}

/**
 * Last observed health state. `pollHealth` resolves null only when nothing
 * healthy answered within the timeout; a steady wrong version resolves to
 * that state so the flow reports a mismatch, not an outage.
 */
export interface ObservedHealth {
  version: string;
  buildVersion: string | null;
}

/**
 * What the service writes for the helper (`update/helper-args-*.json`):
 * the switch plan plus how to restart the service. The helper overrides
 * the three timeouts from test-only env (`UNVIBE_UPDATE_EXIT_WAIT_MS`,
 * `UNVIBE_UPDATE_HEALTH_TIMEOUT_MS`, `UNVIBE_UPDATE_POLL_MS`).
 */
export interface HelperArgs extends SwitchPlan {
  /**
   * Service entry for the restart (`process.argv[1]` of the switching
   * service — the installed `dist/index.js`, renewed in place by
   * `npm install -g`). Restarted with the helper's own `process.execPath`
   * (the node that spawned the helper), never a stale path.
   */
  scriptPath: string;
}

export interface HelperDeps {
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>;
  switchTo(ref: string): Promise<{ from: string; to: string }>;
  /** Spawn a service generation; resolves its pid. */
  startService(): Promise<number>;
  /**
   * Stop a generation the helper itself started (SIGTERM + bounded wait).
   * Best-effort, never throws. The service PID the helper was told about
   * is never passed here — that one is only waited on, never killed.
   */
  stopService(pid: number): Promise<void>;
  /**
   * True when `pid` is the generation currently holding the port (the
   * data-dir lock holder). Guards against trusting health samples from a
   * stale generation after a stacked restart.
   */
  isCurrentService(pid: number): Promise<boolean>;
  pollHealth(timeoutMs: number, pollIntervalMs: number): Promise<ObservedHealth | null>;
  recordOutcome(outcome: SwitchOutcome): void;
  clearPending(): void;
  log(message: string): void;
  nowIso(): string;
}

/** True when the observed build is the switch target. */
export function healthMatchesTarget(health: ObservedHealth, targetVersion: string | null): boolean {
  if (targetVersion === null) return true;
  return (health.buildVersion ?? health.version) === targetVersion;
}

export function describeHealth(health: ObservedHealth): string {
  const v = health.buildVersion ?? health.version;
  return health.buildVersion ? `version ${health.buildVersion} (service ${health.version})` : `version ${v}`;
}

export async function runSwitchFlow(plan: SwitchPlan, deps: HelperDeps): Promise<SwitchOutcome> {
  const finish = (outcome: Omit<SwitchOutcome, "finishedAt">): SwitchOutcome => {
    const full: SwitchOutcome = { ...outcome, finishedAt: deps.nowIso() };
    deps.log(`outcome: ${full.status} ${full.from} -> ${full.to}${full.reason ? ` (${full.reason})` : ""}`);
    deps.clearPending();
    deps.recordOutcome(full);
    return full;
  };

  deps.log(`switch ${plan.from} -> ${plan.to} (target ${plan.targetVersion ?? "any healthy"}, port ${plan.port})`);

  // Generations the helper itself started (never the told-about service
  // PID). Before a later start, the previous generation is stopped so two
  // builds never stack on the port: a live-but-wrong new build would
  // otherwise keep answering health (and the lock) while the rollback
  // generation crashes on EADDRINUSE and deletes the lock on its way out.
  let activePid: number | null = null;
  const start = async (): Promise<void> => {
    if (activePid !== null) {
      deps.log(`stopping previous generation (pid ${activePid})`);
      await deps.stopService(activePid);
      activePid = null;
    }
    activePid = await deps.startService();
  };
  // Trust only samples from the generation we just started; a stale
  // generation still holding the port must not satisfy the health check.
  const poll = async (timeoutMs: number, pollIntervalMs: number): Promise<ObservedHealth | null> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      const sample = await deps.pollHealth(Math.min(remaining, timeoutMs), pollIntervalMs);
      if (!sample) return null;
      if (activePid !== null && !(await deps.isCurrentService(activePid))) {
        deps.log(`ignoring health sample from a stale generation (want pid ${activePid})`);
        continue;
      }
      return sample;
    }
  };

  const rollback = async (reason: string): Promise<SwitchOutcome> => {
    deps.log(`rolling back to ${plan.from}: ${reason}`);
    try {
      await deps.switchTo(plan.from);
    } catch (err) {
      return finish({
        status: "failed",
        from: plan.from,
        to: plan.to,
        reason: `${reason}; rollback to ${plan.from} also failed: ${(err as Error).message}`,
        logPath: plan.logPath,
      });
    }
    await start();
    const back = await poll(plan.healthTimeoutMs, plan.pollIntervalMs);
    if (back) {
      return finish({ status: "rolled-back", from: plan.from, to: plan.to, reason, logPath: plan.logPath });
    }
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason: `${reason}; the rolled-back build did not become healthy within ${plan.healthTimeoutMs}ms`,
      logPath: plan.logPath,
    });
  };

  const exited = await deps.waitForExit(plan.servicePid, plan.exitWaitMs);
  if (!exited) {
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason:
        `service (pid ${plan.servicePid}) did not exit within ${plan.exitWaitMs}ms; ` +
        `the install was left untouched — stop the service and retry`,
      logPath: plan.logPath,
    });
  }

  try {
    const switched = await deps.switchTo(plan.to);
    deps.log(`installed ${switched.to} (was ${switched.from})`);
  } catch (err) {
    return rollback(`install of ${plan.to} failed: ${(err as Error).message}`);
  }

  await start();
  const healthy = await poll(plan.healthTimeoutMs, plan.pollIntervalMs);
  if (healthy && healthMatchesTarget(healthy, plan.targetVersion)) {
    deps.log(`new build healthy: ${describeHealth(healthy)}`);
    return finish({ status: "ok", from: plan.from, to: plan.to, logPath: plan.logPath });
  }
  const why = healthy
    ? `new build reported ${describeHealth(healthy)} instead of ${plan.targetVersion ?? "a healthy build"}`
    : `new build was not healthy within ${plan.healthTimeoutMs}ms`;
  return rollback(why);
}
