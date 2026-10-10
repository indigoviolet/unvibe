/**
 * Shared service context for route modules (M1 service wiring, M3 unified).
 *
 * `createApp` builds one `AppContext` (see `src/app.ts`) holding every
 * singleton; this `ServiceContext` is its core subset (db, bus, stores,
 * command runner). Route modules take the full context but only declare
 * this subset when they need nothing else. Each route module keeps one
 * function per area (PRD §14.1).
 *
 * Unification (M3): `ServiceContext` + `RouteDeps` + `ReviewsRouteDeps`
 * are all views over the same `AppContext`. Tests construct the app with
 * fakes via `createApp` overrides.
 */
import type { DatabaseSync } from "../store/index.js";
import type { EventBus } from "../events.js";
import type { CommandRunner } from "../exec/index.js";
import type { RepoStore } from "../repos/store.js";
import type { ReviewStore } from "../state/store.js";

export interface ServiceContext {
  db: DatabaseSync;
  dataDir: string;
  runner: CommandRunner;
  bus: EventBus;
  repos: RepoStore;
  reviews: ReviewStore;
}
