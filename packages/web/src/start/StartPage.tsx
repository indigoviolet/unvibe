/**
 * Start page (`/`, PRD §4.2): repo picker + per-repo lists.
 *
 * - Repo picker remembers recent repos, shows detected checkouts, and adds
 *   by path. The selection is remembered in `localStorage`.
 * - For the selected repo: PRs you author (`authoring`), PRs waiting on your
 *   review (`review-requested`), recent branches (`branches`), and reviews
 *   opened before with unread/stale state.
 * - Opening a PR/branch calls `POST /api/reviews` and navigates to
 *   `/review/:id`. In mock mode the previous-reviews list comes from the
 *   mock layer; against the service it is kept locally.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CreateReviewRequest, Repo, RepoChange } from "@unvibe/shared";
import { api } from "../api/client.js";
import type { OpenedReview } from "../mock/index.js";
import { toast } from "../floating/Toast.js";

const REPO_KEY = "unvibe.start.repoId";
const OPENED_KEY = "unvibe.start.openedReviews";
const MOCK = typeof import.meta !== "undefined" && import.meta.env?.VITE_MOCK === "1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function changeKey(c: RepoChange, i: number): string {
  return `${c.kind}-${c.prNumber ?? c.branch ?? i}`;
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
  const [opened, setOpened] = useState<OpenedReview[]>([]);
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
        // Service stubs return 501 until Service M1 lands.
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
        const [a, r, b] = await Promise.all([
          api.repoChanges(selectedId, "authoring"),
          api.repoChanges(selectedId, "review-requested"),
          api.repoChanges(selectedId, "branches"),
        ]);
        if (cancelled) return;
        setAuthoring(a.changes);
        setRequested(r.changes);
        setBranches(b.changes);
      } catch {
        // Leave previous lists in place.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const refreshOpened = useCallback(async () => {
    if (MOCK) {
      try {
        const m = await import("../mock/index.js");
        setOpened(m.getOpenedReviews());
        return;
      } catch {
        // Fall through to the local list.
      }
    }
    setOpened(readJson<OpenedReview[]>(OPENED_KEY, []));
  }, []);

  useEffect(() => {
    void refreshOpened();
  }, [refreshOpened]);

  const recordOpened = useCallback((entry: OpenedReview) => {
    if (MOCK) return; // the mock layer records it in createReview
    try {
      const list = readJson<OpenedReview[]>(OPENED_KEY, []).filter((r) => r.reviewId !== entry.reviewId);
      localStorage.setItem(OPENED_KEY, JSON.stringify([entry, ...list].slice(0, 20)));
    } catch {
      // Ignore.
    }
  }, []);

  const openReview = useCallback(
    async (key: string, body: CreateReviewRequest, title: string) => {
      setOpening(key);
      try {
        const snap = await api.createReview(body);
        recordOpened({
          reviewId: snap.review.id,
          title,
          prNumber: body.pr,
          branch: body.branch,
          stale: false,
          unread: 0,
        });
        await refreshOpened();
        navigate(`/review/${snap.review.id}`);
      } catch {
        toast("Couldn't open review");
      } finally {
        setOpening(null);
      }
    },
    [navigate, recordOpened, refreshOpened],
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

  const recent = [...repos].sort((a, b) => b.lastOpened - a.lastOpened).slice(0, 3);
  const detected = repos.filter((r) => !recent.some((x) => x.id === r.id));

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
              <div className="frow" role="group" aria-label="Recent repos" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {recent.map((r) => (
                  <button
                    key={r.id}
                    className="chip"
                    type="button"
                    aria-pressed={r.id === selectedId}
                    title={r.localPath}
                    onClick={() => setSelectedId(r.id)}
                  >
                    {r.owner}/{r.name}
                  </button>
                ))}
              </div>
              {detected.length > 0 ? (
                <>
                  <p className="hint" style={{ margin: "8px 0 4px" }}>
                    Detected checkouts
                  </p>
                  <div className="frow" role="group" aria-label="Detected checkouts" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {detected.map((r) => (
                      <button
                        key={r.id}
                        className="chip"
                        type="button"
                        aria-pressed={r.id === selectedId}
                        title={r.localPath}
                        onClick={() => setSelectedId(r.id)}
                      >
                        {r.owner}/{r.name}
                      </button>
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
                  openReview(
                    changeKey(c, i),
                    { repoId: selectedId, pr: c.prNumber, branch: c.branch },
                    c.title,
                  )
                }
              />
              <ChangeSection
                title="Waiting on your review"
                changes={requested}
                opening={opening}
                empty="Nothing waiting."
                onOpen={(c, i) =>
                  openReview(
                    changeKey(c, i),
                    { repoId: selectedId, pr: c.prNumber, branch: c.branch },
                    c.title,
                  )
                }
              />
              <ChangeSection
                title="Recent branches"
                changes={branches}
                opening={opening}
                empty="No branches."
                onOpen={(c, i) =>
                  openReview(changeKey(c, i), { repoId: selectedId, branch: c.branch }, c.title)
                }
              />
            </>
          ) : null}

          <div className="divider">Previous reviews</div>
          {opened.length === 0 ? (
            <p className="hint">Reviews you open will appear here.</p>
          ) : (
            opened.map((r) => (
              <div key={r.reviewId} className="ci">
                <button
                  className="cj"
                  type="button"
                  disabled={opening !== null}
                  onClick={() =>
                    openReview(`opened-${r.reviewId}`, { repoId: selectedId ?? "", pr: r.prNumber, branch: r.branch }, r.title)
                  }
                >
                  <span className="cw">
                    {r.prNumber ? `#${r.prNumber}` : r.branch} · {r.branch ?? ""}
                  </span>
                  <span className="cx2">{r.title}</span>
                </button>
                {r.stale ? <span className="prtag">new commits · Update</span> : null}
                {r.unread > 0 ? <span className="hint">{r.unread} unread</span> : null}
              </div>
            ))
          )}
        </div>
      </main>
    </div>
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
