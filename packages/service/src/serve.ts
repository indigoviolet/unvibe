/**
 * Foreground service entry (PRD §14).
 *
 * Started by the `unvibe` CLI (`start --foreground`, or with no command
 * for `mise run start`). Owns the singletons, shutdown hooks and the
 * idle-exit wiring; the CLI layer (`src/cli/`) handles daemonising.
 */
import type { ReviewEvent } from "@unvibe/shared";
import { loadOrCreateToken } from "./auth.js";
import { removeOwnLock, writeLock } from "./cli/lock.js";
import { loadConfig } from "./config.js";
import type { EventBus } from "./events.js";
import { applyLoginShellPath } from "./exec/index.js";
import { RealCommandRunner } from "./exec/runner.js";
import { JobQueue, JobStore } from "./jobs/index.js";
import { ShutdownHooks } from "./lifecycle/index.js";
import { McpRegistry, type McpReviewData } from "./mcp/index.js";
import { createApp, listen } from "./server.js";
import { SettingsStore, StaticModelCatalog } from "./settings/index.js";
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

  // M3 singletons. The bus is created inside createApp, so the queue's
  // event sink forwards through a holder assigned after startup.
  const settings = new SettingsStore(db);
  const jobStore = new JobStore(db);
  let bus: EventBus | null = null;
  const jobs = new JobQueue({
    persist: jobStore,
    getConcurrencyCap: () => settings.get().sessionsPerProvider,
    onEvent: (reviewId: string, event: ReviewEvent) => bus?.publish(reviewId, event),
  });
  // Startup recovery: interrupted jobs become retryable errors; queued
  // jobs wait for their `run` functions to be rebound.
  const recovered = jobStore.listOpen();
  if (recovered.length > 0) jobs.recover(recovered);

  const runner = new RealCommandRunner();
  // TODO(integration): wire a real ReviewReader + worktree paths.
  const mcp = new McpRegistry({
    reader: {
      getReview: async (): Promise<McpReviewData | null> => null,
      getWorktreePath: () => null,
    },
    commands: runner,
  });

  const shutdown = new ShutdownHooks();
  const created = await createApp(token, {
    db,
    dataDir: config.dataDir,
    runner,
    jobs,
    settings,
    models: new StaticModelCatalog(),
    mcp,
    lifecycle: {
      idleMs: config.idleMs,
      hasJobs: () => jobs.activeCount() > 0,
      onIdleExit: () => {
        void shutdown.run().then(() => process.exit(0));
      },
    },
  });
  bus = created.bus;

  // Clean shutdown (PRD §14 idle exit): agent subprocesses and jobs first,
  // then the HTTP server, then the DB. Later milestones register their own
  // agent-subprocess hooks on the exported ShutdownHooks list pattern.
  shutdown.onShutdown(() => jobs.shutdown());
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
