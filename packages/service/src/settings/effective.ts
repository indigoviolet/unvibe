/**
 * Effective settings (issue #88): the one place that overlays live model
 * defaults over stored settings.
 *
 * A saved pick always wins; a role the user never saved takes the live
 * default picked from what each adapter offers (`selectDefaultModels`).
 * `GET /api/settings`, readiness and the pipeline runner all resolve
 * through here, so they agree.
 *
 * Never throws and never writes: unknown offerings (adapter down, timed
 * out, no live catalog) keep the stored values. Readiness reports stored
 * picks plainly. A computed default is never persisted — a saved pick is
 * something the user chose.
 *
 * (Issue #349 removed the second-opinion role: personas each name their
 * own model, managed through Settings → Personas. Issue #379 moved the
 * main role into the fixed Guide persona: the live main default seeds
 * the Guide's provider/model while the personas list is unsaved.)
 */
import type { Settings } from "@unvibe/shared";
import { getGuidePersona } from "@unvibe/shared";
import { selectDefaultModels } from "./defaults.js";
import type { ModelCatalog } from "./models.js";

/** Anything that can supply stored settings (the store, or a test stub). */
export interface SettingsSource {
  get(): Settings;
  savedKeys?(): string[];
}

export type SettingsRole = "small";

const ROLES: SettingsRole[] = ["small"];

/**
 * The Guide persona's provider/model: the main role (issue #379).
 * Personas name no effort, so the adapter default (""). Throws when
 * the list holds no Guide — settings always seed exactly one.
 */
export function guidePick(settings: Settings): { provider: string; model: string; effort: string } {
  const guide = getGuidePersona(settings.personas);
  if (!guide) throw new Error("settings hold no Guide persona");
  return { provider: guide.provider, model: guide.model, effort: "" };
}

export interface EffectiveSettingsDeps {
  settings: SettingsSource;
  models?: ModelCatalog | null;
}

function idsOf(offered: { models: ({ id: string } | string)[] } | null | undefined): string[] {
  return (offered?.models ?? []).map((m) => (typeof m === "string" ? m : m.id)).filter(Boolean);
}

/**
 * Stored settings with live defaults filled in for never-saved roles.
 * Probes both providers in parallel; any hiccup keeps stored values.
 */
export async function resolveEffectiveSettings(deps: EffectiveSettingsDeps): Promise<Settings> {
  const stored = deps.settings.get();
  let saved: string[] = [];
  try {
    saved = typeof deps.settings.savedKeys === "function" ? deps.settings.savedKeys() : [];
  } catch {
    saved = [];
  }
  if (ROLES.every((r) => saved.includes(r)) && saved.includes("personas")) return stored;
  const offeredFn = deps.models?.offered;
  if (typeof offeredFn !== "function") return stored;
  const next: Settings = structuredClone(stored);
  try {
    const [claude, codex] = await Promise.all([
      offeredFn.call(deps.models, "claude"),
      offeredFn.call(deps.models, "codex"),
    ]);
    const claudeIds = idsOf(claude);
    const codexIds = idsOf(codex);
    const known = claude !== null || codex !== null;
    if (known) {
      const picked = selectDefaultModels({ claude: claudeIds, codex: codexIds });
      // Live picks win; unfillable roles keep the stored (static) pick so
      // readiness can report it plainly.
      if (!saved.includes("small") && picked.small) next.small = picked.small;
      // Issue #379: the Guide persona holds the main role. While the
      // personas list itself is unsaved, the Guide's provider/model take
      // the live main default; a saved list always wins, lens and all.
      if (!saved.includes("personas") && picked.main) {
        const guide = getGuidePersona(next.personas);
        if (guide) {
          guide.provider = picked.main.provider;
          guide.model = picked.main.model;
        }
      }
    }
  } catch {
    // Adapter probe hiccup: stored values stand.
  }
  return next;
}
