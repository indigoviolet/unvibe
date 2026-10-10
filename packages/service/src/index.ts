#!/usr/bin/env node
/** `unvibe` entry: resolve config, ensure data dir + token, serve. */
import type { ReviewEvent } from "@unvibe/shared";
import { loadOrCreateToken } from "./auth.js";
import { loadConfig } from "./config.js";
import type { EventBus } from "./events.js";
import { resolvePathFromLoginShell } from "./exec/index.js";
import { RealCommandRunner } from "./exec/runner.js";
import { JobQueue, JobStore } from "./jobs/index.js";
import { McpRegistry, type McpReviewData } from "./mcp/index.js";
import { createApp, listen } from "./server.js";
import { SettingsStore, StaticModelCatalog } from "./settings/index.js";
import { dbFilePath } from "./store/index.js";
import { migrate, openDatabase } from "./store/index.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const token = loadOrCreateToken(config.dataDir);

  // macOS gotcha (PRD §14): pick up the login-shell PATH so gh/git/agents resolve.
  try {
    const loginPath = await resolvePathFromLoginShell();
    if (loginPath) process.env.PATH = loginPath;
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
  // jobs wait for the supervisor to rebind their `run` functions.
  const recovered = jobStore.listOpen();
  if (recovered.length > 0) jobs.recover(recovered);

  // The supervisor wires a real ReviewReader + worktree paths after
  // merge; until then MCP tools report "unknown review".
  const mcp = new McpRegistry({
    reader: {
      getReview: async (): Promise<McpReviewData | null> => null,
      getWorktreePath: () => null,
    },
    commands: new RealCommandRunner(),
  });

  // NOTE: no SessionManager singleton yet: it needs the real ACP
  // AgentRunner (a later milestone after the M0 spike). The supervisor
  // constructs it as `new SessionManager({ runner, store })` — see
  // `src/sessions/manager.ts`.

  const created = await createApp(token, {
    db,
    jobs,
    settings,
    models: new StaticModelCatalog(),
    mcp,
  });
  bus = created.bus;

  const url = await listen(created.app, config);
  console.log(`Unvibe listening on ${url}/?token=${token}`);
}

await main();
