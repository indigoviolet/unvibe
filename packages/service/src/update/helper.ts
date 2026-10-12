/**
 * Detached switch helper: state machine (issue #36, step 2).
 *
 * The service cannot replace itself in place, so a switch runs here, in a
 * detached process that outlives the service:
 *
 * 1. wait for the service PID to exit (never kill — abort instead);
 * 2. `switchTo(to)` via the `Updater` seam (step 1 backs up the DB and
 *    installs `github:indigoviolet/unvibe#<ref>` globally; the live
 *    database stays in place and the new build opens it);
 * 3. start the service again on the same port + data dir;
 * 4. poll `/api/health` until it reports the target version;
 * 5. on install failure or an unhealthy new build: `switchTo(from, {
 *    restoreBackupOf: from })` (reinstall + restore the pre-switch
 *    backup, so the old build never opens a database the new build may
 *    have migrated), restart that, and record `rolled-back` (+ reason);
 *    when the rollback itself fails, record `failed`.
 *
 * Every step is injected through `HelperDeps` (clock, exit wait, Updater,
 * spawn, health probe, outcome record) so unit tests drive the whole
 * matrix — success, install failure → rollback, unhealthy → rollback,
 * rollback failing — without real processes, npm or network. The real
 * wiring lives in `helper-entry.ts` (the self-contained bundle the service
 * copies to the data dir and spawns detached).
 */
import type { SwitchOutcome } from "@unvibe/shared";
import type { SwitchToOptions } from "./updater.js";
import { channelSlotDir } from "./data-backup.js";

export interface SwitchPlan {
  from: string;
  to: string;
  /** Channel version the new build must report; null skips the version check (healthy is enough). */
  targetVersion: string | null;
  /** Installed version before the switch; the rollback waits for this (null = any healthy). */
  fromVersion: string | null;
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
  /**
   * Jobs the service stopped via its normal shutdown path on a forced
   * switch (#36 follow-up: `force: true` on `POST /api/update/switch`).
   * Copied onto every outcome so the UI can name the count after the
   * reload. Absent on unforced switches.
   */
  interruptedJobs?: number;
}

/** Recovery path when the app cannot come back on its own (docs + failure outcomes). */
export const RECOVER_BY_HAND =
  "Recover by hand: npm install -g github:indigoviolet/unvibe#release, then unvibe start.";

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
   * (the node that spawned the helper), never a stale path. The real
   * Updater also identifies the installed build from this path — never
   * from the helper copy's own location.
   */
  scriptPath: string;
  /** SERVICE_VERSION of the switching service (installed-build fallback). */
  serviceVersion: string;
}

export interface HelperDeps {
  waitForExit(pid: number, timeoutMs: number): Promise<boolean>;
  switchTo(ref: string, opts?: SwitchToOptions): Promise<{ from: string; to: string }>;
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
  /**
   * Wait for a healthy sample reporting `expectVersion` (null = any
   * healthy build). Resolves the last-seen state on timeout (possibly a
   * mismatched version), null only when nothing healthy answered.
   */
  pollHealth(timeoutMs: number, pollIntervalMs: number, expectVersion: string | null): Promise<ObservedHealth | null>;
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
  const finish = (outcome: Omit<SwitchOutcome, "finishedAt" | "interruptedJobs">): SwitchOutcome => {
    const full: SwitchOutcome = {
      ...outcome,
      ...(plan.interruptedJobs !== undefined ? { interruptedJobs: plan.interruptedJobs } : {}),
      finishedAt: deps.nowIso(),
    };
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
  // Wait for the expected version, trusting only samples from the
  // generation just started; a stale generation still holding the port
  // must not satisfy the check. Resolves the last-seen state on timeout
  // (for mismatch diagnostics), null only when nothing answered.
  const pollFor = async (
    timeoutMs: number,
    pollIntervalMs: number,
    expectVersion: string | null,
  ): Promise<ObservedHealth | null> => {
    const deadline = Date.now() + timeoutMs;
    // Last trusted sample (stale-holder samples never land here, so a
    // deadline with only stale answers reports "not healthy", never a
    // version from the wrong generation).
    let last: ObservedHealth | null = null;
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return last;
      const sample = await deps.pollHealth(Math.min(remaining, timeoutMs), pollIntervalMs, expectVersion);
      if (!sample) return last;
      if (activePid !== null && !(await deps.isCurrentService(activePid))) {
        deps.log(`ignoring health sample from a stale generation (want pid ${activePid})`);
        continue;
      }
      last = sample;
      if (healthMatchesTarget(sample, expectVersion)) return sample;
    }
  };

