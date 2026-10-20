/**
 * Repositories section (Settings → Repositories): the remembered repos
 * (`owner/name` and local path) plus the add-by-path input and the
 * add-by-URL input. The start page links here
 * (`/settings?tab=repositories`) when there are no repos, and repos are added
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
 *   the repo has reviews, and refused/failed removes stay visible as an
 *   inline error on that repo's row (not just a transient toast), until
 *   the user keeps the repo or retries. A failed clone likewise shows
 *   the service's message inline under the URL row, since it names the
 *   fix (e.g. `gh auth login`).
 */
import { useCallback, useEffect, useState } from "react";
import type { Repo } from "@unvibe/shared";
import { parseGitHubRepoInput } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";
import { BrowseFolderButton } from "./BrowseFolderButton.js";
import { Button } from "../ui/index.js";

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
  // Inline errors that must outlive a toast: a refused/failed remove stays
  // on its repo's row; a failed clone stays under the URL row.
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

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
      setHint("Enter a folder path first.");
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
    setUrlError(null);
    setAddingUrl(true);
    setCloningName(`${ref.owner}/${ref.name}`);
    try {
      const r = await api.addRepo({ url: trimmed });
      setRepos(r.repos.filter((x) => x.id !== "demo"));
      setUrl("");
    } catch (err) {
      setUrlError(`Couldn't clone that repo: ${friendlyError(err)}`);
    } finally {
      setAddingUrl(false);
      setCloningName(null);
    }
  }, [url, addingUrl]);

  const remove = useCallback(async (repo: Repo) => {
    setRemoving(repo.id);
    setRemoveError(null);
    try {
      await api.removeRepo(repo.id);
      setRepos((prev) => (prev ? prev.filter((r) => r.id !== repo.id) : prev));
      setConfirmRemove(null);
    } catch (err) {
      // Stay on the confirm row with the reason inline: the user either
      // retries or keeps the repo.
      setRemoveError(`Couldn't remove ${repo.owner}/${repo.name}: ${friendlyError(err)}`);
    } finally {
      setRemoving(null);
    }
  }, []);

  const remembered = (repos ?? []).filter((r) => !r.detected);

  return (
    <section aria-label="Repos" id="repositories" style={{ scrollMarginTop: 12 }} data-testid="repositories-section">
      <p className="hint">
        Repos you can open reviews from. The start page lists these, plus any it finds on this machine.
      </p>
      {error ? (
        <p className="err" role="alert">
          Couldn&apos;t load repos: {error}
        </p>
      ) : null}
      {!repos && !error ? <p className="hint">Loading repos…</p> : null}
      {repos ? (
        remembered.length === 0 ? (
          <p className="hint">No repos yet. Add one below by folder path or GitHub URL.</p>
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
                          : `Remove this repo from the list? ${r.localPath} is not touched.`}
                      </span>
                      {removeError && confirmRemove === r.id ? (
                        <span className="err" role="alert">
                          {removeError}
                        </span>
                      ) : null}
                      <button
                        className="ui-btn" data-variant="primary"
                        type="button"
                        disabled={removing === r.id}
                        onClick={() => void remove(r)}
                      >
                        {removing === r.id ? "Removing…" : "Remove"}
                      </button>
                      <button
                        className="ui-btn" data-variant="secondary"
                        type="button"
                        disabled={removing === r.id}
                        onClick={() => {
                          setConfirmRemove(null);
                          setRemoveError(null);
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="ui-btn" data-variant="quiet" data-size="sm"
                      type="button"
                      aria-label={`Remove ${r.owner}/${r.name}`}
                      disabled={removing !== null}
                      onClick={() => {
                        setConfirmRemove(r.id);
                        setRemoveError(null);
                      }}
                      title={
                        r.managed
                          ? "Remove this repo and delete Unvibe's clone of it"
                          : "Remove this repo from the list (your folder is not touched)"
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
          placeholder="/path/to/repo"
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
        <Button variant="primary" type="button" onClick={() => void add()} disabled={adding}>
          {adding ? "Adding…" : "Add by path"}
        </Button>
        <BrowseFolderButton
          onPick={(picked) => {
            setPath(picked);
            setHint(null);
          }}
        />
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
            setUrlError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addByUrl();
          }}
          style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
        />
        <Button variant="primary" type="button" onClick={() => void addByUrl()} disabled={addingUrl}>
          {addingUrl ? `Cloning ${cloningName ?? "repo"}…` : "Clone and add"}
        </Button>
      </div>
      {urlHint ? (
        <p className="hint" role="status">
          {urlHint}
        </p>
      ) : null}
      {urlError ? (
        <p className="err" role="alert">
          {urlError}
        </p>
      ) : null}
    </section>
  );
}
