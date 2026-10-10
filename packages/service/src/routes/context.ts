/**
 * Shared service context for route modules (M1 service wiring).
 *
 * `createApp` builds this once; route modules owned by other milestones
 * ignore it until they need the store/bus/runner. Each route module keeps
 * one function per area (PRD §14.1).
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
