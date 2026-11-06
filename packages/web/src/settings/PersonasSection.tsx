/**
 * Personas section (issue #349, step 1): the persona list behind
 * Settings → Personas. Add, edit, delete (delete through the shared
 * #346 inline confirm); the colour swatch is read-only, auto-assigned
 * from the fixed sequence in creation order.
 *
 * The built-in Second opinion arrives seeded in fresh settings and is an
 * ordinary entry afterwards — editable and deletable like any other.
 * The built-in Clarity (issue #359) follows the main model
 * (`followMain`); the form shows that as "Main model" with the option
 * to pin a specific one.
 * Every change PUTs the whole list through `saveSettings`, like every
 * other settings section.
 */
import { useEffect, useState } from "react";
import type { ModelInfo, Persona, Settings } from "@unvibe/shared";
import { nextPersonaColor, slugifyPersonaName } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Button, Card, Checkbox, Field, InlineConfirm, Input, Select } from "../ui/index.js";
import { modelLabel } from "./ModelsSection.js";

const FALLBACK_PROVIDERS = ["claude", "codex"];

function uniquePersonaId(personas: Persona[], name: string): string {
  const base = slugifyPersonaName(name);
  if (!personas.some((p) => p.id === base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!personas.some((p) => p.id === candidate)) return candidate;
  }
}

export function PersonasSection({
  settings,
  onSaved,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
}): React.JSX.Element {
  const personas = settings.personas ?? [];
  const [providers, setProviders] = useState<string[]>(FALLBACK_PROVIDERS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .providers()
      .then((r) => {
        if (!cancelled && Array.isArray(r.providers) && r.providers.length > 0) setProviders(r.providers);
      })
      .catch(() => {
        // Provider list stays at the static fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveList = async (next: Persona[]): Promise<Settings> => {
    const saved = await api.saveSettings({ personas: next });
    onSaved(saved);
    return saved;
  };

  const remove = async (persona: Persona): Promise<void> => {
    setRemoving(persona.id);
    try {
      await saveList(personas.filter((p) => p.id !== persona.id));
    } catch (err) {
      setRemoving(null);
      throw err;
    }
  };

  const personaRemoved = (persona: Persona): void => {
    setConfirmRemove((open) => (open === persona.id ? null : open));
    setRemoving(null);
  };

  return (
    <section aria-label="Personas" id="personas" style={{ scrollMarginTop: 12 }} data-testid="personas-section">
      <p className="hint">
        Reviewer voices that can take on a card. Each runs on its model — or on the main model —
        with its lens; the colour is assigned automatically. Second opinion and Clarity are
        built in — edit or delete them like any other persona.
      </p>
      {error ? (
        <p className="err" role="alert">
          {error}
        </p>
      ) : null}
      {personas.length === 0 ? <p className="hint">No personas yet. Add one below.</p> : null}
      <div className="ui-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {personas.map((p) => (
          <Card
            key={p.id}
            variant="raised"
            data-testid={`persona-${p.id}`}
            style={{ borderLeft: `3px solid ${p.color}` }}
          >
            <div className="frow" style={{ gap: 8, alignItems: "center" }}>
              <span
                aria-hidden="true"
                title={`Colour ${p.color} (automatic)`}
                data-testid={`persona-${p.id}-swatch`}
                style={{
                  flex: "none",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: p.color,
                }}
              />
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div style={{ fontSize: 13 }}>
                  <b>{p.name}</b>
                  {p.enabled ? null : (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      Off
                    </span>
                  )}
                </div>
                <div className="hint">
                  {p.followMain
                    ? `Main model (${settings.main.provider}/${settings.main.model})`
                    : `${p.provider}/${p.model}`}
                </div>
              </div>
              <div className="frow" style={{ gap: 4, alignItems: "center" }}>
                {confirmRemove === p.id ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="quiet"
                    data-testid={`persona-${p.id}-edit`}
                    onClick={() => {
                      setEditingId((open) => (open === p.id ? null : p.id));
                      setError(null);
                    }}
                  >
                    {editingId === p.id ? "Close" : "Edit"}
                  </Button>
                )}
                <InlineConfirm
                  action="Delete"
                  confirmAction={`delete the “${p.name}” persona`}
                  runningLabel="Deleting…"
                  variant="quiet"
                  size="sm"
                  danger
                  placement="stack"
                  disabled={removing !== null}
                  open={confirmRemove === p.id}
                  onOpenChange={(v) => setConfirmRemove(v ? p.id : null)}
                  onConfirm={() => remove(p)}
                  onDone={() => personaRemoved(p)}
                  formatError={(err) => `Couldn't delete ${p.name}: ${friendlyError(err)}`}
                  detail={`Delete the “${p.name}” persona? This can't be undone.`}
                  idleAriaLabel={`Delete ${p.name}`}
                  title={`Delete ${p.name}`}
                />
              </div>
            </div>
            {editingId === p.id ? (
              <PersonaForm
                key={p.id}
                initial={p}
                providers={providers}
                mainPick={settings.main}
                submitLabel="Save"
                testIdPrefix={`persona-${p.id}`}
                onCancel={() => setEditingId(null)}
                onSave={async (draft) => {
                  try {
                    await saveList(personas.map((q) => (q.id === p.id ? draft : q)));
                  } catch (err) {
                    setError(friendlyError(err));
                    throw err;
                  }
                  setEditingId(null);
                }}
              />
            ) : null}
          </Card>
        ))}
      </div>
      {editingId === "new" ? (
        <Card variant="raised" data-testid="persona-new-form" style={{ marginTop: 8 }}>
          <PersonaForm
            initial={null}
            providers={providers}
            mainPick={settings.main}
            submitLabel="Add persona"
            testIdPrefix="persona-new"
            onCancel={() => setEditingId(null)}
            onSave={async (draft) => {
              const id = uniquePersonaId(personas, draft.name);
              const color = nextPersonaColor(personas);
              try {
                await saveList([...personas, { ...draft, id, color }]);
              } catch (err) {
                setError(friendlyError(err));
                throw err;
              }
              setEditingId(null);
            }}
          />
        </Card>
      ) : (
        <div style={{ marginTop: 8 }}>
          <Button
            type="button"
            variant="secondary"
            data-testid="persona-add"
            onClick={() => {
              setEditingId("new");
              setError(null);
            }}
          >
            Add persona
          </Button>
        </div>
      )}
    </section>
  );
}

