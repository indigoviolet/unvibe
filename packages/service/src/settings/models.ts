/**
 * Model catalog (PRD §4.14 "Models").
 *
 * Listing the models each provider offers will come from the ACP adapter
 * (per-adapter `listModels`). Until that lands, the service returns a
 * static default so Settings can render the pickers.
 */

export interface ModelCatalog {
  listModels(provider: string): string[] | Promise<string[]>;
}

/** Provider ids known before the ACP adapters land. */
export const KNOWN_PROVIDERS = ["claude", "codex"] as const;

/**
 * Static defaults until the ACP adapter implements `listModels(provider)`.
 * Model ids are placeholders in the same shape the adapters will return
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

  providers(): string[] {
    return Object.keys(this.models);
  }
}
