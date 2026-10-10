import type { FastifyInstance } from "fastify";
import { registerMcp } from "../mcp/index.js";
import type { ServiceContext } from "./context.js";
import { registerComments } from "./comments.js";
import { registerDescription } from "./description.js";
import type { RouteDeps } from "./deps.js";
import { registerEvents } from "./events.js";
import { registerHunks } from "./hunks.js";
import { registerJobs } from "./jobs.js";
import { registerPrompts } from "./prompts.js";
import { registerRepos } from "./repos.js";
import { registerReviews, type ReviewsRouteDeps } from "./reviews.js";
import { registerSettings } from "./settings.js";
import { registerSubmit } from "./submit.js";

/**
 * One route module per area; each registers its PRD §14.1 endpoints.
 * `ctx` carries the core stores; `deps` the optional M3 singletons plus
 * the M5 update-pass wiring (`ReviewsRouteDeps`: job queue + base runner).
 */
export async function registerRoutes(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps & ReviewsRouteDeps = {},
): Promise<void> {
  await registerRepos(app, ctx);
  await registerReviews(app, ctx, deps);
  await registerHunks(app, ctx);
  await registerComments(app);
  await registerDescription(app);
  await registerSubmit(app);
  await registerSettings(app, deps);
  await registerPrompts(app);
  await registerJobs(app, deps);
  await registerEvents(app, ctx.bus);
  if (deps.mcp) await registerMcp(app, deps.mcp);
}

export type { RouteDeps } from "./deps.js";
