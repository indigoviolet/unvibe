/**
 * Repositories section (Settings → Repositories): the remembered repos
 * (`owner/name` and local path) plus the add-by-path input and the
 * add-by-URL input. The start page links here
 * (`/settings#repositories`) when there are no repos, and repos are added
 * only here — never on the start page.
 *
 * - Add by URL (#27) is a separate row from add by path (a parallel change
 *   owns a Browse button on the path row; this row stays out of its way).
 *   The input is validated client-side with the shared
 *   `parseGitHubRepoInput` (same verdict as the service) and the clone
 *   runs synchronously with a busy state naming the repo.
 * - Managed clones ("Cloned by Unvibe") are Unvibe's own checkouts:
 *   Remove deletes the clone directory. Path checkouts are only
 *   forgotten — the folder is untouched. Remove is refused (409) while
 *   the repo has reviews, and the service's message surfaces as is.
 */
import { useCallback, useEffect, useState } from "react";
import type { Repo } from "@unvibe/shared";
import { parseGitHubRepoInput } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";

export function RepositoriesSection(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [urlHint, setUrlHint] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState(false);
  const [cloningName, setCloningName] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.repos();
      setRepos(r.repos.filter((x) => x.id !== "demo"));
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setHint("Enter a checkout path first.");
      return;
    }
    setHint(null);
    setAdding(true);
    try {
      const r = await api.addRepo({ path: trimmed });
      setRepos(r.repos.filter((x) => x.id !== "demo"));
      setPath("");
    } catch (err) {
      toast(`Couldn't add that repo: ${friendlyError(err)}`);
    } finally {
      setAdding(false);
    }
  }, [path]);

  const addByUrl = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlHint("Enter a GitHub repo URL or owner/name first.");
      return;
    }
    let ref: { owner: string; name: string };
    try {
      ref = parseGitHubRepoInput(trimmed);
    } catch (err) {
      // Client-side verdict, same parser the service uses — no request.
      setUrlHint((err as Error).message);
      return;
    }
    // The clone is synchronous and can take a while: one add at a time,
    // with the control disabled until it settles.
    if (addingUrl) return;
    setUrlHint(null);
    setAddingUrl(true);
    setCloningName(`${ref.owner}/${ref.name}`);
    try {
      const r = await api.addRepo({ url: trimmed });
      setRepos(r.repos.filter((x) => x.id !== "demo"));
      setUrl("");
    } catch (err) {
      toast(`Couldn't clone that repo: ${friendlyError(err)}`);
    } finally {
      setAddingUrl(false);
      setCloningName(null);
    }
  }, [url, addingUrl]);

  const remove = useCallback(async (repo: Repo) => {
    setRemoving(repo.id);
    try {
      await api.removeRepo(repo.id);
      setRepos((prev) => (prev ? prev.filter((r) => r.id !== repo.id) : prev));
      setConfirmRemove(null);
    } catch (err) {
      toast(`Couldn't remove ${repo.owner}/${repo.name}: ${friendlyError(err)}`);
    } finally {
      setRemoving(null);
    }
  }, []);

  const remembered = (repos ?? []).filter((r) => !r.detected);

  return (
    <section aria-label="Repositories" id="repositories" style={{ scrollMarginTop: 12 }} data-testid="repositories-section">
      <div className="divider">Repositories</div>
      <p className="hint">
        Checkouts you can open reviews from. The start page&apos;s repo selector lists these (plus
        auto-detected checkouts).
      </p>
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t load repos: {error}
        </p>
      ) : null}
      {!repos && !error ? <p className="hint">Loading repos…</p> : null}
      {repos ? (
        remembered.length === 0 ? (
          <p className="hint">No repos yet. Add a checkout by path below.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {remembered.map((r) => (
              <div key={r.id} className="ci" data-testid={`repo-${r.id}`}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>
                    {r.owner}/{r.name}
                  </div>
                  <div className="hint" title={r.localPath}>
                    {r.localPath}
                    {r.managed ? " · Cloned by Unvibe" : ""}
                  </div>
                </div>
                <div className="frow" style={{ gap: 4, alignItems: "center" }}>
                  {confirmRemove === r.id ? (
                    <>
                      <span className="hint">
                        {r.managed
                          ? `Delete the clone at ${r.localPath} from this machine?`
                          : `Forget this repo? ${r.localPath} stays untouched on disk.`}
                      </span>
                      <button
                        className="btn"
                        type="button"
                        disabled={removing === r.id}
                        onClick={() => void remove(r)}
                      >
                        {removing === r.id ? "Removing…" : "Remove"}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        disabled={removing === r.id}
                        onClick={() => setConfirmRemove(null)}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      className="mini"
                      type="button"
                      aria-label={`Remove ${r.owner}/${r.name}`}
                      disabled={removing !== null}
                      onClick={() => setConfirmRemove(r.id)}
                      title={
                        r.managed
                          ? "Remove this repo and delete its clone directory"
                          : "Forget this repo (never touches the checkout folder)"
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : null}
      <div className="frow" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <input
          type="text"
          aria-label="Add a repo by path"
          placeholder="/path/to/checkout"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setHint(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
        />
        <button className="btn" type="button" onClick={() => void add()} disabled={adding}>
          {adding ? "Adding…" : "Add by path"}
        </button>
      </div>
      {hint ? (
        <p className="hint" role="status">
          {hint}
        </p>
      ) : null}
      <div className="frow" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <input
          type="text"
          aria-label="Add a repo by URL"
          placeholder="https://github.com/owner/name or owner/name"
          value={url}
          disabled={addingUrl}
          onChange={(e) => {
            setUrl(e.target.value);
            setUrlHint(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addByUrl();
          }}
          style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
        />
        <button className="btn" type="button" onClick={() => void addByUrl()} disabled={addingUrl}>
          {addingUrl ? `Cloning ${cloningName ?? "repo"}…` : "Clone and add"}
        </button>
      </div>
      {urlHint ? (
        <p className="hint" role="status">
          {urlHint}
        </p>
      ) : null}
    </section>
  );
}
