/**
 * Version-picker routes (issue #36, step 2; toggle meaning #231).
 *
 * - `GET /api/update/status` — always available: gate state, running
 *   build, pending switch, last helper outcome.
 * - `GET /api/update/channels[?refresh=1]` — installable channels from the
 *   `Updater` seam, cached briefly (listing shells out in the real
 *   backend, so concurrent requests share one in-flight call). Always
 *   available: releases are always listed (and the top-bar update check
 *   in #231 needs the release row regardless of the toggle); preview
 *   channels are listed only when the toggle is on.
 * - `POST /api/update/switch { ref, force? }` — validate, refuse while
 *   jobs run (structured 409 with a short job list; skipped with
 *   `force: true`, recording how many jobs the shutdown path stops) or
 *   while a submit is in flight, record the pending switch, spawn the
 *   detached helper, reply 202, then shut down through the normal shutdown
 *   path. Releases are always switchable; previews need the toggle on
 *   (404 otherwise). `force` never bypasses the submit lease, a pending
 *   switch, the preview gate, or the installed-build check.
 *
 * Gate: `versionPickerEnabled` in settings (off by default) now means
 * "show previews". Auth + loopback Host/Origin checks apply via the
 * global `onRequest` hook in `server.ts` like every other route.
 *
 * Without wired stores/updater/hooks the endpoints stay 501 stubs
 * (scaffold behaviour).
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type {
  UpdateBlockedJob,
  UpdateChannel,
  UpdateChannelsResponse,
  UpdateJobsBlockedBody,
  UpdateStatusResponse,
  UpdateSwitchRequest,
  UpdateSwitchResponse,
} from "@unvibe/shared";
import { loadConfig } from "../config.js";
import { readInstalledBuild } from "../update/channels.js";
import { resolveBuildInfo } from "../update/build-info.js";
import type { HelperArgs } from "../update/helper.js";
import type { Updater } from "../update/updater.js";
import { currentUid, isLoginManaged, loginUnitPath } from "../update/service-manager.js";
import {
  hasAnySubmitLease,
  readPendingSwitch,
  readSwitchOutcome,
  updateDir,
  writePendingSwitch,
  clearPendingSwitch,
} from "../update/state.js";
import { isNpxCachePath, UPDATE_NPX_MESSAGE } from "../cli/npx.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export const UPDATE_CHANNELS_TTL_MS = 30_000;
export const UPDATE_EXIT_WAIT_MS = 30_000;
export const UPDATE_HEALTH_TIMEOUT_MS = 120_000;
export const UPDATE_POLL_MS = 500;
/** Bound for the helper stopping its own previous generation before a later start. */
export const UPDATE_STOP_WAIT_MS = 10_000;
/**
 * Cap for the blocking-job list on the jobs-running 409 (issue #36
 * follow-up). `activeJobs` on the body carries the full count so the UI
 * can add "+N more".
 */
export const UPDATE_BLOCKED_JOBS_CAP = 5;
/** Delay between the 202 reply and the shutdown trigger (lets the reply flush). */
export const UPDATE_SHUTDOWN_DELAY_MS = 500;

/** Previews stay hidden until the toggle is on (issue #231); releases are always available. */
export const UPDATE_PREVIEWS_DISABLED_MESSAGE =
  "previews are hidden (show them in Settings → Version)";

/** Switching needs a global install with a channel record — not a source checkout. */
export const UPDATE_NOT_INSTALLED_MESSAGE =
  "switching only works when Unvibe was installed with npm — " +
  "from a source checkout, run `unvibe update` in a terminal";

/**
 * SERVICE_VERSION for build identity. Set by `server.ts`; the literal is a
 * last resort that never surfaces (an unreadable package means a null
 * channel, which refuses the switch before any version is reported).
 */
function routeServiceVersion(deps: RouteDeps): string {
  return deps.serviceVersion ?? "0.0.1";
}

function gateEnabled(deps: RouteDeps): boolean {
  try {
    return deps.settings?.get().versionPickerEnabled === true;
  } catch {
    return false;
  }
}

/** dist dir of the loaded service bundle (`dist/` in prod, `src/routes/` under vitest). */
export function serviceDistDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

/**
 * Default helper spawn for a data dir: copy the self-contained
 * `update-helper.js` bundle into `<dataDir>/update/` (so the
 * `npm install -g` swap cannot pull the running file out from under the
 * helper) and spawn the copy detached. Resolves the helper pid.
 */
export function makeDefaultSpawnHelper(dataDir: string): (argsFile: string) => Promise<number> {
  return (argsFile: string) => spawnHelperCopy(argsFile, dataDir);
}

async function spawnHelperCopy(argsFile: string, dataDir: string): Promise<number> {
  const src = path.join(serviceDistDir(), "update-helper.js");
  if (!existsSync(src)) {
    throw new Error(
      `update helper not built (missing ${src}); run \`mise run build\` first — ` +
        `the installed build predates the version picker`,
    );
  }
  mkdirSync(updateDir(dataDir), { recursive: true });
  const copy = path.join(updateDir(dataDir), `helper-${Date.now()}.js`);
  copyFileSync(src, copy);
  const child = spawn(process.execPath, [copy, argsFile], { detached: true, stdio: "ignore" });
  child.unref();
  if (child.pid === undefined) throw new Error("couldn't start the update");
  return child.pid;
}

