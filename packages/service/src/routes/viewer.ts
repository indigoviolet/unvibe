/**
 * Viewer (M6, PRD §4.11–§4.12).
 *
 * - `GET /api/viewer` — the GitHub login behind `gh` (`gh api user`),
 *   cached process-wide for a few minutes. The Submit panel says
 *   "Submit as <user>" and the description tab applies the "PR author +
 *   open PR" rule with it. `{ login: null }` when `gh` is not logged in
 *   (display-only endpoint: never 501s/502s for that, callers fall back).
 */
import type { FastifyInstance } from "fastify";
import type { ViewerResponse } from "@unvibe/shared";
import { runGh } from "../exec/index.js";
import type { ServiceContext } from "./context.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { login: string | null; at: number } | null = null;

/** Test-only: clear the process-wide viewer cache. */
export function clearViewerCache(): void {
  cached = null;
}

async function fetchViewer(ctx: ServiceContext): Promise<string | null> {
  const res = await runGh(ctx.runner, ["api", "user"], { args: ["api", "user"], cwd: ctx.dataDir });
  if (res.code !== 0) return null;
  try {
    const login = (JSON.parse(res.stdout) as { login?: string }).login;
    return login || null;
  } catch {
    return null;
  }
}

/** GET /api/viewer — cached `gh api user` login. */
export async function registerViewer(app: FastifyInstance, ctx?: ServiceContext): Promise<void> {
  if (!ctx) {
    app.get("/api/viewer", async (_req, reply) => reply.code(501).send({ error: "not implemented" }));
    return;
  }
  app.get("/api/viewer", async () => {
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) {
      const login: string | null = cached.login;
      const out: ViewerResponse = { login };
      return out;
    }
    const login = await fetchViewer(ctx);
    cached = { login, at: now };
    const out: ViewerResponse = { login };
    return out;
  });
}
