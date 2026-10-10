/**
 * Optional route dependencies (M3).
 *
 * Route modules stay 501 stubs when their backing service is absent, so
 * the scaffold tests and parallel agents' work keep passing unwired;
 * `src/index.ts` wires the real singletons at startup.
 */
import type { JobQueue } from "../jobs/index.js";
import type { McpRegistry } from "../mcp/index.js";
import type { SettingsStore, ModelCatalog } from "../settings/index.js";
import type { DatabaseSync } from "../store/db.js";

export interface RouteDeps {
  db?: DatabaseSync;
  jobs?: JobQueue;
  settings?: SettingsStore;
  models?: ModelCatalog;
  mcp?: McpRegistry;
}
