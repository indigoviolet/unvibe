/**
 * Foreground service entry (PRD §14).
 *
 * Started by the `unvibe` CLI (`start --foreground`, or with no command
 * for `mise run start`). `buildApp` is the single composition root (M3);
 * this module owns the shutdown hooks and idle-exit wiring; the CLI layer
 * (`src/cli/`) handles daemonising.
 */
import { loadOrCreateToken } from "./auth.js";
import { removeOwnLock, writeLock } from "./cli/lock.js";
import { loadConfig } from "./config.js";
import { applyLoginShellPath } from "./exec/index.js";
import { ShutdownHooks } from "./lifecycle/index.js";
import { createApp, listen } from "./server.js";
import { makeDefaultSpawnHelper } from "./routes/update.js";
import { isSwitchPending } from "./update/index.js";
import { isAcpRunner } from "./agent/factory.js";
import { dbFilePath } from "./store/index.js";
import { migrate, openDatabase } from "./store/index.js";
import { initSentry, type ErrorReporter } from "./telemetry/sentry.js";

export interface ServeShutdownDeps {
  sentry: ErrorReporter | null;
  disposeAgents: () => void | Promise<void>;
  shutdownJobs: () => void;
  closeApp: () => void | Promise<void>;
  closeDb: () => void;
}

/**
 * Register the clean-shutdown hooks (PRD §14 idle exit). Hooks run
 * latest-registered first, so this registers in reverse of the effective
 * teardown order: agent subprocesses and jobs first, then the HTTP server,
 * then the DB, with the Sentry flush last so errors from teardown itself
 * still get reported.
 */
export function registerShutdownHooks(shutdown: ShutdownHooks, deps: ServeShutdownDeps): void {
  const { sentry } = deps;
  if (sentry) shutdown.onShutdown(() => sentry.close());
  shutdown.onShutdown(() => deps.closeDb());
  shutdown.onShutdown(() => deps.closeApp());
  shutdown.onShutdown(() => deps.shutdownJobs());
  shutdown.onShutdown(() => deps.disposeAgents());
}

export async function serve(): Promise<void> {
  // Dev-only error reporting (issue #29): on only with SENTRY_DSN_SERVICE.
  const sentry = await initSentry();
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);

  // macOS gotcha (PRD §14): pick up the login-shell PATH so gh/git/agents resolve.
  try {
    await applyLoginShellPath();
  } catch {
    // non-fatal: keep the inherited PATH
  }

  const db = openDatabase(dbFilePath(config.dataDir));
  migrate(db);

  const shutdown = new ShutdownHooks();
  // buildApp (via createApp) is the single composition root: agent runner
  // defaults to ACP (real subprocesses), replay only with UNVIBE_AGENT.
  // The lifecycle closure reads through this holder (assigned after
  // createApp) so idle exit sees the real job queue (M3 activeCount).
  const holder: { ctx?: import("./app.js").AppContext } = {};
  // PID for the foreground lock + the switch helper's exit wait. Defined
  // before createApp so the switch shutdown path can close over it.
  const me = process.pid;
  const created = await createApp(token, {
    db,
    dataDir: config.dataDir,
    mcpBaseUrl: `http://127.0.0.1:${config.port}`,
    lifecycle: {
      idleMs: config.idleMs,
      // A committed switch suppresses idle exit: the helper is about to
      // (or already did) shut us down itself, and must never race exit.
      hasJobs: () =>
        (holder.ctx ? holder.ctx.jobs.activeCount() > 0 : false) || isSwitchPending(config.dataDir),
      onIdleExit: () => {
        void shutdown.run().then(() => process.exit(0));
      },
    },
    // Version-picker switch wiring (issue #36, step 2): spawn the detached
    // helper from a data-dir copy of its bundle, then shut down through
    // the same path as SIGTERM.
    updateHooks: {
      spawnHelper: makeDefaultSpawnHelper(config.dataDir),
      requestShutdown: () => {
        void shutdown.run().then(() => {
          removeOwnLock(config.dataDir, me);
          process.exit(0);
        });
      },
    },
  });
  holder.ctx = created.ctx;

  // Clean shutdown (PRD §14 idle exit): effective order is agent
  // subprocesses and jobs first, then the HTTP server, then the DB last
  // (jobs writing during shutdown must still find an open database), with
  // the Sentry flush after everything that might report errors. Hooks run
  // latest-registered first, so registerShutdownHooks registers them in
  // reverse (Sentry first, so it still runs last).
  registerShutdownHooks(shutdown, {
    sentry,
    disposeAgents: async () => {
      const agents = created.ctx.agents;
      if (isAcpRunner(agents)) {
        try {
          await agents.dispose();
        } catch {
          // best-effort: subprocesses die with the process
        }
      }
    },
    shutdownJobs: () => created.ctx.jobs.shutdown(),
    closeApp: () => created.app.close(),
    closeDb: () => db.close(),
  });

  // Foreground lock: lets `unvibe stop`/`status` find us. Only our own PID
  // may remove it (a newer daemon must not lose its lock to our exit).
  try {
    writeLock(config.dataDir, { pid: me, port: config.port, startedAt: new Date().toISOString() });
  } catch {
    // non-fatal: the service still runs, `stop` just won't find it
  }
  const onSignal = (): void => {
    void shutdown.run().then(() => {
      removeOwnLock(config.dataDir, me);
      process.exit(0);
    });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  process.on("exit", () => removeOwnLock(config.dataDir, me));

  const url = await listen(created.app, config);
  console.log(`Unvibe listening on ${url}/?token=${token}`);
}
