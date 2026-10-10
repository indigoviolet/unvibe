/**
 * Limits and budgets (PRD §4.14): concurrent sessions per provider, inline
 * size budget, base-rebuild thresholds, cache lifetime, idle-exit minutes.
 * Validation errors from `PUT /api/settings` (400 `{ errors }`) are shown
 * inline under the field they name.
 */
import { useState } from "react";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

interface Field {
  key: keyof Settings;
  label: string;
  hint: string;
  step?: string;
}

const FIELDS: Field[] = [
  { key: "sessionsPerProvider", label: "Concurrent sessions per provider", hint: "Integer 1–32 (default 4)." },
  { key: "inlineBudgetTokens", label: "Inline size budget (tokens)", hint: "L1 budget, ~40k default." },
  { key: "rebuildSupersededRatio", label: "Base-rebuild superseded ratio", hint: "Number in (0, 1] (default 0.2).", step: "0.01" },
  { key: "rebuildAppendedTokens", label: "Base-rebuild appended tokens", hint: "Tokens appended before rebuild (default 10k)." },
  { key: "cacheLifetimeMs", label: "Cache lifetime (ms)", hint: "Idle sessions close after this (default 5 min)." },
  { key: "idleExitMinutes", label: "Idle-exit (minutes)", hint: "Service exits after this long idle; 0 = never (default 10)." },
];

export function LimitsSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const value = (f: Field): string =>
    draft[f.key] ?? String(settings[f.key] as number);

  const save = async (): Promise<void> => {
    setSaving(true);
    setErrors([]);
    setSavedAt(null);
    const patch: Record<string, number> = {};
    for (const f of FIELDS) {
      const raw = (draft[f.key] ?? "").trim();
      if (raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        setErrors([`${f.key} must be a number`]);
        setSaving(false);
        return;
      }
      patch[f.key] = n;
    }
    try {
      const next = await api.saveSettings(patch);
      onSaved(next);
      setDraft({});
      setSavedAt("Saved");
    } catch (err) {
      setErrors(putErrors(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Limits and budgets">
      <div className="divider">Limits and budgets</div>
      <div className="card" style={{ padding: "8px 14px" }}>
        {FIELDS.map((f) => (
          <div className="setgrid" key={f.key}>
            <label htmlFor={`limit-${f.key}`}>{f.label}</label>
            <div className="fld">
              <input
                id={`limit-${f.key}`}
                type="number"
                step={f.step ?? "1"}
                value={value(f)}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
              <span className="hint">{f.hint}</span>
              {errors
                .filter((m) => m.startsWith(String(f.key)))
                .map((m) => (
                  <span className="err" role="alert" key={m}>
                    {m}
                  </span>
                ))}
            </div>
          </div>
        ))}
        {errors
          .filter((m) => !FIELDS.some((f) => m.startsWith(String(f.key))))
          .map((m) => (
            <p className="err" role="alert" key={m}>
              {m}
            </p>
          ))}
        <div className="frow" style={{ gap: 8, marginTop: 8 }}>
          <button className="btn" type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save limits"}
          </button>
          {savedAt ? <span className="hint">{savedAt}</span> : null}
        </div>
      </div>
    </section>
  );
}

/** `PUT /api/settings` 400s carry `{ errors: string[] }` inside the message. */
export function putErrors(err: unknown): string[] {
  const msg = err instanceof Error ? err.message : String(err);
  const body = msg.match(/\{.*\}$/)?.[0];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { errors?: string[]; error?: string };
      if (Array.isArray(parsed.errors)) return parsed.errors.map(String);
      if (parsed.error) return [parsed.error];
    } catch {
      // Fall through.
    }
  }
  return [friendlyError(err)];
}
