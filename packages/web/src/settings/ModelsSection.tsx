/**
 * Models section (PRD §4.14): one picker per role (main, small, second
 * opinion). Provider first, then the models that provider's adapter offers
 * (`GET /api/models`). An adapter that is not installed or not logged in
 * answers 404 — shown as a clear message, never an empty list. Warns when
 * the second opinion uses the same model as main (PRD §4.10 wants a
 * different one).
 */
import { useEffect, useRef, useState } from "react";
import type { ModelInfo, ModelPick, ReadinessCheck, Settings, ThinkingResponse } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";

/** Display label the same way everywhere (#21): name beside the id. */
export function modelLabel(m: ModelInfo): string {
  return m.name ? `${m.name} (${m.id})` : m.id;
}

type Role = "main" | "small" | "secondOpinion";

const ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: "main", label: "Main", blurb: "Writes the guide, explanations and answers." },
  { role: "small", label: "Small", blurb: "Hunk summaries, titles and other small jobs." },
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
          — pick a different one so the second opinion is independent.
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
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState<ThinkingResponse | null>(null);
  const [thinkingError, setThinkingError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [effortReset, setEffortReset] = useState<string | null>(null);

  // Keep the provider select in sync when settings arrive late / change,
  // but never snap it back while the user is browsing another provider's
  // list (a settings refetch or WebSocket update arriving mid-browse, #87).
  // Only a save (via onSaved) or an external change made while not browsing
  // moves the select: the saved provider is compared against what it was,
  // not against the current browse choice.
  const savedProvider = pick.provider;
  const prevSavedProvider = useRef(savedProvider);
  useEffect(() => {
    const prev = prevSavedProvider.current;
    prevSavedProvider.current = savedProvider;
    if (savedProvider === prev) return;
    setProvider((current) => (current === prev ? savedProvider : current));
  }, [savedProvider]);

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setError(null);
    setThinking(null);
    setThinkingError(null);
    api
      .models(provider)
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(friendlyError(err));
      });
    // Thinking levels come from the same provider's adapter (#172): the
    // values it offers, with Default first (leave its own setting alone).
    // No options (not installed, offline) is fine — Default still stands.
    api
      .thinking(provider)
      .then((r) => {
        if (!cancelled) setThinking(r);
      })
      .catch((err: unknown) => {
        if (!cancelled) setThinkingError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const providers = KNOWN_PROVIDERS.includes(provider) ? KNOWN_PROVIDERS : [provider, ...KNOWN_PROVIDERS];

  // The saved pick may have disappeared from the adapter's list (model
  // retired or renamed): flag it plainly instead of silently keeping it.
  // While another provider's list is being browsed nothing is saved yet:
  // the pick only changes when a model is chosen from that list (#87).
  const browsing = provider !== pick.provider;
  const modelIds = models?.map((m) => m.id) ?? null;
  const offeredMissing =
    !browsing && modelIds !== null && error === null && pick.model !== "" && !modelIds.includes(pick.model);
  const unset = role === "secondOpinion" && pick.model === "";

  // The saved effort may no longer be offered (model changed elsewhere,
  // values renamed): flag it plainly; picking a value below fixes it.
  const savedEffort = pick.effort ?? "";
  const effortValues = !browsing && thinkingError === null ? (thinking?.options.map((o) => o.value) ?? null) : null;
  const effortMissing =
    !browsing && effortValues !== null && savedEffort !== "" && !effortValues.includes(savedEffort);

  const save = async (next: ModelPick): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    setEffortReset(null);
    try {
      const payload: ModelPick = { ...next };
      if (next.effort === undefined && savedEffort !== "") {
        // Saving a new model: keep the saved effort when the new provider
        // offers it, else fall back to Default and say so (#172). Unknown
        // offerings (still loading, fetch failed) keep the saved value;
        // the service skips validation then, and the warning above flags
        // it once the list is known.
        const values = thinkingError !== null ? null : (thinking?.options.map((o) => o.value) ?? null);
        if (values !== null && !values.includes(savedEffort)) {
          payload.effort = "";
          setEffortReset(`“${savedEffort}” isn't available for ${next.provider} — reset to Default.`);
        }
      }
      onSaved(await api.saveSettings({ [role]: payload }));
    } catch (err) {
      setSaveError(friendlyError(err));
      // The saved pick is unchanged: return both selects to it (#87).
      // Only revert when the user hasn't already moved on to another
      // provider while the save was in flight.
      setProvider((current) => (current === next.provider ? pick.provider : current));
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
          Not set — second opinions need a different model from main. Pick one below, or leave this
          unset; everything else works without one.
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
            setSaveError(null);
            setEffortReset(null);
            setProvider(e.target.value);
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
            <>
              <select
                id={`model-${role}`}
                value={browsing ? "" : pick.model}
                onChange={(e) => void save({ provider, model: e.target.value })}
                disabled={saving}
              >
                {browsing ? (
                  <option value="" disabled>
                    Pick a {provider} model…
                  </option>
                ) : pick.model === "" ? (
                  <option value="">Not set</option>
                ) : modelIds?.includes(pick.model) ? null : (
                  <option value={pick.model}>{pick.model} (current)</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id} title={m.description ?? undefined}>
                    {modelLabel(m)}
                  </option>
                ))}
              </select>
              {/* Description as secondary text for the current pick + all options (#21). */}
              {(() => {
                const current = browsing ? undefined : models.find((m) => m.id === pick.model);
                if (current?.description) {
                  return (
                    <span className="hint" data-testid={`model-${role}-desc`}>
                      {current.description}
                    </span>
                  );
                }
                return null;
              })()}
            </>
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
        <label htmlFor={`effort-${role}`}>{thinking?.label ?? "Effort"}</label>
        <div className="fld">
          {thinkingError ? (
            <span className="hint" role="status">
              Couldn't load thinking levels ({thinkingError}) — Default stands.
            </span>
          ) : thinking === null ? (
            <span className="hint">Loading thinking levels…</span>
          ) : (
            <>
              <select
                id={`effort-${role}`}
                value={browsing ? "" : savedEffort}
                onChange={(e) =>
                  void save({ provider: pick.provider, model: pick.model, effort: e.target.value })
                }
                disabled={saving || browsing}
                title="How hard the model thinks. Default leaves the provider's own setting alone."
              >
                {browsing ? (
                  <option value="" disabled>
                    Pick a {provider} model first…
                  </option>
                ) : (
                  <option value="">Default</option>
                )}
                {thinking.options.map((o) => (
                  <option key={o.value} value={o.value} title={o.description ?? undefined}>
                    {o.name ? `${o.name} (${o.value})` : o.value}
                  </option>
                ))}
              </select>
              {(() => {
                const current = browsing ? undefined : thinking.options.find((o) => o.value === savedEffort);
                if (current?.description) {
                  return (
                    <span className="hint" data-testid={`model-${role}-effort-desc`}>
                      {current.description}
                    </span>
                  );
                }
                return null;
              })()}
            </>
          )}
          {browsing && thinking !== null && thinkingError === null ? (
            <span className="hint">Pick a {provider} model first, then set its effort.</span>
          ) : null}
          {effortMissing ? (
            <span className="err" role="alert" data-testid={`model-${role}-effort-missing`}>
              Saved effort “{savedEffort}” is no longer offered by {pick.provider} — pick one of the values
              above.
            </span>
          ) : null}
          {effortReset ? (
            <span className="warnline" role="status" data-testid={`model-${role}-effort-reset`}>
              {effortReset}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
