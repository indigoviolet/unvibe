/**
 * Models section (PRD §4.14): one picker per role (main, small, second
 * opinion). Provider first, then the models that provider's adapter offers
 * (`GET /api/models`). An adapter that is not installed or not logged in
 * answers 404 — shown as a clear message, never an empty list. Warns when
 * the second opinion uses the same model as main (PRD §4.10 wants a
 * different one).
 */
import { useEffect, useState } from "react";
import type { ModelPick, ReadinessCheck, Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

type Role = "main" | "small" | "secondOpinion";

const ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: "main", label: "Main", blurb: "Everything that needs the review's context." },
  { role: "small", label: "Small", blurb: "Hunk summaries, titles, contribution cleanup." },
  { role: "secondOpinion", label: "Second opinion", blurb: "A different model from main, for an independent take." },
];

const KNOWN_PROVIDERS = ["claude", "codex"];

export function ModelsSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  // Same agent status as the front-screen callouts, shown inline per picker
  // (fills in after render; never blocks the pickers).
  const [statusByRole, setStatusByRole] = useState<Record<string, ReadinessCheck | undefined>>({});
  useEffect(() => {
    let cancelled = false;
    api
      .readiness()
      .then((r) => {
        if (cancelled) return;
        const map: Record<string, ReadinessCheck | undefined> = {};
        for (const c of r.checks) {
          if (c.id.startsWith("agent:")) map[c.id.slice("agent:".length)] = c;
        }
        setStatusByRole(map);
      })
      .catch(() => {
        // Model pickers stay usable without status.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-label="Models" id="models" style={{ scrollMarginTop: 12 }}>
      <div className="divider">Models</div>
      {ROLES.map(({ role, label, blurb }) => (
        <ModelPicker
          key={role}
          role={role}
          label={label}
          blurb={blurb}
          settings={settings}
          onSaved={onSaved}
          status={statusByRole[role]}
        />
      ))}
      {settings.secondOpinion.provider === settings.main.provider &&
      settings.secondOpinion.model === settings.main.model ? (
        <p className="warnline" role="status">
          Second opinion uses the same model as main ({settings.main.provider}/{settings.main.model})
          — pick a different one so the second opinion is actually independent.
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
  status,
}: {
  role: Role;
  label: string;
  blurb: string;
  settings: Settings;
  onSaved: (next: Settings) => void;
  status?: ReadinessCheck;
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
        if (!cancelled) setError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const providers = KNOWN_PROVIDERS.includes(provider) ? KNOWN_PROVIDERS : [provider, ...KNOWN_PROVIDERS];

  // The saved pick may have disappeared from the adapter's list (model
  // retired or renamed): flag it plainly instead of silently keeping it.
  const offeredMissing = models !== null && error === null && pick.model !== "" && !models.includes(pick.model);
  const unset = role === "secondOpinion" && pick.model === "";

  const save = async (next: ModelPick): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      onSaved(await api.saveSettings({ [role]: next }));
    } catch (err) {
      setSaveError(friendlyError(err));
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
      {unset ? (
        <p className="hint" role="status" data-testid={`model-${role}-unset`} style={{ margin: "6px 0" }}>
          Not set — second opinions need a second provider (Codex). Pick one below, or leave this
          unset; everything else works with one provider.
        </p>
      ) : null}
      {offeredMissing ? (
        <p className="err" role="alert" data-testid={`model-${role}-missing`} style={{ margin: "6px 0" }}>
          Saved model “{pick.model}” is no longer offered by {pick.provider} — pick one of the
          models below.
        </p>
      ) : null}
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
              value={pick.model}
              onChange={(e) => void save({ provider: pick.provider, model: e.target.value })}
              disabled={saving}
            >
              {pick.model === "" ? <option value="">Not set</option> : null}
              {models.includes(pick.model) ? null : pick.model !== "" ? <option value={pick.model}>{pick.model} (current)</option> : null}
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
          {status && status.status !== "ok" ? (
            <span
              className={status.status === "warning" ? "warnline" : "err"}
              role="status"
              data-testid={`model-${role}-status`}
            >
              {status.summary}
              {status.fix ? ` — ${status.fix}` : ""}
            </span>
          ) : null}
          {status?.status === "ok" ? (
            <span className="hint" data-testid={`model-${role}-status`}>
              {status.summary}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
