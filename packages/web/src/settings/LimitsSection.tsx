/**
 * Limits and budgets (PRD §4.14): concurrent sessions per provider, inline
 * size budget, base-rebuild thresholds, cache lifetime, idle-exit minutes.
 * Validation errors from `PUT /api/settings` (400 `{ errors }`) are shown
 * inline under the field they name.
 */
import { useState } from "react";
import type { Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

export interface Field {
  key: keyof Settings;
  label: string;
  hint: string;
  step?: string;
}

const FIELDS: Field[] = [
  { key: "sessionsPerProvider", label: "Agent sessions at once, per provider", hint: "1 to 32. Default 4." },
  { key: "inlineBudgetTokens", label: "Largest diff sent to the agent in full (tokens)", hint: "Larger diffs are sent as summaries and the agent fetches the rest when it needs it. Default 40,000." },
  { key: "rebuildSupersededRatio", label: "Rebuild the agent's context when this share of it is out of date", hint: "Above 0, up to 1. Default 0.2.", step: "0.01" },
  { key: "rebuildAppendedTokens", label: "Rebuild the agent's context after this many added tokens", hint: "Default 10,000." },
  { key: "cacheLifetimeMs", label: "Close idle agent sessions after (ms)", hint: "Default 300,000 (5 minutes)." },
  { key: "idleExitMinutes", label: "Stop the service when idle for (minutes)", hint: "0 means never. Default 10." },
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
        setErrors([`${f.label}: enter a number`]);
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
    <section aria-label="Limits">
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
                .filter((m) => m.startsWith(String(f.key)) || m.startsWith(f.label))
                .map((m) => (
                  <span className="err" role="alert" key={m}>
                    {labelError(f, m)}
                  </span>
                ))}
            </div>
          </div>
        ))}
        {errors
          .filter((m) => !FIELDS.some((f) => m.startsWith(String(f.key)) || m.startsWith(f.label)))
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

/**
 * Validation errors from the service start with the internal key
 * ("sessionsPerProvider must be …", issue #86 finding 11): show the
 * field's label instead, keeping the rest of the message. Messages that
 * already start with the label (client-side checks) pass through.
 */
export function labelError(f: Field, message: string): string {
  const key = String(f.key);
  if (message.startsWith(key)) {
    return `${f.label}: ${message.slice(key.length).replace(/^[\s:]+/, "")}`;
  }
  return message;
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
