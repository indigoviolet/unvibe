/**
 * Foreground service entry (PRD §14).
 *
 * Started by the `unvibe` CLI (`start --foreground`, or with no command
 * for `mise run start`). `buildApp` is the single composition root (M3);
 * this module owns the shutdown hooks and idle-exit wiring; the CLI layer
 * (`src/cli/`) handles daemonising.
 */
import type { FastifyInstance } from "fastify";
import { loadOrCreateToken } from "./auth.js";
import { removeOwnLock, writeLock } from "./cli/lock.js";
import { loadConfig } from "./config.js";
import { applyLoginShellPath } from "./diagnostics/path-probe.js";
import { sweepProbeTmp } from "./diagnostics/tools.js";
import { shutdownService, type ServiceShutdownReport, type ServiceShutdownSteps } from "./lifecycle/index.js";
import { createApp, listen } from "./server.js";
import { makeDefaultSpawnHelper } from "./routes/update.js";
import { isSwitchPending } from "./update/index.js";
import { isAcpRunner } from "./agent/factory.js";
import { dbFilePath } from "./store/index.js";
import { migrate, openDatabase } from "./store/index.js";
import { checkDataFormat, stampDataFormat } from "./data-format.js";
import { initSentry } from "./telemetry/sentry.js";

export async function serve(): Promise<void> {
  // Product entry (#188): only this path and `mise run test:live:*` may
  // start real agents. Set before buildApp composes the runner.
  process.env.UNVIBE_ALLOW_LIVE_AGENT = "1";
  // Dev-only error reporting (issue #29): on only with SENTRY_DSN_SERVICE.
  const sentry = await initSentry();
  const config = loadConfig();
  // #311: a data-format reset restarts the service into a fresh
  // generation (same process, same port) after moving the data aside.
  for (;;) {
    const restarted = await serveGeneration(config, sentry);
    if (!restarted) return;
  }
}

async function serveGeneration(
  config: ReturnType<typeof loadConfig>,
  sentry: Awaited<ReturnType<typeof initSentry>>,
): Promise<boolean> {
  // #311: check the stored format before touching anything. On a
  // mismatch the old DB is never opened for writing (the app context
  // runs on an in-memory DB) and the web app shows the reset notice;
  // only the read-only Outbox export reads the stored DB.
  const formatStatus = checkDataFormat(config.dataDir);
  const blocked = formatStatus.state === "mismatch";
  if (blocked) {
    console.log(
      `Unvibe: your stored data is format ${formatStatus.stored ?? "(unstamped)"} but this version reads format ${formatStatus.expected}. ` +
        `Open the app to export your Outbox and reset, or run \`unvibe reset-data\`. Your data has not been touched.`,
    );
  }
  const token = loadOrCreateToken(config.dataDir);

  // macOS gotcha (PRD §14): pick up the login-shell PATH so gh/git/agents resolve.
  try {
    await applyLoginShellPath();
  } catch {
    // non-fatal: keep the inherited PATH
  }

  // Orphaned probe dirs (issue #279): a SIGKILLed service never runs
  // the diagnoseTool finally, so sweep our own `<dataDir>/tmp/` entries
  // here at startup (each service owns its data dir, so nothing
  // concurrent is touched). Skipped when blocked: the old data dir is
  // left exactly as it was until the user resets it.
  if (!blocked) sweepProbeTmp(config.dataDir);

  // Blocked generations pass no DB: `createApp` falls back to an
  // in-memory one, so nothing opens the stored DB for writing.
  const db = blocked ? undefined : openDatabase(dbFilePath(config.dataDir));
  if (db) {
    migrate(db);
    stampDataFormat(db);
  }

  // buildApp (via createApp) is the single composition root: agent runner
  // defaults to ACP (real subprocesses), replay only with UNVIBE_AGENT.
  // The lifecycle closure reads through this holder (assigned after
  // createApp) so idle exit sees the real job queue (M3 activeCount).
  const holder: { ctx?: import("./app.js").AppContext } = {};
  // PID for the foreground lock + the switch helper's exit wait. Defined
  // before createApp so the switch shutdown path can close over it.
  const me = process.pid;
  // One shared shutdown path for SIGTERM/SIGINT, idle exit and the switch
  // request (issues #30, #36 follow-up): assigned after createApp (it
  // closes over the context), safe to call twice — the second call waits
  // on the same run instead of tearing down twice.
  let shutdownAndExit: () => void = () => {};
  // #311: resolves true when this generation shut down for a data reset
  // (the caller starts a fresh generation instead of exiting).
  let restartWanted = false;
  let resolveGeneration: (restarted: boolean) => void = () => {};
  const generationDone = new Promise<boolean>((resolve) => {
    resolveGeneration = resolve;
  });
  const created = await createApp(token, {
    ...(db ? { db } : {}),
    dataDir: config.dataDir,
    mcpBaseUrl: `http://127.0.0.1:${config.port}`,
    lifecycle: {
      idleMs: config.idleMs,
      // A committed switch suppresses idle exit: the helper is about to
      // (or already did) shut us down itself, and must never race exit.
      hasJobs: () =>
        (holder.ctx ? holder.ctx.jobs.activeCount() > 0 : false) || isSwitchPending(config.dataDir),
      onIdleExit: () => shutdownAndExit(),
    },
    // Version-picker switch wiring (issue #36, step 2): spawn the detached
    // helper from a data-dir copy of its bundle, then shut down through
    // the same path as SIGTERM.
    updateHooks: {
      spawnHelper: makeDefaultSpawnHelper(config.dataDir),
      requestShutdown: () => shutdownAndExit(),
    },
    // #311: after a reset moved the data aside, restart fresh in-process.
    onDataFormatReset: () => {
      restartWanted = true;
      shutdownAndExit();
    },
  });
  holder.ctx = created.ctx;

  // Bounded, ordered shutdown (PRD §14 idle exit; issues #30, #36
  // follow-up): abort jobs, dispose agent subprocesses (their MCP streams
  // drop), close MCP sessions + WebSocket clients explicitly, close HTTP
  // with remaining connections force-closed, close the DB last, flush
  // telemetry. Every step is bounded and the whole run has a hard
  // deadline — afterwards the process exits no matter what, so a stuck
  // shutdown can never leave a live process with a closed DB.
  let shutdownRun: Promise<ServiceShutdownReport> | null = null;
  shutdownAndExit = () => {
    if (!shutdownRun) {
      shutdownRun = shutdownService(
        buildShutdownSteps({ app: created.app, ctx: created.ctx }, db ?? created.ctx.db, sentry),
        {
          onTimeout: (step) => console.error(`shutdown: step ${step} timed out, continuing to exit`),
        },
      ).finally(() => {
        removeOwnLock(config.dataDir, me);
      });
    }
    void shutdownRun.then(() => {
      if (restartWanted) resolveGeneration(true);
      else process.exit(0);
    });
  };

  // Foreground lock: lets `unvibe stop`/`status` find us. Only our own PID
  // may remove it (a newer daemon must not lose its lock to our exit).
  try {
    writeLock(config.dataDir, { pid: me, port: config.port, startedAt: new Date().toISOString() });
  } catch {
    // non-fatal: the service still runs, `stop` just won't find it
  }
  const onSignal = (): void => shutdownAndExit();
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("exit", () => removeOwnLock(config.dataDir, me));

  const url = await listen(created.app, config).catch((err: unknown) => {
    // Bind conflict (or no loopback at all): plain-words message, no
    // stack. The foreground lock above names a process about to exit, so
    // remove it — otherwise the next start reads it as a stale lock,
    // which is harmless but noisy.
    console.error(err instanceof Error ? err.message : String(err));
    removeOwnLock(config.dataDir, me);
    process.exit(1);
  });
  console.log(`Unvibe listening on ${url}/?token=${token}`);
  // #311: an ephemeral port (`UNVIBE_PORT=0`) must stay the same across
  // a reset restart, or the browser's origin dies with the old generation.
  const boundPort = Number(new URL(url).port);
  if (Number.isSafeInteger(boundPort) && boundPort > 0) config.port = boundPort;
  // Stay until shutdown; a reset resolves true so `serve()` starts a
  // fresh generation, anything else exits the process in the hook above.
  const restarted = await generationDone;
  process.removeListener("SIGTERM", onSignal);
  process.removeListener("SIGINT", onSignal);
  return restarted;
}

