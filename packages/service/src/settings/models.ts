/**
 * Model catalog (PRD §4.14 "Models").
 *
 * Live listings come from the ACP adapters (per-adapter `listModels`,
 * wired in `app.ts: AcpModelCatalog`); the static list below is the
 * offline fallback so Settings renders pickers without a login.
 */

import type { ModelInfo, ThinkingOption } from "@unvibe/shared";

export interface OfferedModels {
  models: ModelInfo[];
  /** The adapter's current (default) model id, when the adapter reports one. */
  defaultId: string | null;
}

/** Thinking levels an adapter offers for its effort selector (issue #172). */
export interface OfferedThinking {
  /** Display name for the selector (e.g. "Effort"). */
  label?: string;
  options: ThinkingOption[];
  /** The adapter's own current value (what Default leaves alone). */
  current?: string;
}

export interface ModelCatalog {
  listModels(provider: string): ModelInfo[] | Promise<ModelInfo[]>;
  /**
   * Providers the catalog serves (issue #279): `["claude", "codex"]` plus
   * `"pi"` only when its binary is detected. The model pickers list exactly
   * these; unknown providers 404 the same way unknown models do.
   */
  providers?(): string[] | Promise<string[]>;
  /**
   * Live adapter offering, or null when unknown (adapter down, timed out,
   * or no live adapter). Null means "don't validate, keep static
   * defaults" — never "no models".
   */
  offered?(provider: string): Promise<OfferedModels | null>;
  /**
   * Live thinking-level offering, or null when unknown (no live adapter,
   * probe failed). Null means "don't validate" — never "no options".
   */
  thinking?(provider: string): Promise<OfferedThinking | null>;
}

/** Provider ids known before the ACP adapters land. */
export const KNOWN_PROVIDERS = ["claude", "codex"] as const;

/**
 * Static fallback when no adapter is reachable (offline, not logged in,
 * replay/test runners). Model ids mirror the adapters' shape
 * (`provider/model`, e.g. `codex/gpt-6.1-sol`) and name ids the adapters
 * offer today (issue #88), so the fallback never warns "not offered" on a
 * fresh install; live listings replace it whenever they are known.
 */
export const STATIC_MODELS: Record<string, string[]> = {
  claude: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
  codex: ["gpt-6.1-sol", "gpt-5.6-terra", "gpt-6-luna"],
};

/** Display names for the static fallback (offline pickers still name models). */
export const STATIC_MODEL_INFO: Record<string, ModelInfo[]> = {
  claude: [
    { id: "claude-opus-5-5", name: "Opus 5.5" },
    { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
    { id: "claude-haiku-5-5", name: "Haiku 5.5" },
  ],
  codex: [
    { id: "gpt-6.1-sol", name: "Sol 6.1" },
    { id: "gpt-5.6-terra", name: "Terra 5.6" },
    { id: "gpt-6-luna", name: "Luna 6" },
  ],
};

export class StaticModelCatalog implements ModelCatalog {
  constructor(private readonly models: Record<string, string[]> = STATIC_MODELS) {}

  listModels(provider: string): ModelInfo[] {
    const ids = [...(this.models[provider] ?? [])];
    const info = STATIC_MODEL_INFO[provider];
    if (!info) return ids.map((id) => ({ id }));
    const byId = new Map(info.map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id) ?? { id });
  }

  /**
   * The static catalog makes no liveness claim: null, so settings keeps
   * static defaults and skips offer validation (replay/test runners and
   * offline use). Tests needing validation inject their own catalog.
   */
  offered(): Promise<null> {
    return Promise.resolve(null);
  }

  thinking(): Promise<null> {
    return Promise.resolve(null);
  }

  providers(): string[] {
    return Object.keys(this.models);
  }
}
