import type { FastifyInstance } from "fastify";
import type { EventBus } from "../events.js";
import { registerMcp } from "../mcp/index.js";
import { registerComments } from "./comments.js";
import { registerDescription } from "./description.js";
import type { RouteDeps } from "./deps.js";
import { registerEvents } from "./events.js";
import { registerHunks } from "./hunks.js";
import { registerJobs } from "./jobs.js";
import { registerPrompts } from "./prompts.js";
import { registerRepos } from "./repos.js";
import { registerReviews } from "./reviews.js";
import { registerSettings } from "./settings.js";
import { registerSubmit } from "./submit.js";

/** One route module per area; each registers its PRD §14.1 endpoints. */
export async function registerRoutes(
  app: FastifyInstance,
  bus: EventBus,
  deps: RouteDeps = {},
): Promise<void> {
  await registerRepos(app);
  await registerReviews(app);
  await registerHunks(app);
  await registerComments(app);
  await registerDescription(app);
  await registerSubmit(app);
  await registerSettings(app, deps);
  await registerPrompts(app);
  await registerJobs(app, deps);
  await registerEvents(app, bus);
  if (deps.mcp) await registerMcp(app, deps.mcp);
}

export type { RouteDeps } from "./deps.js";
