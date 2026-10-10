import type { FastifyInstance } from "fastify";
import { registerMcp } from "../mcp/index.js";
import type { ServiceContext } from "./context.js";
import { registerComments } from "./comments.js";
import { registerContributions } from "./contributions.js";
import { registerDescription } from "./description.js";
import type { RouteDeps } from "./deps.js";
import { registerEvents } from "./events.js";
import { registerHunks } from "./hunks.js";
import { registerJobs } from "./jobs.js";
import { registerPrompts, toPromptSnapshot } from "./prompts.js";
import { registerRepos } from "./repos.js";
import { registerReviews, type ReviewsRouteDeps } from "./reviews.js";
import { registerSettings } from "./settings.js";
import { registerSubmit } from "./submit.js";

/**
 * One route module per area; each registers its PRD §14.1 endpoints.
 * M3 unification: `ctx` is the full `AppContext` (core stores + M3
 * singletons); `deps` carries the same plus per-test overrides (jobs,
 * baseRunner, ...). Route modules read pipeline/jobs/settings from the
 * merged view.
 */
export async function registerRoutes(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps & ReviewsRouteDeps = {},
): Promise<void> {
  const full = { ...ctx, ...deps } as ServiceContext & RouteDeps & ReviewsRouteDeps & {
    pipeline?: import("../pipeline/index.js").Pipeline;
    dataDir?: string;
    fixturesDir?: string;
  };
  await registerRepos(app, ctx);
  await registerReviews(app, ctx, deps);
  await registerHunks(app, full as unknown as ServiceContext, full as unknown as RouteDeps);
  await registerComments(app, ctx);
  await registerContributions(app, ctx);
  await registerDescription(app, ctx);
  await registerSubmit(app, ctx);
  await registerSettings(app, deps);
  await registerPrompts(app, {
    snapshots: {
      getSnapshot: async (reviewId: string) => {
        const snap = ctx.reviews.getSnapshot(reviewId);
        return snap ? toPromptSnapshot(snap) : null;
      },
    },
  });
  await registerJobs(app, deps);
  await registerEvents(app, ctx.bus);
  if (deps.mcp) await registerMcp(app, deps.mcp);
}

export type { RouteDeps } from "./deps.js";
export type { ReviewsRouteDeps, RegisterReviewsDeps } from "./reviews.js";
