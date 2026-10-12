/**
 * Effective settings (issue #88): the one place that overlays live model
 * defaults over stored settings.
 *
 * A saved pick always wins; a role the user never saved takes the live
 * default picked from what each adapter offers (`selectDefaultModels`).
 * `GET /api/settings`, readiness, the pipeline runner, the second-opinion
 * runner and shared context all resolve through here, so they agree.
 *
 * Never throws and never writes: unknown offerings (adapter down, timed
 * out, no live catalog) or unfillable roles keep the stored values, and
 * readiness reports those picks plainly. A computed default is never
 * persisted — a saved pick is something the user chose.
 */
import type { ModelPick, Settings } from "@unvibe/shared";
import { selectDefaultModels } from "./defaults.js";
import type { ModelCatalog } from "./models.js";

/** Anything that can supply stored settings (the store, or a test stub). */
export interface SettingsSource {
  get(): Settings;
  savedKeys?(): string[];
}

export type SettingsRole = "main" | "small" | "secondOpinion";

const ROLES: SettingsRole[] = ["main", "small", "secondOpinion"];

/** Unset second-opinion marker: no second provider available yet. */
export function unsetSecondOpinion(): ModelPick {
  return { provider: "codex", model: "" };
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
  if (ROLES.every((r) => saved.includes(r))) return stored;
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
    if ((!saved.includes("main") || !saved.includes("small")) && known) {
      const picked = selectDefaultModels({ claude: claudeIds, codex: codexIds });
      // Live picks win; unfillable roles keep the stored (static) pick so
      // readiness can report it plainly.
      if (!saved.includes("main") && picked.main) next.main = picked.main;
      if (!saved.includes("small") && picked.small) next.small = picked.small;
    }
    if (!saved.includes("secondOpinion")) {
      // Against the final effective main (a saved main on Codex still
      // takes its second opinion from Claude). The other provider's
      // offering decides: definitive (even empty) means live-or-unset;
      // unknown keeps the stored pick.
      const other = next.main.provider === "codex" ? codex : claude;
      if (other !== null && other !== undefined) {
        const picked = selectDefaultModels(
          { claude: claudeIds, codex: codexIds },
          { provider: next.main.provider },
        );
        next.secondOpinion = picked.secondOpinion ?? unsetSecondOpinion();
      }
    }
  } catch {
    // Adapter probe hiccup: stored values stand.
  }
  return next;
}
