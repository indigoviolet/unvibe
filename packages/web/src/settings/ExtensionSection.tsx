/**
 * Settings → Extension (#322 part 2): active repos for the side panel,
 * the panel model, and install help (folder shipped in the package,
 * Show folder / Copy path, three steps, connected status, reload note).
 */
import { useEffect, useState } from "react";
import type { ExtensionStatusResponse, ModelInfo, Repo, Settings } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { STATIC_DEMO } from "../demo.js";
import { Button, Card, Checkbox, Field, Select } from "../ui/index.js";
import { modelLabel } from "./ModelsSection.js";

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function ExtensionSection({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [status, setStatus] = useState<ExtensionStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [providers, setProviders] = useState<string[]>(["claude", "codex", "pi"]);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const pick = settings.extensionModel;
  // Effective active set: explicit choice, else 3 most recent (repos list is most-recent first).
  const known = (repos ?? []).filter((r) => r.id !== "demo" && r.localPath);
  const activeIds = settings.extensionActiveRepoIds ?? known.slice(0, 3).map((r) => r.id);

  useEffect(() => {
    let dead = false;
    api.repos().then((r) => { if (!dead) setRepos(r.repos); }).catch((e: unknown) => { if (!dead) setError(friendlyError(e)); });
    api.extensionStatus().then((s) => { if (!dead) setStatus(s); }).catch(() => {});
    api.providers().then((r) => { if (!dead && r.providers.length) setProviders(r.providers); }).catch(() => {});
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    let dead = false;
    setModels(null);
    api.models(pick.provider).then((r) => { if (!dead) setModels(r.models); }).catch(() => { if (!dead) setModels([]); });
    return () => { dead = true; };
  }, [pick.provider]);

  const toggleRepo = async (id: string, on: boolean) => {
    const next = on ? [...activeIds, id] : activeIds.filter((x) => x !== id);
    try { onSaved(await api.saveSettings({ extensionActiveRepoIds: next })); } catch (e) { setError(friendlyError(e)); }
  };
  const saveModel = async (patch: Partial<Settings["extensionModel"]>) => {
    try { onSaved(await api.saveSettings({ extensionModel: { ...pick, ...patch } })); } catch (e) { setError(friendlyError(e)); }
  };
  const doCopy = async (label: string, text: string) => { setCopied((await copyText(text)) ? label : null); };

  return (
    <section aria-label="Extension" id="extension" style={{ scrollMarginTop: 12 }}>
      <Card>
        <p className="hint" data-testid="extension-status" role="status">
          {status === null ? "Checking extension…" : status.connected ? "Extension connected" : "Extension not installed"}
          {status?.lastWorkerCallAt ? ` · last call ${new Date(status.lastWorkerCallAt).toLocaleTimeString()}` : ""}
        </p>
        <div>
          <p><b>Extension folder</b></p>
          <p className="hint">Ships inside the installed Unvibe package, so it matches the running version.</p>
          {STATIC_DEMO ? (
            // No local install on the static demo site: the folder path and
            // its actions are meaningless here, while the install steps
            // below still apply once Unvibe is installed.
            <p className="hint">Install Unvibe to see the extension folder path here.</p>
          ) : (
            <>
              <p><code data-testid="extension-path" style={{ wordBreak: "break-all" }}>{status?.extensionPath ?? "…"}</code></p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Button type="button" data-testid="extension-show-folder" onClick={() => { void api.extensionOpenFolder().catch((e: unknown) => setError(friendlyError(e))); }}>Show extension folder</Button>
                <Button type="button" data-testid="extension-copy-path" onClick={() => void doCopy("path", status?.extensionPath ?? "")}>Copy path</Button>
                {copied === "path" ? <span className="hint">Copied</span> : null}
              </div>
            </>
          )}
        </div>
        <div data-testid="extension-steps">
          <p>Install in Chrome (no Web Store listing):</p>
          <ol>
            <li>Open <code>chrome://extensions</code> <Button type="button" size="sm" data-testid="extension-copy-chrome-url" onClick={() => void doCopy("url", "chrome://extensions")}>Copy</Button>{copied === "url" ? <span className="hint"> Copied</span> : null}</li>
            <li>Turn on Developer mode.</li>
            <li>Choose Load unpacked and pick the extension folder above.</li>
          </ol>
          <p className="hint">After an Unvibe update, reload the extension on <code>chrome://extensions</code> if needed — it loads from the same folder.</p>
        </div>
      </Card>
      <Card>
        <p><b>Active repos</b></p>
        <p className="hint">The side panel can read only these repos. Default: the 3 most recently reviewed.</p>
        {error ? <p className="err" role="alert">{error}</p> : null}
        {repos === null ? <p className="hint">Loading repos…</p> : known.length === 0 ? <p className="hint">No repos yet. Add one in Repos.</p> : known.map((r) => (
          <Field key={r.id} label={`${r.owner}/${r.name}`}>
            <Checkbox testId={`extension-repo-${r.id}`} ariaLabel={`${r.owner}/${r.name}`} checked={activeIds.includes(r.id)} onChange={(v) => void toggleRepo(r.id, v)} />
          </Field>
        ))}
      </Card>
      <Card>
        <p><b>Panel model</b></p>
        <Field label="Provider" htmlFor="ext-prov">
          <Select id="ext-prov" value={pick.provider} onValueChange={(v) => void saveModel({ provider: v })}
            options={[...(providers.includes(pick.provider) ? [] : [pick.provider]), ...providers].map((p) => ({ value: p, label: p }))} />
        </Field>
        <Field label="Model" htmlFor="ext-model">
          {models === null ? <span className="hint">Loading models…</span> : (
            <Select id="ext-model" value={pick.model} onValueChange={(v) => void saveModel({ model: v })}
              options={[...(models.some((m) => m.id === pick.model) ? [] : [{ value: pick.model, label: `${pick.model} (current)` }]), ...models.map((m) => ({ value: m.id, label: modelLabel(m) }))]} />
          )}
        </Field>
      </Card>
    </section>
  );
}
