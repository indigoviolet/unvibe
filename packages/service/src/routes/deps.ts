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
import type { DatabaseSync } from "../store/db.js";

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
  promptsDir?: string;
  fixturesDir?: string;
}
