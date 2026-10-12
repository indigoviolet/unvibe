/**
 * Repositories section (Settings → Repositories): the remembered repos
 * (`owner/name` and local path) plus the add-by-path input. The start page
 * links here (`/settings#repositories`) when there are no repos, and repos
 * are added only here — never on the start page.
 *
 * There is no remove-repo endpoint on the service, so this section offers
 * no Remove action.
 */
import { useCallback, useEffect, useState } from "react";
import type { Repo } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { toast } from "../floating/Toast.js";

export function RepositoriesSection(): React.JSX.Element {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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
                  </div>
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
    </section>
  );
}