function PersonaForm({
  initial,
  providers,
  mainPick,
  submitLabel,
  testIdPrefix,
  onCancel,
  onSave,
}: {
  /** Edited persona, or null for a new one (id + colour assigned on save). */
  initial: Persona | null;
  providers: string[];
  /** Current main pick: what a main-following persona runs on. */
  mainPick: { provider: string; model: string };
  submitLabel: string;
  testIdPrefix: string;
  onCancel: () => void;
  onSave: (draft: Persona) => Promise<void>;
}): React.JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [followMain, setFollowMain] = useState(initial?.followMain ?? false);
  const [provider, setProvider] = useState(initial?.provider ?? providers[0] ?? "claude");
  const [model, setModel] = useState(initial?.model ?? "");
  const [lens, setLens] = useState(initial?.lens ?? "");
  const [cardInstruction, setCardInstruction] = useState(initial?.cardInstruction ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Keep a late-arriving provider list: a new form started before the
  // list loaded keeps its fallback until the user picks otherwise.
  const providerOptions = providers.includes(provider) ? providers : [provider, ...providers];

  useEffect(() => {
    let cancelled = false;
    setModels(null);
    setModelsError(null);
    api
      .models(provider)
      .then((r) => {
        if (!cancelled) setModels(r.models);
      })
      .catch((err: unknown) => {
        if (!cancelled) setModelsError(friendlyError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const submit = async (): Promise<void> => {
    if (name.trim() === "") {
      setFormError("Name is required.");
      return;
    }
    if (!followMain && model.trim() === "") {
      setFormError("Pick a model for this persona.");
      return;
    }
    if (lens.trim() === "") {
      setFormError("Lens is required — who the persona is and what it looks for.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await onSave({
        id: initial?.id ?? "",
        name: name.trim(),
        followMain,
        // A main-following persona stores the current main pick as its
        // last explicit one (the starting point if a model is pinned
        // later); it is not what runs.
        provider: followMain ? mainPick.provider : provider,
        model: followMain ? mainPick.model : model,
        lens,
        cardInstruction,
        enabled,
        color: initial?.color ?? "",
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
      <Field label="Name" htmlFor={`${testIdPrefix}-name`}>
        <Input
          id={`${testIdPrefix}-name`}
          data-testid={`${testIdPrefix}-name`}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Performance sceptic"
          style={{ width: 360, maxWidth: "100%" }}
        />
      </Field>
      <Field label="Model source" htmlFor={`${testIdPrefix}-follow-main`}>
        <div className="frow" style={{ gap: 6, alignItems: "center" }}>
          <Checkbox
            id={`${testIdPrefix}-follow-main`}
            testId={`${testIdPrefix}-follow-main`}
            ariaLabel="Use main model"
            checked={followMain}
            onChange={setFollowMain}
          />
          <span className="hint">
            Use main model (currently {mainPick.provider}/{mainPick.model})
          </span>
        </div>
      </Field>
      {followMain ? (
        <p className="hint" style={{ margin: 0 }}>
          Runs on the main model at run time; pin a specific model below by turning this off.
        </p>
      ) : (
        <>
      <Field label="Provider" htmlFor={`${testIdPrefix}-provider`}>
        <Select
          id={`${testIdPrefix}-provider`}
          data-testid={`${testIdPrefix}-provider`}
          value={provider}
          onValueChange={(v) => {
            setProvider(v);
            setModel("");
          }}
          options={providerOptions.map((p) => ({ value: p, label: p }))}
        />
      </Field>
      <Field label="Model" htmlFor={`${testIdPrefix}-model`}>
        {modelsError ? (
          <span className="err" role="alert">
            {modelsError}
          </span>
        ) : models === null ? (
          <span className="hint">Loading models…</span>
        ) : (
          <Select
            id={`${testIdPrefix}-model`}
            data-testid={`${testIdPrefix}-model`}
            value={model}
            onValueChange={setModel}
            options={[
              ...(model === "" ? [{ value: "", label: `Pick a ${provider} model…`, disabled: true }] : []),
              ...models.map((m) => ({ value: m.id, label: modelLabel(m) })),
            ]}
          />
        )}
      </Field>
        </>
      )}
      <Field
        label="Lens"
        htmlFor={`${testIdPrefix}-lens`}
        help="Who the persona is and what it looks for — applied to every task it performs."
        layout="stacked"
      >
        <textarea
          id={`${testIdPrefix}-lens`}
          data-testid={`${testIdPrefix}-lens`}
          className="ui-input"
          style={{ padding: "8px 12px" }}
          rows={4}
          value={lens}
          onChange={(e) => setLens(e.target.value)}
          placeholder="e.g. You are a performance sceptic…"
        />
      </Field>
      <Field
        label="Card instruction (optional)"
        htmlFor={`${testIdPrefix}-card-instruction`}
        help="Overrides the card task's default for this persona. Empty means “write your version”."
        layout="stacked"
      >
        <textarea
          id={`${testIdPrefix}-card-instruction`}
          data-testid={`${testIdPrefix}-card-instruction`}
          className="ui-input"
          style={{ padding: "8px 12px" }}
          rows={3}
          value={cardInstruction}
          onChange={(e) => setCardInstruction(e.target.value)}
          placeholder="e.g. Respond to the card: check its claims…"
        />
      </Field>
      <Field label="Enabled" htmlFor={`${testIdPrefix}-enabled`}>
        <Checkbox
          id={`${testIdPrefix}-enabled`}
          testId={`${testIdPrefix}-enabled`}
          ariaLabel="Enabled"
          checked={enabled}
          onChange={setEnabled}
        />
      </Field>
      {formError ? (
        <p className="err" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="frow" style={{ gap: 6 }}>
        <Button
          type="button"
          variant="primary"
          size="sm"
          data-testid={`${testIdPrefix}-save`}
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
