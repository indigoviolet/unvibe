/**
 * Version-picker routes (issue #36, step 2).
 *
 * - `GET /api/update/status` — always available (even gated off): gate
 *   state, running build, pending switch, last helper outcome.
 * - `GET /api/update/channels[?refresh=1]` — installable channels from the
 *   `Updater` seam, cached briefly (listing shells out in the real
 *   backend, so concurrent requests share one in-flight call). Gated.
 * - `POST /api/update/switch { ref }` — validate, refuse while jobs run
 *   or a submit is in flight, record the pending switch, spawn the
 *   detached helper, reply 202, then shut down through the normal shutdown
 *   path. Gated.
 *
 * Gate: `versionPickerEnabled` in settings (off by default). Gated-off
 * channels/switch answer 404 "not available"; status keeps working so the
 * UI can show the toggle. Auth + loopback Host/Origin checks apply via the
 * global `onRequest` hook in `server.ts` like every other route.
 *
 * Without wired stores/updater/hooks the endpoints stay 501 stubs
 * (scaffold behaviour).
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type {
  UpdateChannel,
  UpdateChannelsResponse,
  UpdateStatusResponse,
  UpdateSwitchRequest,
  UpdateSwitchResponse,
} from "@unvibe/shared";
import { loadConfig } from "../config.js";
import { isNotWiredError, type Updater } from "../update/updater.js";
import { resolveBuildInfo } from "../update/build-info.js";
import type { HelperArgs } from "../update/helper.js";
import {
  hasAnySubmitLease,
  readPendingSwitch,
  readSwitchOutcome,
  updateDir,
  writePendingSwitch,
  clearPendingSwitch,
} from "../update/state.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export const UPDATE_CHANNELS_TTL_MS = 30_000;
export const UPDATE_EXIT_WAIT_MS = 30_000;
export const UPDATE_HEALTH_TIMEOUT_MS = 120_000;
export const UPDATE_POLL_MS = 500;
/** Bound for the helper stopping its own previous generation before a later start. */
export const UPDATE_STOP_WAIT_MS = 10_000;
/** Delay between the 202 reply and the shutdown trigger (lets the reply flush). */
export const UPDATE_SHUTDOWN_DELAY_MS = 500;

export const UPDATE_DISABLED_MESSAGE =
  "version picker is disabled (turn it on in Settings → Version)";

function gateEnabled(deps: RouteDeps): boolean {
  try {
    return deps.settings?.get().versionPickerEnabled === true;
  } catch {
    return false;
  }
}

function updaterErrorStatus(err: unknown): 501 | 502 {
  return isNotWiredError(err) ? 501 : 502;
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
  if (child.pid === undefined) throw new Error("failed to spawn the update helper");
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
  const TODO = { error: "not implemented" };
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
      build: resolveBuildInfo({ dataDir }),
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
    if (!gateEnabled(deps)) return reply.code(404).send({ error: UPDATE_DISABLED_MESSAGE });
    const updater = deps.updater;
    if (!updater) return reply.code(501).send({ error: "update backend not wired (issue #36 step 1)" });
    const q = req.query as Record<string, string | undefined>;
    try {
      const list = await channels(q["refresh"] === "1", updater);
      const res: UpdateChannelsResponse = { channels: list };
      return res;
    } catch (err) {
      return reply.code(updaterErrorStatus(err)).send({ error: (err as Error).message });
    }
  });

  app.post("/api/update/switch", async (req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    if (!gateEnabled(deps)) return reply.code(404).send({ error: UPDATE_DISABLED_MESSAGE });
    const body = ((req.body ?? {}) as Partial<UpdateSwitchRequest>) ?? {};
    if (typeof body.ref !== "string" || body.ref.trim() === "") {
      return reply.code(400).send({ error: "missing ref: POST /api/update/switch { ref }" });
    }
    const ref = body.ref.trim();
    const hooks = deps.updateHooks;
    if (!hooks) return reply.code(501).send({ error: "update switch not wired (no shutdown path)" });
    const updater = deps.updater;
    if (!updater) return reply.code(501).send({ error: "update backend not wired (issue #36 step 1)" });

    let list: UpdateChannel[];
    try {
      list = await channels(false, updater);
    } catch (err) {
      return reply.code(updaterErrorStatus(err)).send({ error: (err as Error).message });
    }
    const target = list.find((c) => c.ref === ref);
    if (!target) return reply.code(404).send({ error: `unknown update channel "${ref}"` });

    const pending = readPendingSwitch(ctx.dataDir);
    if (pending) {
      return reply.code(409).send({ error: `a switch to "${pending.to}" is already in progress; wait for it to finish` });
    }
    let activeJobs = 0;
    try {
      activeJobs = deps.jobs?.activeCount() ?? 0;
    } catch {
      activeJobs = 0;
    }
    if (activeJobs > 0) {
      return reply.code(409).send({
        error: `cannot switch while ${activeJobs} job${activeJobs === 1 ? " is" : "s are"} running; wait for them to finish, then retry`,
      });
    }
    let submitInflight = false;
    try {
      submitInflight = hasAnySubmitLease(ctx.db);
    } catch {
      submitInflight = false;
    }
    if (submitInflight) {
      return reply.code(409).send({ error: "cannot switch while a submit is in flight; wait for it to finish, then retry" });
    }

    const from = list.find((c) => c.current)?.ref ?? "unknown";
    const now = new Date().toISOString();
    writePendingSwitch(ctx.dataDir, { from, to: ref, startedAt: now });

    const scriptPath = process.argv[1];
    if (!scriptPath) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: "cannot switch: service entry path unknown" });
    }
    const args: HelperArgs = {
      from,
      to: ref,
      targetVersion: target.version,
      port: boundPort(app),
      dataDir: ctx.dataDir,
      servicePid: process.pid,
      exitWaitMs: UPDATE_EXIT_WAIT_MS,
      healthTimeoutMs: UPDATE_HEALTH_TIMEOUT_MS,
      pollIntervalMs: UPDATE_POLL_MS,
      stopWaitMs: UPDATE_STOP_WAIT_MS,
      logPath: path.join(updateDir(ctx.dataDir), `switch-${Date.now()}.log`),
      scriptPath,
    };
    const argsFile = path.join(updateDir(ctx.dataDir), `helper-args-${Date.now()}.json`);
    try {
      mkdirSync(updateDir(ctx.dataDir), { recursive: true });
      writeFileSync(argsFile, JSON.stringify(args, null, 2) + "\n");
      await hooks.spawnHelper(argsFile);
    } catch (err) {
      clearPendingSwitch(ctx.dataDir);
      return reply.code(500).send({ error: `could not start the update helper: ${(err as Error).message}` });
    }

    const res: UpdateSwitchResponse = { from, to: ref };
    void reply.code(202).send(res);
    // Shut down through the normal path only after the reply is on the
    // wire. Best-effort afterwards: the pending file + the spawned helper
    // are the record — if shutdown stalls, the helper aborts safely
    // (outcome `failed`, install untouched) instead of switching under us.
    setTimeout(() => {
      try {
        hooks.requestShutdown();
      } catch {
        // helper abort path covers this (see above)
      }
    }, UPDATE_SHUTDOWN_DELAY_MS);
    return undefined;
  });
}
