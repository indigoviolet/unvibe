/**
 * Composition root (M3): one place that constructs everything.
 *
 * Builds db, bus, stores, command runner, settings, job queue with
 * recovery, agent runner (replay or ACP seam), session manager, MCP
 * registry with a real `ReviewReader` over `ReviewStore` + worktree paths,
 * pipeline, and the update-pass runner — then hands route modules one
 * unified context.
 *
 * Unification: `ServiceContext` (core stores) + `RouteDeps` (optional M3
 * singletons) + `ReviewsRouteDeps` (update wiring) are merged into
 * `AppContext`. Route modules take `(app, ctx)` where `ctx` is the full
 * context; tests construct it with fakes easily (see `createApp` overrides
 * in `server.ts`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentRunner } from "@unvibe/shared";
import type { DatabaseSync } from "./store/db.js";
import { EventBus } from "./events.js";
import type { CommandRunner } from "./exec/index.js";
import { RealCommandRunner } from "./exec/runner.js";
import { JobQueue, JobStore } from "./jobs/index.js";
import { McpRegistry } from "./mcp/index.js";
import { StoreReviewReader } from "./mcp/reviewReader.js";
import { RepoStore } from "./repos/store.js";
import { ReviewStore } from "./state/store.js";
import { SettingsStore, StaticModelCatalog, type ModelCatalog } from "./settings/index.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import { createAgentRunner, isReplayRunner } from "./agent/factory.js";
import { Pipeline } from "./pipeline/index.js";
import { resolvePromptsDir } from "./prompts/index.js";

export interface AppContext {
  db: DatabaseSync;
  dataDir: string;
  runner: CommandRunner;
  bus: EventBus;
  repos: RepoStore;
  reviews: ReviewStore;
  jobs: JobQueue;
  settings: SettingsStore;
  models: ModelCatalog;
  mcp: McpRegistry;
  sessions: SessionManager;
  agents: AgentRunner;
  pipeline: Pipeline;
  promptsDir: string;
  fixturesDir: string;
  mcpBaseUrl: string;
  updateRunner: { runUpdatePrompt: (prompt: string, opts: { reviewId: string; toVersion: number; signal?: AbortSignal }) => Promise<string> };
}

export interface BuildAppOptions {
  db: DatabaseSync;
  dataDir?: string;
  runner?: CommandRunner;
  bus?: EventBus;
  agents?: AgentRunner;
  promptsDir?: string;
  fixturesDir?: string;
  mcpBaseUrl?: string;
  models?: ModelCatalog;
  jobs?: JobQueue;
  settings?: SettingsStore;
  mcp?: McpRegistry;
}

export function buildApp(opts: BuildAppOptions): AppContext {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));
  const runner = opts.runner ?? new RealCommandRunner();
  const bus = opts.bus ?? new EventBus();
  const repos = new RepoStore(opts.db);
  const reviews = new ReviewStore(opts.db, bus);
  const settings = opts.settings ?? new SettingsStore(opts.db);
  const models = opts.models ?? new StaticModelCatalog();
  const jobStore = new JobStore(opts.db);
  const jobs =
    opts.jobs ??
    new JobQueue({
      persist: jobStore,
      getConcurrencyCap: () => {
        try {
          return settings.get().sessionsPerProvider;
        } catch {
          return 4;
        }
      },
      onEvent: (reviewId, event) => bus.publish(reviewId, event),
    });
  if (!opts.jobs) {
    const recovered = jobStore.listOpen();
    if (recovered.length > 0) jobs.recover(recovered);
  }

  const promptsDir = opts.promptsDir ?? resolvePromptsDir() ?? path.resolve(process.cwd(), "prompts");
  const fixturesDir =
    opts.fixturesDir ??
    (() => {
      const fromCwd = path.resolve(process.cwd(), "fixtures", "urllib3-5020");
      if (fs.existsSync(fromCwd)) return fromCwd;
      return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "fixtures", "urllib3-5020");
    })();

  const agents =
    opts.agents ??
    (() => {
      try {
        return createAgentRunner({ fixturesDir, delayMs: 5 });
      } catch {
        // ACP not merged yet: fall back to replay when fixtures exist so
        // `mise run start` works out of the box; otherwise rethrow the
        // helpful ACP error.
        if (fs.existsSync(path.join(fixturesDir, "manifest.json"))) {
          process.env.UNVIBE_AGENT = "replay";
          return createAgentRunner({ fixturesDir, delayMs: 5 });
        }
        throw new Error(
          "ACP AgentRunner not yet merged. Run with UNVIBE_AGENT=replay for the recorded demo.",
        );
      }
    })();

  const reader = new StoreReviewReader({ reviews, dataDir });
  const mcp =
    opts.mcp ??
    new McpRegistry({
      reader,
      commands: runner,
      onPin: () => {
        // Pins are read by the pipeline via listPins(reviewId) after the
        // reader finishes; no extra persistence needed here.
      },
    });

  const sessionStore = new SessionStore(opts.db);
  const sessions = new SessionManager({ runner: agents, store: sessionStore });
  sessions.restore();

  const mcpBaseUrl = opts.mcpBaseUrl ?? "http://127.0.0.1:4517";
  const pipeline = new Pipeline({
    reviews,
    jobs,
    sessions,
    runner: agents,
    mcp,
    settings,
    commands: runner,
    dataDir,
    promptsDir,
    mcpBaseUrl,
    fixturesDir,
  });

  void isReplayRunner;
  return {
    db: opts.db,
    dataDir,
    runner,
    bus,
    repos,
    reviews,
    jobs,
    settings,
    models,
    mcp,
    sessions,
    agents,
    pipeline,
    promptsDir,
    fixturesDir,
    mcpBaseUrl,
    updateRunner: pipeline.updateRunner(),
  };
}