function boundPort(app: FastifyInstance): number {
  try {
    const addr = app.server.address();
    if (addr && typeof addr === "object" && typeof (addr as { port?: unknown }).port === "number") {
      return (addr as { port: number }).port;
    }
  } catch {
    // fall through to config
  }
  try {
    return loadConfig().port;
  } catch {
    return 4517;
  }
}

export async function registerUpdate(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  const TODO = { error: "not available in this build" };
  // Channel cache (per registration, so tests with different fakes never
  // share): brief TTL + one shared in-flight call, since listing shells
  // out in the real backend and must not pile up.
  let cache: { at: number; channels: UpdateChannel[] } | null = null;
  let inflight: Promise<UpdateChannel[]> | null = null;

  async function channels(force: boolean, updater: Updater): Promise<UpdateChannel[]> {
    if (!force && cache && Date.now() - cache.at < UPDATE_CHANNELS_TTL_MS) return cache.channels;
    if (!force && inflight) return inflight;
    const call = (async (): Promise<UpdateChannel[]> => {
      const list = await updater.listChannels();
      cache = { at: Date.now(), channels: list };
      return list;
    })();
    if (!force) {
      inflight = call;
      try {
        return await call;
      } finally {
        inflight = null;
      }
    }
    return call;
  }

  function buildStatus(): UpdateStatusResponse {
    const dataDir = ctx.dataDir;
    return {
      enabled: gateEnabled(deps),
      build: resolveBuildInfo({
        dataDir,
        serviceScriptPath: process.argv[1],
        serviceVersion: routeServiceVersion(deps),
      }),
      pending: readPendingSwitch(dataDir),
      outcome: readSwitchOutcome(dataDir),
    };
  }

  app.get("/api/update/status", async (_req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    return buildStatus();
  });

  app.get("/api/update/channels", async (req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    const updater = deps.updater;
    if (!updater) return reply.code(501).send({ error: "not available in this build" });
    const q = req.query as Record<string, string | undefined>;
    try {
      const list = await channels(q["refresh"] === "1", updater);
      // Issue #231: releases are always listed; previews only with the
      // toggle on. The top-bar update check (release row) works either way.
      const visible = gateEnabled(deps) ? list : list.filter((c) => c.kind !== "preview");
      const res: UpdateChannelsResponse = { channels: visible };
      return res;
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
  });

  app.post("/api/update/switch", async (req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    const body = ((req.body ?? {}) as Partial<UpdateSwitchRequest>) ?? {};
    if (typeof body.ref !== "string" || body.ref.trim() === "") {
      return reply.code(400).send({ error: "missing ref: POST /api/update/switch { ref }" });
    }
    const ref = body.ref.trim();
    const hooks = deps.updateHooks;
    if (!hooks) return reply.code(501).send({ error: "not available in this build" });
    const updater = deps.updater;
    if (!updater) return reply.code(501).send({ error: "not available in this build" });

    // Issue #277: the service itself runs from the npx cache — switching
    // would npm-install into the default global prefix while this copy
    // keeps running. Report it as unavailable instead of running npm.
    if (isNpxCachePath(process.argv[1])) {
      return reply.code(409).send({ error: UPDATE_NPX_MESSAGE });
    }

    // `from` is the installed channel read locally: a preview ref can be
    // deleted from the remote while installed, and a rollback to
    // "unknown" cannot work. Source checkouts (and pre-field installs
    // without an inferable channel) cannot switch in-app at all — the
    // helper would restart an entry npm never renews.
    const installed = readInstalledBuild(process.argv[1], routeServiceVersion(deps));
    if (!installed.channel) {
      return reply.code(409).send({ error: UPDATE_NOT_INSTALLED_MESSAGE });
    }

    let list: UpdateChannel[];
    try {
      list = await channels(false, updater);
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message });
    }
    const target = list.find((c) => c.ref === ref);
    if (!target) return reply.code(404).send({ error: `unknown update channel "${ref}"` });

    // Issue #231: releases are always switchable; previews need the
    // toggle on (the list above is unfiltered, so hidden previews land here).
    if (target.kind === "preview" && !gateEnabled(deps)) {
      return reply.code(404).send({ error: UPDATE_PREVIEWS_DISABLED_MESSAGE });
    }

    const pending = readPendingSwitch(ctx.dataDir);
    if (pending) {
      return reply.code(409).send({ error: `a switch to "${pending.to}" is already in progress; wait for it to finish` });
    }
    // `force` skips only this refusal: the jobs are stopped by the normal
    // shutdown path after the 202 (no second cancellation mechanism), and
    // their count rides the pending switch + helper args into the outcome.
    const force = body.force === true;
    let activeJobs = 0;
    let blocked: UpdateBlockedJob[] = [];
    try {
      activeJobs = deps.jobs?.activeCount() ?? 0;
      if (activeJobs > 0) {
        blocked = (deps.jobs?.listActive(UPDATE_BLOCKED_JOBS_CAP) ?? []).map((j) => {
          const label = j.progress ?? j.cardId ?? j.annotationId;
          return {
            id: j.id,
            kind: j.kind,
            ...(j.reviewId !== undefined ? { reviewId: j.reviewId } : {}),
            state: j.state,
            ...(label ? { label } : {}),
          };
        });
      }
    } catch {
      activeJobs = 0;
      blocked = [];
    }
    if (activeJobs > 0 && !force) {
      const refused: UpdateJobsBlockedBody = {
        error: `cannot switch while ${activeJobs} job${activeJobs === 1 ? " is" : "s are"} running; wait for them to finish, then retry`,
        code: "jobs-running",
        activeJobs,
        jobs: blocked,
      };
      return reply.code(409).send(refused);
    }
    let submitInflight = false;
    try {
      submitInflight = hasAnySubmitLease(ctx.db);
    } catch {
      submitInflight = false;
    }
    if (submitInflight) {
      return reply.code(409).send({ error: "a review is being submitted — wait for it to finish, then switch" });
    }

    const from = installed.channel;
    // Same channel, same published commit: nothing to do (the publish →
    // try → fix → publish loop reinstalls only when the commit moved).
    if (from === ref && installed.commit && target.commit && installed.commit === target.commit) {
      const unchanged: UpdateSwitchResponse = { from, to: ref, unchanged: true };
      return reply.code(200).send(unchanged);
    }
    const now = new Date().toISOString();
    // Forced with jobs running: the shutdown path stops them after the
    // 202; the count rides the pending record + helper args into the
    // outcome so the UI can say so after the reload.
    const interruptedJobs = force && activeJobs > 0 ? activeJobs : undefined;
    writePendingSwitch(ctx.dataDir, {
      from,
      to: ref,
      startedAt: now,
      ...(interruptedJobs !== undefined ? { interruptedJobs } : {}),
    });

    const scriptPath = process.argv[1];
    if (!scriptPath) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: "couldn't work out where Unvibe is installed, so it can't switch — run `unvibe update` in a terminal instead" });
    }
    const args: HelperArgs = {
      from,
      to: ref,
      targetVersion: target.version,
      fromVersion: installed.version,
      port: boundPort(app),
      dataDir: ctx.dataDir,
      servicePid: process.pid,
      exitWaitMs: UPDATE_EXIT_WAIT_MS,
      healthTimeoutMs: UPDATE_HEALTH_TIMEOUT_MS,
      pollIntervalMs: UPDATE_POLL_MS,
      stopWaitMs: UPDATE_STOP_WAIT_MS,
      logPath: path.join(updateDir(ctx.dataDir), `switch-${Date.now()}.log`),
      scriptPath,
      serviceVersion: routeServiceVersion(deps),
      // Issue #170: the service repaired its PATH from the login shell at
      // boot (`serve.ts`), which is what finds `mise` for mise-managed
      // Node. Snapshot it for the detached helper, which restores it
      // before running npm (it runs after this process has exited and
      // cannot rely on re-probing from a headless context). This is what
      // keeps updates from a login-started instance (minimal PATH, issue
      // #108) working: the unit files deliberately carry no PATH.
      effectivePath: process.env.PATH ?? "",
      // Restart through the service manager when login-managed (issue
      // #108 follow-up): detected here from the real HOME in production
      // (issue #280); tests pass a scratch home via `deps.loginHome` so
      // a managed real home never reads as managed.
      managed: isLoginManaged(deps.loginHome?.homeDir ?? os.homedir(), deps.loginHome?.platform ?? process.platform),
      loginUnitPath: loginUnitPath(deps.loginHome?.homeDir ?? os.homedir(), deps.loginHome?.platform ?? process.platform),
      loginUid: currentUid(),
      ...(interruptedJobs !== undefined ? { interruptedJobs } : {}),
    };
    const argsFile = path.join(updateDir(ctx.dataDir), `helper-args-${Date.now()}.json`);
    try {
      mkdirSync(updateDir(ctx.dataDir), { recursive: true });
      writeFileSync(argsFile, JSON.stringify(args, null, 2) + "\n");
      await hooks.spawnHelper(argsFile);
    } catch (err) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: `couldn't start the update: ${(err as Error).message}` });
    }

    const res: UpdateSwitchResponse = { from, to: ref };
    void reply.code(202).send(res);
    // Shut down through the normal path only after the reply is on the
    // wire. Best-effort afterwards: the pending file + the spawned helper
    // are the record — shutdown itself is bounded (hard deadline, then
    // the process exits), and if the old process still hasn't exited the
    // helper aborts safely (outcome `failed`, install untouched, live
    // service keeps serving) instead of switching under us.
    setTimeout(() => {
      try {
        hooks.requestShutdown();
      } catch {
        // helper abort path covers this (see above)
      }
    }, hooks.shutdownDelayMs ?? UPDATE_SHUTDOWN_DELAY_MS);
    return undefined;
  });
}
