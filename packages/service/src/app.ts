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
 * - Usage accounting: both ACP adapters already report per-turn `usage`
 *   events (#209), so the pipeline just sums them.
 * - Read-only posture: ACP sessions start `readOnly` by default (file
 *   reads + our MCP tools only; edits/shell/network denied). Codex uses
 *   `workspace-write` mode (not `read-only`, which refuses MCP calls, and
 *   not `agent`, which skips permission prompts) with a deny-by-default
 *   handler. The pipeline opts out only under the full-access setting.
 * - Full access (issue #160, opt-in, off by default): sessions start
 *   `readOnly: false` with the full-access system prompt. Claude keeps
 *   the adapter's default (full) tool set with an allow-all permission
 *   handler; Codex uses `agent-full-access` mode (no permission
 *   round-trip). One adapter subprocess runs per (provider, posture):
 *   lock-down subprocesses spawn with exactly the base env, full-access
 *   ones with named secrets removed and provider auth kept
 *   (`adapterEnvFor`). The limits are prompt
 *   instructions only — see docs/acp-runner.md for enforced-vs-instructed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunner } from "@unvibe/shared";
import { accessModeOf } from "@unvibe/shared";
import type { DatabaseSync } from "./store/db.js";
import { EventBus } from "./events.js";
import type { CommandRunner } from "./exec/index.js";
import { RealCommandRunner, TestCommandGuard } from "./exec/runner.js";
import { ShimResolvingCommandRunner } from "./exec/shim-resolve.js";
import { INTERRUPTED_MESSAGE, JobQueue, JobStore } from "./jobs/index.js";
import { McpRegistry } from "./mcp/index.js";
import { StoreReviewReader } from "./mcp/reviewReader.js";
import { RepoStore } from "./repos/store.js";
import { ReviewStore } from "./state/store.js";
import { SettingsStore, StaticModelCatalog, type ModelCatalog, type OfferedModels, type OfferedThinking } from "./settings/index.js";
import { SessionManager } from "./sessions/manager.js";
import { SessionStore } from "./sessions/store.js";
import { SharedContextService, setInteractionHandler } from "./sharedctx/index.js";
import { SharedContextStore } from "./sharedctx/store.js";
import { createUpdaterFromEnv, type Updater } from "./update/index.js";
import { createAgentRunner, resolveFixturesDir } from "./agent/factory.js";
import { FakeAgentRunner } from "./agent/fake.js";
import { verifyCheckoutAfterJob } from "./fullaccess/verify.js";
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
  /** M5 shared context (PRD §9.3–§9.5): log, change lists, contributions. */
  sharedctx: SharedContextService;
  /** Version-picker backend (issue #36 step 2 seam; fake under `UNVIBE_UPDATER_BACKEND=fake`). */
  updater: Updater;
  promptsDir: string;
  fixturesDir: string;
  mcpBaseUrl: string;
  updateRunner: import("./versions/update.js").UpdateBaseRunner;
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
  updater?: Updater;
  /** SERVICE_VERSION (server.ts); feeds the real Updater + build identity. */
  serviceVersion?: string;
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

  async listModels(provider: string): Promise<import("@unvibe/shared").ModelInfo[]> {
    const list = (
      this.runner as unknown as {
        listModels?: (p: string) => Promise<{ id: string; name?: string; description?: string }[] | string[]>;
      }
    ).listModels;
    if (typeof list !== "function") return this.fallback.listModels(provider);
    try {
      const models = await list.call(this.runner, provider);
      const infos: import("@unvibe/shared").ModelInfo[] = (models as ({ id: string; name?: string; description?: string } | string)[])
        .map((m) => (typeof m === "string" ? { id: m } : { id: m.id, ...(m.name ? { name: m.name } : {}), ...(m.description ? { description: m.description } : {}) }))
        .filter((m) => Boolean(m.id));
      if (infos.length > 0) return infos;
    } catch {
      // Adapter subprocess down / provider unknown: fall back to static.
    }
    return this.fallback.listModels(provider);
  }

  /**
   * Live adapter offering with the adapter's default model, or null when
   * unknown (no live adapter, probe failed/timed out, or empty). Null
   * means settings keeps static defaults and skips offer validation.
   */
  async offered(provider: string): Promise<OfferedModels | null> {
    const live = (
      this.runner as unknown as {
        listModelsWithDefault?: (p: string) => Promise<{
          models: { id: string; name?: string; description?: string }[] | string[];
          defaultId: string | null;
        }>;
      }
    ).listModelsWithDefault;
    if (typeof live !== "function") return null;
    try {
      const res = await withTimeout(
        live.call(this.runner, provider),
        10_000,
        () => Promise.reject(new Error("offered() timed out")),
      );
      const models: import("@unvibe/shared").ModelInfo[] = (
        res.models as ({ id: string; name?: string; description?: string } | string)[]
      )
        .map((m) => (typeof m === "string" ? { id: m } : { id: (m as { id: string }).id, ...((m as { name?: string }).name ? { name: (m as { name?: string }).name } : {}), ...((m as { description?: string }).description ? { description: (m as { description?: string }).description } : {}) }))
        .filter((m) => Boolean(m.id));
      if (models.length === 0) return null;
      return { models, defaultId: res.defaultId };
    } catch {
      return null;
    }
  }

  /**
   * Live thinking-level offering (issue #172): the adapter's effort
   * selector options, or null when unknown (no live adapter, probe
   * failed/timed out). Null means settings skips effort validation.
   */
  async thinking(provider: string): Promise<OfferedThinking | null> {
    const live = (
      this.runner as unknown as {
        listThinking?: (p: string) => Promise<
          { configId: string; current: string; options: { value: string; name?: string; description?: string }[] }[]
        >;
      }
    ).listThinking;
    if (typeof live !== "function") return null;
    try {
      const selectors = await withTimeout(
        live.call(this.runner, provider),
        10_000,
        () => Promise.reject(new Error("thinking() timed out")),
      );
      const first = selectors[0];
      if (!first || first.options.length === 0) return null;
      return {
        label: first.configId === "reasoning_effort" ? "Reasoning effort" : "Effort",
        options: first.options
          .map((o) => ({
            value: o.value,
            ...(o.name ? { name: o.name } : {}),
            ...(o.description ? { description: o.description } : {}),
          }))
          .filter((o) => Boolean(o.value)),
        ...(first.current ? { current: first.current } : {}),
      };
    } catch {
      return null;
    }
  }

  /** Clear cached model listings (Reload everything). */
  clearCache(): void {
    try {
      const r = this.runner as unknown as { modelCache?: Map<unknown, unknown> };
      // AcpAgentRunner keeps its own 5-min cache; best-effort clear via
      // listModelsWithDefault bypass is handled by the runner itself.
      void r;
    } catch {
      // ignore
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const gate = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      void onTimeout().then(resolve, reject);
    }, ms);
    timer.unref?.();
  });
  return Promise.race([p, gate]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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

/**
 * True inside the vitest suite (vitest sets both; either one counts).
 * The composition root uses this to refuse the production fallbacks —
 * tests must never silently start real agents or real CLIs (issue #119).
 */
export function isTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === "true" || env.VITEST === "1" || env.NODE_ENV === "test";
}

