/**
 * Readiness endpoint (front-screen callouts + Settings → Environment).
 *
 * - `GET /api/readiness` — cached report (30s TTL).
 * - `GET /api/readiness?force=1` — bypass the cache and re-probe now.
 */
import type { FastifyInstance } from "fastify";
import { NoAgentRunner } from "../agent/none.js";
import { getReadiness } from "../readiness/index.js";
import type { ServiceContext } from "./context.js";
import type { RouteDeps } from "./deps.js";

export async function registerReadiness(
  app: FastifyInstance,
  ctx: ServiceContext,
  deps: RouteDeps = {},
): Promise<void> {
  app.get("/api/readiness", async (req) => {
    const q = req.query as { force?: string };
    const force = q.force === "1" || q.force === "true";
    const full = { ...ctx, ...deps } as ServiceContext &
      RouteDeps & { agents?: import("@unvibe/shared").AgentRunner };
    // Unwired (scaffold) contexts fall back to defaults so the shape stays
    // stable; agent checks then report the CLI state.
    const { DEFAULT_SETTINGS } = await import("../settings/store.js");
    const settingsStore =
      full.settings ?? ({ get: () => DEFAULT_SETTINGS } as unknown as RouteDeps["settings"]);
    // Never call the factory here (#188): a scaffold context without a
    // composed runner must not spawn a real CLI. buildApp always supplies
    // agents in production; the no-agent runner keeps the shape stable.
    const agents = full.agents ?? new NoAgentRunner();
    return getReadiness(
      {
        runner: full.runner,
        agents,
        settings: settingsStore as unknown as { get(): import("@unvibe/shared").Settings; savedKeys(): string[] },
        models: full.models ?? null,
        ...(full.readiness?.loginPathValue !== undefined
          ? { loginPathValue: full.readiness.loginPathValue }
          : {}),
      },
      { force },
    );
  });
}
