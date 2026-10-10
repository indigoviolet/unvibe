import type { FastifyInstance } from "fastify";
import type { ServiceContext } from "./context.js";
import { registerComments } from "./comments.js";
import { registerDescription } from "./description.js";
import { registerEvents } from "./events.js";
import { registerHunks } from "./hunks.js";
import { registerJobs } from "./jobs.js";
import { registerPrompts } from "./prompts.js";
import { registerRepos } from "./repos.js";
import { registerReviews } from "./reviews.js";
import { registerSettings } from "./settings.js";
import { registerSubmit } from "./submit.js";

/**
 * One route module per area; each registers its PRD §14.1 endpoints.
 * M1 service modules (repos, reviews, hunks) take the service context;
 * later milestones take it up the same way.
 */
export async function registerRoutes(app: FastifyInstance, ctx: ServiceContext): Promise<void> {
  await registerRepos(app, ctx);
  await registerReviews(app, ctx);
  await registerHunks(app, ctx);
  await registerComments(app);
  await registerDescription(app);
  await registerSubmit(app);
  await registerSettings(app);
  await registerPrompts(app);
  await registerJobs(app);
  await registerEvents(app, ctx.bus);
}
