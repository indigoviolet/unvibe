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
 *   invalid (including a model id the adapter does not offer), otherwise
 *   the full updated settings.
 * - `GET /api/models?provider=:id` — models the provider offers (live, or
 *   the static fallback offline).
 *
 * Without wired stores the endpoints stay 501 stubs (scaffold behaviour).
 */
import type { FastifyInstance } from "fastify";
import type { ModelPick, Settings } from "@unvibe/shared";
import { selectDefaultModels, validateSettings } from "../settings/index.js";
import type { RouteDeps } from "./deps.js";

type Role = "main" | "small" | "secondOpinion";

const ROLES: Role[] = ["main", "small", "secondOpinion"];

/** Unset second-opinion marker: no Codex model chosen yet. */
export function unsetSecondOpinion(): ModelPick {
  return { provider: "codex", model: "" };
}

/**
 * Effective settings: stored values, with live adapter defaults filled in
 * for roles the user never saved. Never throws (falls back to stored).
 */
export async function effectiveSettings(deps: RouteDeps): Promise<Settings> {
  const stored = deps.settings!.get();
  const offered = deps.models?.offered;
  if (typeof offered !== "function") return stored;
  let saved: string[] = [];
  try {
    saved = deps.settings!.savedKeys();
  } catch {
    saved = [];
  }
  if (ROLES.every((r) => saved.includes(r))) return stored;
  const next: Settings = structuredClone(stored);
  try {
    const [claude, codex] = await Promise.all([
      offered.call(deps.models, "claude"),
      offered.call(deps.models, "codex"),
    ]);
    const claudeIds = (claude?.models ?? []).map((m) => (typeof m === "string" ? m : m.id));
    const codexIds = (codex?.models ?? []).map((m) => (typeof m === "string" ? m : m.id));
    if (!saved.includes("main") || !saved.includes("small")) {
      if (claude && claude.models.length > 0) {
        const picked = selectDefaultModels({
          claude: claudeIds,
          codex: codexIds,
          ...(codex?.defaultId ? { codexDefault: codex.defaultId } : {}),
        });
        if (!saved.includes("main")) next.main = picked.main;
        if (!saved.includes("small")) next.small = picked.small;
      }
    }
    if (!saved.includes("secondOpinion")) {
      if (codex && codex.models.length > 0) {
        const picked = selectDefaultModels({
          claude: claudeIds,
          codex: codexIds,
          ...(codex.defaultId ? { codexDefault: codex.defaultId } : {}),
        });
        next.secondOpinion = picked.secondOpinion ?? unsetSecondOpinion();
      } else if (codex) {
        // Definitive empty offering (live adapter, no Codex): unset.
        next.secondOpinion = unsetSecondOpinion();
      }
      // Unknown (null): leave the stored/static default alone.
    }
  } catch {
    // Adapter probe hiccup: stored values stand.
  }
  return next;
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
    if (typeof offered === "function") {
      const problems: string[] = [];
      for (const role of ROLES) {
        const pick = patch[role];
        if (!pick || pick.model === "") continue;
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
}
