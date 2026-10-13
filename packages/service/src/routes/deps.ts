/**
 * Optional route dependencies (M3, unified with `ServiceContext`).
 *
 * The composition root (`src/app.ts`) builds one `AppContext` holding every
 * singleton; route modules take that context (or this subset). Modules stay
 * 501 stubs when their backing service is absent, so unwired tests keep
 * passing; `createApp` wires the real singletons at startup.
 *
 * Unification: `ServiceContext` (core stores) + `RouteDeps` (M3 singletons)
 * + `ReviewsRouteDeps` (update wiring) are all subsets of `AppContext`.
 * New code should take `AppContext`; these interfaces remain for the
 * per-area route signatures.
 */
import type { AgentRunner } from "@unvibe/shared";
import type { JobQueue } from "../jobs/index.js";
import type { McpRegistry } from "../mcp/index.js";
import type { Pipeline } from "../pipeline/index.js";
import type { SessionManager } from "../sessions/manager.js";
import type { SettingsStore, ModelCatalog } from "../settings/index.js";
import type { SharedContextService } from "../sharedctx/service.js";
import type { DatabaseSync } from "../store/db.js";
import type { Updater } from "../update/updater.js";
import type { ProbedPaths } from "../diagnostics/path-probe.js";

/**
 * Switch wiring for the version picker (issue #36, step 2). Absent in
 * tests that do not touch the switch path — `POST /api/update/switch`
 * answers 501 without it. `serve()` provides both.
 */
export interface UpdateHooks {
  /** Spawn the detached helper for a prepared args file. Resolves the helper pid. */
  spawnHelper(argsFile: string): Promise<number>;
  /** Shut the service down cleanly through the normal shutdown path. */
  requestShutdown(): void;
}

export interface RouteDeps {
  db?: DatabaseSync;
  jobs?: JobQueue;
  settings?: SettingsStore;
  models?: ModelCatalog;
  mcp?: McpRegistry;
  /** M3 pipeline (reader/base/critic/hunks/actions/resume). */
  pipeline?: Pipeline;
  /** Agent runner (replay/fake/ACP seam). */
  agents?: AgentRunner;
  /** Session manager (base/fork). */
  sessions?: SessionManager;
  /** M5 shared context (log, contributions, base stats). */
  sharedctx?: SharedContextService;
  promptsDir?: string;
  fixturesDir?: string;
  /** Version-picker backend (issue #36; fake under `UNVIBE_UPDATER_BACKEND=fake`). */
  updater?: Updater;
  /** Switch spawn + shutdown wiring (provided by `serve()`). */
  updateHooks?: UpdateHooks;
  /** SERVICE_VERSION, set by `server.ts` for build identity in update routes. */
  serviceVersion?: string;
  /**
   * Native folder picker overrides (#26): platform + env for the
   * `POST /api/repos/pick-folder` dialog. Production omits both (real
   * platform, real display); tests inject them to cover the macOS and
   * Linux branches on Linux CI.
   */
  pickFolder?: import("../repos/pick-folder.js").PickFolderOptions;
  /**
   * Diagnostics probe overrides (tests only): a pre-resolved PATH
   * picture so `GET /api/diagnostics` and `POST /api/reload` skip
   * spawning login shells. The tool `--version` probes already run
   * through the app's injectable command runner (`ctx.runner`), so
   * tests inject a fake there. Production omits this (real shell
   * probe, real runner).
   */
  diagnostics?: {
    /** Skips the login-shell probe when present (even null: no shell). */
    pathProbe?: ProbedPaths | null;
  };
  /**
   * Readiness probe overrides (tests only): a pre-resolved login-shell
   * PATH picture so `GET /api/readiness` skips spawning login shells.
   * Production omits this (real shell probe).
   */
  readiness?: {
    /** Skips the login-shell probe when present. */
    loginPathValue?: string;
  };
}
