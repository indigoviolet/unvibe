/**
 * Model catalog (PRD §4.14 "Models").
 *
 * Live listings come from the ACP adapters (per-adapter `listModels`,
 * wired in `app.ts: AcpModelCatalog`); the static list below is the
 * offline fallback so Settings renders pickers without a login.
 */

export interface OfferedModels {
  models: string[];
  /** The adapter's current (default) model id, when the adapter reports one. */
  defaultId: string | null;
}

export interface ModelCatalog {
  listModels(provider: string): string[] | Promise<string[]>;
  /**
   * Live adapter offering, or null when unknown (adapter down, timed out,
   * or no live adapter). Null means "don't validate, keep static
   * defaults" — never "no models".
   */
  offered?(provider: string): Promise<OfferedModels | null>;
}

/** Provider ids known before the ACP adapters land. */
export const KNOWN_PROVIDERS = ["claude", "codex"] as const;

/**
 * Static fallback when no adapter is reachable (offline, not logged in,
 * replay/test runners). Model ids mirror the adapters' shape
 * (`provider/model`, e.g. `codex/gpt-5.4`).
 */
export const STATIC_MODELS: Record<string, string[]> = {
  claude: ["claude-sonnet", "claude-opus"],
  codex: ["gpt-5.4", "gpt-5.4-mini"],
};

export class StaticModelCatalog implements ModelCatalog {
  constructor(private readonly models: Record<string, string[]> = STATIC_MODELS) {}

  listModels(provider: string): string[] {
    return [...(this.models[provider] ?? [])];
  }

  /**
   * The static catalog makes no liveness claim: null, so settings keeps
   * static defaults and skips offer validation (replay/test runners and
   * offline use). Tests needing validation inject their own catalog.
   */
  offered(): Promise<null> {
    return Promise.resolve(null);
  }

  providers(): string[] {
    return Object.keys(this.models);
  }
}
