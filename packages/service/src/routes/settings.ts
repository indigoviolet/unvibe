/**
 * Settings routes (PRD §14.1, §4.14).
 *
 * - `GET /api/settings` — full settings (defaults merged over stored).
 * - `PUT /api/settings` — partial update; 400 with `{ errors }` when
 *   invalid, otherwise the full updated settings.
 * - `GET /api/models?provider=:id` — models the provider offers (static
 *   default until the ACP adapter implements `listModels`, PRD §4.14).
 *
 * Without wired stores the endpoints stay 501 stubs (scaffold behaviour).
 */
import type { FastifyInstance } from "fastify";
import type { Settings } from "@unvibe/shared";
import type { RouteDeps } from "./deps.js";

export async function registerSettings(app: FastifyInstance, deps: RouteDeps = {}): Promise<void> {
  const TODO = { error: "not implemented" };

  app.get("/api/settings", async (_req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    return deps.settings.get();
  });

  app.put("/api/settings", async (req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    const patch = ((req.body ?? {}) as Partial<Settings>) ?? {};
    const res = deps.settings.update(patch);
    if (res.errors) return reply.code(400).send({ errors: res.errors });
    return res.settings;
  });

  app.get("/api/models", async (req, reply) => {
    if (!deps.models) return reply.code(501).send(TODO);
    const q = req.query as Record<string, string | undefined>;
    const provider = q["provider"];
    if (!provider) return reply.code(400).send({ error: "missing ?provider=" });
    return { provider, models: await deps.models.listModels(provider) };
  });
}
