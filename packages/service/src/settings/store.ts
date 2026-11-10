/**
 * Settings storage (PRD §4.14): `GET/PUT /api/settings` persisted in SQLite.
 *
 * The table is created lazily by this module (`CREATE TABLE IF NOT EXISTS`)
 * so parallel review-state work in `store/migrate.ts` never conflicts.
 * Every field has a default; `get()` always returns a complete `Settings`.
 */
import { defaultPersonas, isUiThemeId, GUIDE_PERSONA_ID, UI_THEME_IDS, validatePersona } from "@unvibe/shared";
import type { ModelPick, Settings } from "@unvibe/shared";
import type { DatabaseSync } from "../store/db.js";

export const DEFAULT_SETTINGS: Settings = {
  uiTheme: "default",
  // Static fallback only (issue #88): live defaults from
  // `resolveEffectiveSettings` win whenever adapter listings are known.
  // These ids must exist on a fresh install with both providers logged in
  // so the fallback never warns "not offered"; they surface only when no
  // listing is known (offline, adapter down) or no allowed family is
  // offered, where readiness reports them plainly.
  // Effort is "" (Default) for every role: the adapter's own thinking
  // level stands unless the owner picks one (issue #172).
  small: { provider: "claude", model: "claude-haiku-5-5", effort: "" },
  // Issue #349: persona definitions, seeded with the built-in Guide
  // (issue #379: the main agent — exactly one, fixed, owns the main
  // provider + model), Second opinion and Clarity. After seeding each
  // non-Guide entry is ordinary data (add, edit, delete through
  // Settings → Personas); the Guide entry stays fixed.
  personas: defaultPersonas(),
  sessionsPerProvider: 16,
  inlineBudgetTokens: 40_000,
  rebuildSupersededRatio: 0.2,
  rebuildAppendedTokens: 10_000,
  logBatchTokens: 2_000,
  cacheLifetimeMs: 5 * 60 * 1000,
  idleExitMinutes: 10,
  /** Issue #376: at most this many hunk summaries per review version. */
  hunkSummaryLimit: 50,
  /**
   * Version picker (issue #36, step 2; toggle meaning #231): releases
   * are always listed and switchable, and the update check always runs
   * (listing shells out through `gh` under the user's own login, like
   * every other `gh` use — PRD §16). Off by default; only preview
   * channels stay hidden until it is on.
   */
  versionPickerEnabled: false,
  /**
   * Issue #160: full access for agent sessions. Off by default; enabling
   * requires the warning acknowledgement in the same update (enforced in
   * `validateSettings`, so the API refuses without it, not only the web).
   */
  fullAccess: false,
  fullAccessAcknowledgedAt: null,
  /** Issue #217: go-deeper cards write themselves after the guide. On by default. */
  autoGoDeeper: true,
  /** Issue #356: record OpenTelemetry performance traces. Off by default. */
  recordTraces: false,
  /** Issue #322: null = never chosen (service defaults to 3 most recent). */
  extensionActiveRepoIds: null,
  /** Issue #322: panel turns default to muse-spark. */
  extensionModel: { provider: "pi", model: "muse-spark-1.3-contributor", effort: "" },
};

function isModelPick(v: unknown): v is ModelPick {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["provider"] === "string" && typeof o["model"] === "string" && typeof o["effort"] === "string"
  );
}

