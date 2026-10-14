/**
 * Settings routes (PRD §14.1, §4.14).
 *
 * - `GET /api/settings` — full settings. Roles never explicitly saved take
 *   live defaults computed from what each adapter offers (`listModels` via
 *   `selectDefaultModels`); with no live adapter the static defaults stand.
 *   A second opinion with no Codex available comes back unset
 *   (`{ provider: "codex", model: "" }`); the UI explains a different
 *   model from main is needed.
 * - `PUT /api/settings` — partial update; 400 with `{ errors }` when
 *   invalid (including a model id or effort value the adapter does not
 *   offer), otherwise the full updated settings.
 * - `GET /api/models?provider=:id` — models the provider offers (live, or
 *   the static fallback offline).
 * - `GET /api/thinking?provider=:id` — thinking levels the provider's
 *   adapter offers (issue #172; empty options with no live adapter, so the
 *   UI offers Default only).
 *
 * Without wired stores the endpoints stay 501 stubs (scaffold behaviour).
 */
import type { FastifyInstance } from "fastify";
import type { Settings, ThinkingResponse } from "@unvibe/shared";
import { resolveEffectiveSettings, unsetSecondOpinion, validateSettings } from "../settings/index.js";
import type { RouteDeps } from "./deps.js";

export { unsetSecondOpinion };

type Role = "main" | "small" | "secondOpinion";

const ROLES: Role[] = ["main", "small", "secondOpinion"];

/**
 * Effective settings: stored values, with live adapter defaults filled in
 * for roles the user never saved. Never throws (falls back to stored).
 * Single source lives in `settings/effective.ts`; every model consumer
 * (readiness, pipeline, second-opinion, shared context) resolves through
 * it so they agree with `GET /api/settings`.
 */
export async function effectiveSettings(deps: RouteDeps): Promise<Settings> {
  if (!deps.settings) throw new Error("settings are unavailable");
  return resolveEffectiveSettings({ settings: deps.settings, models: deps.models ?? null });
}

export async function registerSettings(app: FastifyInstance, deps: RouteDeps = {}): Promise<void> {
  const TODO = { error: "not available in this build" };

  app.get("/api/settings", async (_req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    return effectiveSettings(deps);
  });

  app.put("/api/settings", async (req, reply) => {
    if (!deps.settings) return reply.code(501).send(TODO);
    const patch = ((req.body ?? {}) as Partial<Settings>) ?? {};
    const syncErrors = validateSettings(patch as Record<string, unknown>);
    if (syncErrors.length > 0) return reply.code(400).send({ errors: syncErrors });
    // Never persist a model id the adapter does not offer. Unknown
    // offerings (adapter down) skip validation; readiness flags the pick
    // if it later disappears.
    const offered = deps.models?.offered;
    const thinking = deps.models?.thinking;
    if (typeof offered === "function" || typeof thinking === "function") {
      const problems: string[] = [];
      for (const role of ROLES) {
        const pick = patch[role];
        if (!pick || pick.model === "") continue;
        if (typeof offered === "function") {
          try {
            const live = await offered.call(deps.models, pick.provider);
            if (live) {
              const ids = live.models.map((m) => (typeof m === "string" ? m : m.id));
              if (!ids.includes(pick.model)) {
                problems.push(
                  `${role} model "${pick.model}" is not offered by ${pick.provider} (offers: ${ids.join(", ") || "none"}) — pick one of the offered models`,
                );
              }
            }
          } catch {
            // Probe hiccup: stored value stands; readiness flags it later.
          }
        }
        // Never persist an effort value the adapter does not offer.
        // Default (""/absent) always passes: it leaves the adapter's own
        // setting alone.
        const effort = pick.effort ?? "";
        if (effort !== "" && typeof thinking === "function") {
          try {
            const live = await thinking.call(deps.models, pick.provider);
            if (live) {
              const values = live.options.map((o) => o.value);
              if (!values.includes(effort)) {
                problems.push(
                  `${role} effort "${effort}" is not offered by ${pick.provider} (offers: ${values.join(", ") || "none"}) — pick one of the offered values or Default`,
                );
              }
            }
          } catch {
            // Probe hiccup: stored value stands; the job reports it later.
          }
        }
      }
      if (problems.length > 0) return reply.code(400).send({ errors: problems });
    }
    const res = deps.settings.update(patch);
    if (res.errors) return reply.code(400).send({ errors: res.errors });
    return res.settings;
  });

  app.get("/api/models", async (req, reply) => {
    if (!deps.models) return reply.code(501).send(TODO);
    const q = req.query as Record<string, string | undefined>;
    const provider = q["provider"];
    if (!provider) return reply.code(400).send({ error: "missing ?provider=" });
    const models = await deps.models.listModels(provider);
    if (models.length === 0) {
      // No silent empty list (PRD §4.14): the adapter is not installed or
      // the provider is not logged in — say so plainly.
      return reply.code(404).send({
        error: `couldn't list ${provider} models — check that its CLI is installed and logged in`,
        provider,
        models: [],
      });
    }
    return { provider, models };
  });

  app.get("/api/thinking", async (req, reply) => {
    if (!deps.models) return reply.code(501).send(TODO);
    const q = req.query as Record<string, string | undefined>;
    const provider = q["provider"];
    if (!provider) return reply.code(400).send({ error: "missing ?provider=" });
    const thinking = deps.models.thinking;
    // No live adapter (replay/test runners, offline): no options, so the
    // UI offers Default only — never an error.
    if (typeof thinking !== "function") {
      const body: ThinkingResponse = { provider, options: [] };
      return body;
    }
    const live = await thinking.call(deps.models, provider);
    const body: ThinkingResponse = {
      provider,
      options: live?.options ?? [],
      ...(live?.label ? { label: live.label } : {}),
      ...(live?.current ? { current: live.current } : {}),
    };
    return body;
  });
}