export function buildApp(opts: BuildAppOptions): AppContext {
  const dataDir = opts.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-data-"));
  // Tests never hit real GitHub or real agents (issue #119): under vitest
  // an app built without explicit fakes gets inert substitutes instead of
  // silently falling back to the production ones. Explicitly injected
  // runners are never replaced. `UNVIBE_AGENT=replay|none` keeps the
  // factory (both are hermetic); only the unset default (real ACP) is
  // replaced with the fake.
  const underTest = isTestProcess();
  const needsTestAgents = underTest && (process.env.UNVIBE_AGENT ?? "") === "";
  // Issue #109: the production runner runs the service's own git/gh
  // through their resolved real executables, never a version-manager shim
  // that would read a review worktree's config. Injected runners (tests,
  // doctor diagnostics) are used exactly as given.
  const runner =
    opts.runner ??
    (underTest ? new TestCommandGuard(new RealCommandRunner()) : new ShimResolvingCommandRunner(new RealCommandRunner()));
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
      // Issue #160: stamp each job with the agent-access posture it was
      // enqueued under, and verify the review's checkout after each job
      // (reset + flag when full access let the agent change it).
      getAccessMode: () => {
        try {
          return accessModeOf(settings.get());
        } catch {
          return undefined;
        }
      },
      afterRun: (job) => verifyCheckoutAfterJob({ reviews, commands: runner, settings, dataDir }, job.reviewId ?? "", job),
    });
  if (!opts.jobs) {
    // Issue #117: hydrate every stored job, not just the open ones, so
    // finished jobs stay on the Debug page's jobs list after a restart.
    const saved = jobStore.listAll();
    if (saved.length > 0) {
      const { interrupted } = jobs.recover(saved);
      // Issue #203: an interrupted conversation job is a failed turn.
      // Its job is terminal, so settle the turn it was filling —
      // working cleared, error set — or the card would show "Writing…"
      // forever with no Retry. Fire-and-forget like the ingest resume;
      // the mutation lands before any reader can act on the card.
      for (const job of interrupted) {
        if (!job.reviewId || !job.annotationId) continue;
        const reviewId = job.reviewId;
        const annotationId = job.annotationId;
        void reviews
          .mutate(reviewId, (draft) => {
            const ann = (draft.annotations as unknown as import("@unvibe/shared").Annotation[]).find(
              (a) => a.id === annotationId,
            );
            if (!ann) return;
            const annMatches = ann.jobId === job.id || (ann.working ?? null) !== null;
            if (annMatches) {
              ann.working = null;
              ann.error = INTERRUPTED_MESSAGE;
              ann.jobId = undefined;
            }
            for (const turn of ann.turns ?? []) {
              if (turn.jobId === job.id || (annMatches && (turn.working ?? null) !== null)) {
                turn.working = null;
                turn.error = INTERRUPTED_MESSAGE;
                turn.jobId = undefined;
              }
            }
          })
          .catch(() => {});
      }
    }
  }

  const promptsDir = opts.promptsDir ?? resolvePromptsDirForBundle();
  const fixturesDir = opts.fixturesDir ?? resolveFixturesDir();
  const updater =
    opts.updater ??
    createUpdaterFromEnv(dataDir, {
      runner,
      serviceScriptPath: process.argv[1],
      ...(opts.serviceVersion ? { serviceVersion: opts.serviceVersion } : {}),
    });

  // Default runner: ACP (real claude/codex subprocesses). Replay only when
  // UNVIBE_AGENT=replay (demo/tests) or when tests inject `agents` directly;
  // UNVIBE_AGENT=none disables the pipeline (comments/diff/versions tests).
  // Under vitest with no explicit runner and the default (real) factory
  // selection, substitute the fake instead of starting real agents (#119).
  const agents =
    opts.agents ?? (needsTestAgents ? new FakeAgentRunner() : createAgentRunner({ fixturesDir }));
  const models =
    opts.models ?? (needsTestAgents && opts.agents === undefined ? new StaticModelCatalog() : new AcpModelCatalog(agents));

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
    models,
    commands: runner,
    dataDir,
    promptsDir,
    mcpBaseUrl,
    fixturesDir,
  });

  // M5 shared context (PRD §9.3–§9.5): log taxonomy, change lists,
  // contributions, base growth/rebuild, per-base observability. The pipeline
  // calls into it (change-list injection, post-turn ingest); rebuild
  // consolidation calls back into the pipeline's small-model task.
  const sharedctxStore = new SharedContextStore(opts.db);
  const sharedctx = new SharedContextService({
    reviews,
    sessions,
    settings,
    models,
    store: sharedctxStore,
    runConsolidate: (reviewId, text) => pipeline.runConsolidateTask(reviewId, text),
  });
  pipeline.setSharedContext(sharedctx);
  setInteractionHandler((event) => sharedctx.handleInteraction(event));

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
    sharedctx,
    updater,
    promptsDir,
    fixturesDir,
    mcpBaseUrl,
    updateRunner: pipeline.updateRunner(),
  };
}