/** Validate a partial update; returns error messages (empty = valid). */
export function validateSettings(patch: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const extIds = patch["extensionActiveRepoIds"];
  if (extIds !== undefined && extIds !== null && (!Array.isArray(extIds) || extIds.some((x) => typeof x !== "string"))) {
    errors.push("extensionActiveRepoIds must be null or an array of repo id strings");
  }
  const extModel = patch["extensionModel"];
  if (extModel !== undefined && (!isModelPick(extModel) || !extModel.provider || !extModel.model)) {
    errors.push("extensionModel must be { provider, model } with non-empty strings");
  }
  for (const role of ["small"] as const) {
    const v = patch[role];
    if (v === undefined) continue;
    if (!isModelPick(v) || !v.provider || !v.model) {
      errors.push(`${role} must be { provider, model } with non-empty strings`);
    }
  }
  // Issue #349: personas arrive as a whole list (add, edit, delete all
  // PUT the full array). Every entry is validated; ids must be unique.
  const personas = patch["personas"];
  // Issue #379: the personas list must hold exactly one Guide entry,
  // fixed: not deletable, not disableable, owning its own model
  // (`followMain` false — it IS the model others follow) and carrying
  // no card instruction (its card task is the guide's own). The lens may
  // be empty only for the Guide (see `validatePersona`).
  if (personas !== undefined) {
    if (!Array.isArray(personas)) {
      errors.push("personas must be an array of persona definitions");
    } else {
      const seen = new Set<string>();
      personas.forEach((p, i) => {
        for (const e of validatePersona(p)) errors.push(`personas[${i}]: ${e}`);
        const id = (p as { id?: unknown } | null)?.id;
        if (typeof id === "string" && id !== "") {
          if (seen.has(id)) errors.push(`personas[${i}]: duplicate persona id "${id}"`);
          seen.add(id);
        }
      });
      const guides = personas.filter(
        (p) => (p as { id?: unknown } | null)?.id === GUIDE_PERSONA_ID,
      );
      if (guides.length !== 1) {
        errors.push(
          `personas must hold exactly one "${GUIDE_PERSONA_ID}" entry (the main agent; not deletable), found ${guides.length}`,
        );
      } else {
        const g = guides[0] as unknown as Record<string, unknown>;
        if (g["enabled"] !== true) errors.push("the Guide persona cannot be disabled");
        if (g["followMain"] !== false) errors.push("the Guide persona owns the main model (followMain must be false)");
        if (g["cardInstruction"] !== "") errors.push("the Guide persona takes no card instruction");
      }
    }
  }
  const int = (name: string, min: number, max: number): void => {
    const v = patch[name];
    if (v === undefined) return;
    if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) {
      errors.push(`${name} must be an integer in [${min}, ${max}]`);
    }
  };
  int("sessionsPerProvider", 1, 32);
  int("inlineBudgetTokens", 1, 10_000_000);
  int("rebuildAppendedTokens", 1, 10_000_000);
  int("logBatchTokens", 1, 10_000_000);
  int("cacheLifetimeMs", 1000, 24 * 60 * 60 * 1000);
  int("idleExitMinutes", 0, 24 * 60);
  int("hunkSummaryLimit", 0, 500);
  const ratio = patch["rebuildSupersededRatio"];
  if (ratio !== undefined && (typeof ratio !== "number" || ratio <= 0 || ratio > 1)) {
    errors.push("rebuildSupersededRatio must be a number in (0, 1]");
  }
  const uiTheme = patch["uiTheme"];
  if (uiTheme !== undefined && !isUiThemeId(uiTheme)) {
    errors.push(`uiTheme must be one of: ${UI_THEME_IDS.join(", ")}`);
  }
  const picker = patch["versionPickerEnabled"];
  if (picker !== undefined && typeof picker !== "boolean") {
    errors.push("versionPickerEnabled must be a boolean");
  }
  // Issue #160: full access is opt-in with a stored acknowledgement. The
  // service refuses to enable without it (not only the web): enabling
  // requires the acknowledgement timestamp in the SAME update, and turning
  // the setting off clears the stored acknowledgement (see `update`).
  const autoGoDeeper = patch["autoGoDeeper"];
  if (autoGoDeeper !== undefined && typeof autoGoDeeper !== "boolean") {
    errors.push("autoGoDeeper must be a boolean");
  }
  const recordTraces = patch["recordTraces"];
  if (recordTraces !== undefined && typeof recordTraces !== "boolean") {
    errors.push("recordTraces must be a boolean");
  }
  const fullAccess = patch["fullAccess"];
  if (fullAccess !== undefined && typeof fullAccess !== "boolean") {
    errors.push("fullAccess must be a boolean");
  }
  const ack = patch["fullAccessAcknowledgedAt"];
  if (ack !== undefined && ack !== null && (!Number.isInteger(ack) || (ack as number) < 0)) {
    errors.push("fullAccessAcknowledgedAt must be null or a non-negative integer epoch ms");
  }
  if (fullAccess === true && (ack === undefined || ack === null)) {
    errors.push("fullAccess needs the warning acknowledgement: send fullAccessAcknowledgedAt with the update");
  }
  for (const key of Object.keys(patch)) {
    if (!(key in DEFAULT_SETTINGS)) errors.push(`unknown setting: ${key}`);
  }
  return errors;
}

export class SettingsStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }

  /** Full settings: stored values merged over defaults. */
  get(): Settings {    const rows = this.db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const out: Settings = structuredClone(DEFAULT_SETTINGS);
    for (const row of rows) {
      if (!(row.key in out)) continue;
      (out as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    }
    return out;
  }

  /** Keys the user (or a test) explicitly saved. Never-saved roles take live defaults. */
  savedKeys(): string[] {
    try {
      const rows = this.db.prepare("SELECT key FROM settings").all() as { key: string }[];
      return rows.map((r) => r.key);
    } catch {
      return [];
    }
  }

  /** Merge a partial update over current settings and persist it. */
  update(patch: Partial<Settings>): { settings?: Settings; errors?: string[] } {
    const errors = validateSettings(patch as Record<string, unknown>);
    if (errors.length > 0) return { errors };
    const stmt = this.db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    );
    // Issue #160: turning full access off clears the acknowledgement, so
    // turning it on again asks again.
    const effective: Record<string, unknown> = { ...patch };
    if (patch.fullAccess === false) effective["fullAccessAcknowledgedAt"] = null;
    for (const [key, value] of Object.entries(effective)) {
      if (value !== undefined) stmt.run(key, JSON.stringify(value));
    }
    return { settings: this.get() };
  }
}
