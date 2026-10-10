/**
 * Composition root: one place that constructs everything.
 *
 * Builds db, bus, stores, command runner, settings, job queue with
 * recovery, agent runner (ACP default, replay for demo/tests), session
 * manager, MCP registry with a real `ReviewReader` over `ReviewStore` +
 * worktree paths, pipeline, and the update-pass runner — then hands route
 * modules one unified context. `serve()` uses this and nothing else.
 *
 * Unification: `ServiceContext` (core stores) + `RouteDeps` (optional M3
 * singletons) + `ReviewsRouteDeps` (update wiring) are merged into
 * `AppContext`. Route modules take `(app, ctx)` where `ctx` is the full
 * context; tests construct it with fakes easily (see `createApp` overrides
 * in `server.ts`).
 *
 * Runner notes (see `docs/acp-runner.md`):
 * - Usage accounting: the ACP runner already normalises (Claude reports
 *   session-cumulative counters, Codex per-turn) into per-turn `usage`
 *   events, so the pipeline just sums them.
 * - Read-only posture: ACP sessions start `readOnly` by default (file
 *   reads + our MCP tools only; edits/shell/network denied). Codex uses
 *   `workspace-write` mode (not `read-only`, which refuses MCP calls, and
 *   not `agent`, which skips permission prompts) with a deny-by-default
 *   handler. The pipeline never opts out.
 * - Codex MCP-refusal flake ("I can't access that tool" without
 *   attempting) is treated as retryable in the pipeline (see
 *   `pipeline/runner.ts: isMcpRefusal`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { createAgentRunner, resolveFixturesDir } from "./agent/factory.js";
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

/**
 * Model catalog backed by the real runner's `listModels(provider)` with a
 * static fallback (so Settings renders pickers offline and in tests).
 * Replaces `StaticModelCatalog` whenever a real runner is present.
 */
export class AcpModelCatalog implements ModelCatalog {
  constructor(
    private readonly runner: AgentRunner,
    private readonly fallback: ModelCatalog = new StaticModelCatalog(),
  ) {}

  async listModels(provider: string): Promise<string[]> {
    const list = (this.runner as unknown as { listModels?: (p: string) => Promise<{ id: string }[]> }).listModels;
    if (typeof list !== "function") return this.fallback.listModels(provider);
    try {
      const models = await list.call(this.runner, provider);
      const ids = models.map((m) => m.id).filter(Boolean);
      if (ids.length > 0) return ids;
    } catch {
      // Adapter subprocess down / provider unknown: fall back to static.
    }
    return this.fallback.listModels(provider);
  }
}

/**
 * Locate `prompts/` relative to the module when possible (so the esbuild
 * bundle + global install find it outside the repo), falling back to
 * `resolvePromptsDir()` (env / cwd walk-up) for dev/tests.
 */
export function resolvePromptsDirForBundle(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist layout: packages/service/dist/app.js → root prompts/
  // src layout:  packages/service/src/app.ts → root prompts/
  const candidates = [
    path.resolve(here, "..", "..", "..", "prompts"),
    path.resolve(here, "..", "prompts"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, "instructions.md"))) return c;
    } catch {
      // try next
    }
  }
  return resolvePromptsDir() ?? path.resolve(process.cwd(), "prompts");
}

export function buildApp(opts: BuildAppOptions): AppContext {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));
  const runner = opts.runner ?? new RealCommandRunner();
  const bus = opts.bus ?? new EventBus();
  const repos = new RepoStore(opts.db);
  const reviews = new ReviewStore(opts.db, bus);
  const settings = opts.settings ?? new SettingsStore(opts.db);
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

  const promptsDir = opts.promptsDir ?? resolvePromptsDirForBundle();
  const fixturesDir = opts.fixturesDir ?? resolveFixturesDir();

  // Default runner: ACP (real claude/codex subprocesses). Replay only when
  // UNVIBE_AGENT=replay (demo/tests) or when tests inject `agents` directly.
  const agents = opts.agents ?? createAgentRunner({ fixturesDir, delayMs: 5 });
  const models = opts.models ?? new AcpModelCatalog(agents);

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
