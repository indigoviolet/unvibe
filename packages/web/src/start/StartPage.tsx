/**
 * Start page (`/`, PRD §4.2): repo picker + per-repo lists.
 *
 * - Repo picker: remembered repos first, detected checkouts (marked
 *   `detected: true` by the service) after, add-by-path. The selection is
 *   remembered in `localStorage`.
 * - For the selected repo: PRs you author (`authoring`), PRs waiting on your
 *   review (`review-requested`), recent branches (`branches`), and reviews
 *   opened before with stale state (`kind: "review"` from `recent`, carrying
 *   `reviewId` so they open directly without a new ingest).
 * - Opening a PR/branch calls `POST /api/reviews` and navigates to
 *   `/review/:id`.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CreateReviewRequest, Repo, RepoChange } from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";

const REPO_KEY = "unvibe.start.repoId";

function changeKey(c: RepoChange, i: number): string {
  return `${c.kind}-${c.reviewId ?? c.prNumber ?? c.branch ?? i}`;
}

export function StartPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(REPO_KEY);
    } catch {
      return null;
    }
  });
  const [authoring, setAuthoring] = useState<RepoChange[]>([]);
  const [requested, setRequested] = useState<RepoChange[]>([]);
  const [branches, setBranches] = useState<RepoChange[]>([]);
  const [previous, setPrevious] = useState<RepoChange[]>([]);
  const [demo, setDemo] = useState<RepoChange[]>([]);
  const [path, setPath] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .repos()
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        setSelectedId((prev) => {
          if (prev && r.repos.some((x) => x.id === prev)) return prev;
          const first = r.repos[0]?.id ?? null;
          return first;
        });
      })
      .catch(() => {
        // Offline service: the page stays empty.
      });
    // Demo entry (repo-less `demo` change): no tokens, same pipeline path.
    api
      .repoChanges("demo")
      .then((r) => {
        if (!cancelled) setDemo(r.changes.filter((c) => c.kind === "demo"));
      })
      .catch(() => {
        // Demo unavailable: the section stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      if (selectedId) localStorage.setItem(REPO_KEY, selectedId);
    } catch {
      // Ignore.
    }
    if (!selectedId) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [a, r, rec] = await Promise.all([
          api.repoChanges(selectedId, "authoring"),
          api.repoChanges(selectedId, "review-requested"),
          api.repoChanges(selectedId, "recent"),
        ]);
        if (cancelled) return;
        setAuthoring(a.changes);
        setRequested(r.changes);
        // `recent` mixes branches and previous reviews; split them here so
        // each section renders from one call (gh failures still leave the
        // git-backed sections intact).
        setBranches(rec.changes.filter((c) => c.kind === "branch"));
        setPrevious(rec.changes.filter((c) => c.kind === "review"));
      } catch {
        // Leave previous lists in place.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const openReview = useCallback(
    async (key: string, body: CreateReviewRequest) => {
      setOpening(key);
      try {
        const snap = await api.createReview(body);
        navigate(`/review/${snap.review.id}`);
      } catch {
        toast("Couldn't open review");
      } finally {
        setOpening(null);
      }
    },
    [navigate],
  );

  const addRepo = useCallback(async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    try {
      const r = await api.addRepo({ path: trimmed });
      setRepos(r.repos);
      const added = r.repos.find((x) => x.localPath === trimmed) ?? r.repos[0];
      if (added) setSelectedId(added.id);
      setPath("");
    } catch {
      toast("Couldn't add repo");
    }
  }, [path]);

  const remembered = repos.filter((r) => !r.detected);
  const detected = repos.filter((r) => r.detected);

  return (
    <div className="app">
      <header className="top">
        <div className="pr">
          <b>Unvibe</b>
        </div>
        <Link className="tbtn" to="/settings">
          Settings
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc">
          <h1 className="title">Open a review</h1>

          {demo.length > 0 ? (
            <>
              <div className="divider">Try the demo</div>
              {demo.map((c, i) => (
                <div key={changeKey(c, i)} className="ci">
                  <button
                    className="cj"
                    type="button"
                    disabled={opening !== null}
                    onClick={() => void openReview(changeKey(c, i), { repoId: "demo" })}
                  >
                    <span className="cw">Demo · no tokens</span>
                    <span className="cx2">{c.title}</span>
                  </button>
                  {opening === changeKey(c, i) ? <span className="hint">Opening…</span> : null}
                </div>
              ))}
            </>
          ) : null}

          <div className="divider">Repositories</div>
          <div className="frow" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <input
              type="text"
              aria-label="Add a repo by path"
              placeholder="/path/to/checkout"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addRepo();
              }}
              style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
            />
            <button className="btn" type="button" onClick={() => void addRepo()}>
              Add by path
            </button>
          </div>
          {repos.length === 0 ? (
            <p className="hint">No repos yet. Add a checkout by path, or start the service to detect them.</p>
          ) : (
            <>
              {remembered.length > 0 ? (
                <div className="frow" role="group" aria-label="Recent repos" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {remembered.map((r) => (
                    <RepoChip key={r.id} repo={r} selected={r.id === selectedId} onSelect={setSelectedId} />
                  ))}
                </div>
              ) : null}
              {detected.length > 0 ? (
                <>
                  <p className="hint" style={{ margin: "8px 0 4px" }}>
                    Detected checkouts
                  </p>
                  <div className="frow" role="group" aria-label="Detected checkouts" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {detected.map((r) => (
                      <RepoChip key={r.id} repo={r} selected={r.id === selectedId} onSelect={setSelectedId} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}

          {selectedId ? (
            <>
              <ChangeSection
                title="PRs you're authoring"
                changes={authoring}
                opening={opening}
                empty="Nothing found."
                onOpen={(c, i) =>
                  openReview(changeKey(c, i), { repoId: selectedId, pr: c.prNumber, branch: c.branch })
                }
              />
              <ChangeSection
                title="Waiting on your review"
                changes={requested}
                opening={opening}
                empty="Nothing waiting."
                onOpen={(c, i) =>
                  openReview(changeKey(c, i), { repoId: selectedId, pr: c.prNumber, branch: c.branch })
                }
              />
              <ChangeSection
                title="Recent branches"
                changes={branches}
                opening={opening}
                empty="No branches."
                onOpen={(c, i) => openReview(changeKey(c, i), { repoId: selectedId, branch: c.branch })}
              />
            </>
          ) : null}

          <div className="divider">Previous reviews</div>
          {previous.length === 0 ? (
            <p className="hint">Reviews you open will appear here.</p>
          ) : (
            previous.map((r, i) => (
              <div key={changeKey(r, i)} className="ci">
                <button
                  className="cj"
                  type="button"
                  disabled={opening !== null}
                  onClick={() => r.reviewId && navigate(`/review/${r.reviewId}`)}
                >
                  <span className="cw">
                    {r.prNumber ? `#${r.prNumber}` : r.branch} · {r.branch ?? ""}
                  </span>
                  <span className="cx2">{r.title}</span>
                </button>
                {r.stale ? <span className="prtag">new commits · Update</span> : null}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

function RepoChip({
  repo,
  selected,
  onSelect,
}: {
  repo: Repo;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <button
      className="chip"
      type="button"
      aria-pressed={selected}
      title={repo.localPath}
      onClick={() => onSelect(repo.id)}
    >
      {repo.owner}/{repo.name}
    </button>
  );
}

function ChangeSection({
  title,
  changes,
  opening,
  empty,
  onOpen,
}: {
  title: string;
  changes: RepoChange[];
  opening: string | null;
  empty: string;
  onOpen: (c: RepoChange, i: number) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="divider">{title}</div>
      {changes.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        changes.map((c, i) => (
          <div key={changeKey(c, i)} className="ci">
            <button className="cj" type="button" disabled={opening !== null} onClick={() => onOpen(c, i)}>
              <span className="cw">
                {c.kind === "pr" ? `#${c.prNumber} · ${c.branch}` : c.branch}
                {c.author ? ` · ${c.author}` : ""}
              </span>
              <span className="cx2">{c.title}</span>
            </button>
            {opening === changeKey(c, i) ? <span className="hint">Opening…</span> : null}
          </div>
        ))
      )}
    </>
  );
}