/**
 * The production shutdown phases for a composed service (issue #30).
 * Exported so tests pin the real wiring (order + force-close behavior)
 * instead of a copy: abort jobs, dispose agent subprocesses, close MCP
 * sessions + WebSocket clients, force-close leftover sockets and close
 * HTTP, close the DB last, flush telemetry last. Every phase is
 * best-effort; `shutdownService` bounds each one.
 */
export function buildShutdownSteps(
  svc: { app: FastifyInstance; ctx: import("./app.js").AppContext },
  db: { close(): void },
  sentry: { close(): void | Promise<void> } | null,
): ServiceShutdownSteps {
  return {
    abortJobs: () => {
      svc.ctx.jobs.shutdown();
    },
    disposeAgents: async () => {
      const agents = svc.ctx.agents;
      if (isAcpRunner(agents)) {
        try {
          await agents.dispose();
        } catch {
          // best-effort: subprocesses die with the process
        }
      }
    },
    closeRealtime: async () => {
      try {
        await svc.ctx.mcp.closeAll();
      } catch {
        // best-effort: sockets are force-closed below regardless
      }
      terminateWebSockets(svc.app);
    },
    closeHttp: async () => {
      forceCloseConnections(svc.app);
      await svc.app.close();
    },
    closeDb: () => {
      db.close();
    },
    flushTelemetry: async () => {
      if (sentry) {
        try {
          await sentry.close();
        } catch {
          // best-effort: never block exit on a flush
        }
      }
    },
  };
}

/**
 * Terminate every live WebSocket (issue #30): `@fastify/websocket` only
 * sends graceful closes on `app.close()`, which a deaf peer never
 * answers while Fastify 5 waits for non-idle connections — so the
 * shutdown path terminates first and closes gracefully never.
 * Best-effort, never throws.
 */
function terminateWebSockets(app: FastifyInstance): void {
  try {
    const wss = (
      app as unknown as {
        websocketServer?: { clients?: Iterable<{ terminate(): void }> };
      }
    ).websocketServer;
    if (!wss?.clients) return;
    for (const client of wss.clients) {
      try {
        client.terminate();
      } catch {
        // Already gone: fine.
      }
    }
  } catch {
    // No WS server mounted: nothing to do.
  }
}

/**
 * Destroy leftover sockets before `app.close()` (issue #30): with the
 * default `forceCloseConnections: "idle"` Fastify waits for non-idle
 * connections (hijacked MCP SSE streams, half-open sockets) forever.
 * Best-effort, never throws; needs Node 18.2+, guarded for older.
 */
function forceCloseConnections(app: FastifyInstance): void {
  try {
    const server = app.server as unknown as { closeAllConnections?: () => void };
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  } catch {
    // Guarded: `app.close()` still runs and is itself bounded.
  }
}
