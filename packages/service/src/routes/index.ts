import type { FastifyInstance } from "fastify";
import type { EventBus } from "../events.js";
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

/** One route module per area; each registers its PRD §14.1 endpoints. */
export async function registerRoutes(app: FastifyInstance, bus: EventBus): Promise<void> {
  await registerRepos(app);
  await registerReviews(app);
  await registerHunks(app);
  await registerComments(app);
  await registerDescription(app);
  await registerSubmit(app);
  await registerSettings(app);
  await registerPrompts(app);
  await registerJobs(app);
  await registerEvents(app, bus);
}
