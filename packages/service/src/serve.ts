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
import { isAcpRunner } from "./agent/factory.js";
import { dbFilePath } from "./store/index.js";
import { migrate, openDatabase } from "./store/index.js";

export async function serve(): Promise<void> {
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
  const created = await createApp(token, {
    db,
    dataDir: config.dataDir,
    mcpBaseUrl: `http://127.0.0.1:${config.port}`,
    lifecycle: {
      idleMs: config.idleMs,
      hasJobs: () => (holder.ctx ? holder.ctx.jobs.activeCount() > 0 : false),
      onIdleExit: () => {
        void shutdown.run().then(() => process.exit(0));
      },
    },
  });
  holder.ctx = created.ctx;

  // Clean shutdown (PRD §14 idle exit): agent subprocesses and jobs first,
  // then the HTTP server, then the DB.
  shutdown.onShutdown(async () => {
    const agents = created.ctx.agents;
    if (isAcpRunner(agents)) {
      try {
        await agents.dispose();
      } catch {
        // best-effort: subprocesses die with the process
      }
    }
  });
  shutdown.onShutdown(() => created.ctx.jobs.shutdown());
  shutdown.onShutdown(() => created.app.close());
  shutdown.onShutdown(() => db.close());

  // Foreground lock: lets `unvibe stop`/`status` find us. Only our own PID
  // may remove it (a newer daemon must not lose its lock to our exit).
  const me = process.pid;
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