  const rollback = async (reason: string): Promise<SwitchOutcome> => {
    deps.log(`rolling back to ${plan.from}: ${reason}`);
    // Stop the unhealthy generation BEFORE the rollback install: npm must
    // not replace files under a live service, and the switch core refuses
    // while a service holds the lock. Only generations the helper itself
    // started are ever stopped — never the told-about service PID.
    if (activePid !== null) {
      deps.log(`stopping unhealthy generation (pid ${activePid}) before rolling back`);
      await deps.stopService(activePid);
      const exited = await deps.waitForExit(activePid, plan.stopWaitMs);
      const lockFree = !(await deps.isCurrentService(activePid));
      if (!exited || !lockFree) {
        deps.log(
          `warning: previous generation (pid ${activePid}) may still hold the port; attempting rollback anyway`,
        );
      }
      activePid = null;
    }
    const backupDir = channelSlotDir(plan.dataDir, plan.from);
    try {
      // Reinstall the old build AND restore the backup taken at the start
      // of this switch, so the old build never opens a database the new
      // build may have migrated.
      await deps.switchTo(plan.from, { restoreBackupOf: plan.from });
    } catch (err) {
      return finish({
        status: "failed",
        from: plan.from,
        to: plan.to,
        reason:
          `${reason}; rollback to ${plan.from} also failed: ${(err as Error).message}. ` +
          `The pre-switch database backup is in ${backupDir}. ${RECOVER_BY_HAND}`,
        logPath: plan.logPath,
      });
    }
    // Same-channel (from === to): the reinstall above IS the rollback —
    // the previous build of this ref is no longer published, so there is
    // nothing older to return to. The pre-install slot backup is retained
    // for manual recovery. Exactly one attempt here; never loops.
    await start();
    const back = await pollFor(plan.healthTimeoutMs, plan.pollIntervalMs, plan.fromVersion);
    if (back && healthMatchesTarget(back, plan.fromVersion)) {
      return finish({ status: "rolled-back", from: plan.from, to: plan.to, reason, logPath: plan.logPath });
    }
    const why = back
      ? `the rolled-back build reported ${describeHealth(back)}`
      : `the previous build did not start within ${Math.round(plan.healthTimeoutMs / 1000)} seconds`;
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason: `${reason}; ${why}. ${RECOVER_BY_HAND}`,
      logPath: plan.logPath,
    });
  };

  const exited = await deps.waitForExit(plan.servicePid, plan.exitWaitMs);
  if (!exited) {
    // The service bounds its own shutdown well inside the exit wait
    // (`SHUTDOWN_DEADLINE_MS` in `lifecycle/service-shutdown.ts`), so a
    // timeout here means the process is stuck beyond its shutdown path —
    // typically wedged connections. The install is untouched and the live
    // service keeps serving (pending was cleared); SIGKILL it into line.
    // The helper never kills the told-about PID itself.
    return finish({
      status: "failed",
      from: plan.from,
      to: plan.to,
      reason:
        `the service did not stop within ${Math.round(plan.exitWaitMs / 1000)} seconds, so nothing was installed and it is still running. ` +
        `Run \`unvibe stop\`, then switch again (or run \`unvibe update ${plan.to}\` while it is stopped)`,
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
  const healthy = await pollFor(plan.healthTimeoutMs, plan.pollIntervalMs, plan.targetVersion);
  if (healthy && healthMatchesTarget(healthy, plan.targetVersion)) {
    deps.log(`new build healthy: ${describeHealth(healthy)}`);
    return finish({ status: "ok", from: plan.from, to: plan.to, logPath: plan.logPath });
  }
  const why = healthy
    ? `new build reported ${describeHealth(healthy)} instead of ${plan.targetVersion ?? "a healthy build"}`
    : `the new build did not start within ${Math.round(plan.healthTimeoutMs / 1000)} seconds`;
  return rollback(why);
}
