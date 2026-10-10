/**
 * Models section (PRD §4.14): one picker per role (main, small, second
 * opinion). Provider first, then the models that provider's adapter offers
 * (`GET /api/models`). An adapter that is not installed or not logged in
 * answers 404 — shown as a clear message, never an empty list. Warns when
 * the second opinion uses the same model as main (PRD §4.10 wants a
 * different one).
 */
import { useEffect, useState } from "react";
import type { ModelPick, Settings } from "@unvibe/shared";
import { api } from "../api/client.js";

type Role = "main" | "small" | "secondOpinion";

const ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: "main", label: "Main", blurb: "Everything that needs the review's context." },
  { role: "small", label: "Small", blurb: "Hunk summaries, titles, contribution cleanup." },
  { role: "secondOpinion", label: "Second opinion", blurb: "A different model from main (PRD §4.10)." },
];

const KNOWN_PROVIDERS = ["claude", "codex"];

export function ModelsSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  return (
    <section aria-label="Models">
      <div className="divider">Models</div>
      {ROLES.map(({ role, label, blurb }) => (
        <ModelPicker key={role} role={role} label={label} blurb={blurb} settings={settings} onSaved={onSaved} />
      ))}
      {settings.secondOpinion.model === settings.main.model ? (
        <p className="warnline" role="status">
          Second opinion uses the same model as main ({settings.main.model}) — pick a different one so the
          second opinion is actually independent.
        </p>
      ) : null}
    </section>
  );
}

function ModelPicker({
  role,
  label,
  blurb,
  settings,
  onSaved,
}: {
  role: Role;
  label: string;
  blurb: string;
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const pick: ModelPick = settings[role];
  const [provider, setProvider] = useState(pick.provider);
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep the provider select in sync when settings arrive late / change.
  useEffect(() => {
    setProvider(settings[role].provider);
  }, [settings, role]);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setError(null);
    api
      .models(provider)
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(modelsError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const providers = KNOWN_PROVIDERS.includes(provider) ? KNOWN_PROVIDERS : [provider, ...KNOWN_PROVIDERS];

  const save = async (next: ModelPick): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await api.saveSettings({ [role]: next }));
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: "8px 14px" }} data-testid={`model-${role}`}>
      <div className="frow" style={{ gap: 8 }}>
        <b style={{ minWidth: 110 }}>{label}</b>
        <span className="hint">{blurb}</span>
      </div>
      <div className="setgrid">
        <label htmlFor={`prov-${role}`}>Provider</label>
        <select
          id={`prov-${role}`}
          value={provider}
          onChange={(e) => {
            const nextProvider = e.target.value;
            setProvider(nextProvider);
            // Keep the current model until the new list loads; the model
            // select below offers it when missing.
            void save({ provider: nextProvider, model: pick.model });
          }}
        >
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label htmlFor={`model-${role}`}>Model</label>
        <div className="fld">
          {error ? (
            <span className="err" role="alert">
              {error}
            </span>
          ) : models === null ? (
            <span className="hint">Loading models…</span>
          ) : (
            <select
              id={`model-${role}`}
              value={models.includes(pick.model) ? pick.model : pick.model}
              onChange={(e) => void save({ provider: pick.provider, model: e.target.value })}
              disabled={saving}
            >
              {models.includes(pick.model) ? null : <option value={pick.model}>{pick.model} (current)</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          {saving ? <span className="hint">Saving…</span> : null}
          {saveError ? (
            <span className="err" role="alert">
              {saveError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function modelsError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const body = msg.match(/\{.*\}$/)?.[0];
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Fall through to the raw message.
    }
  }
  return msg;
}
