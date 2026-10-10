/**
 * Start page (`/`, PRD §4.2): prior sessions first, then a New-review flow.
 *
 * - Prior sessions: `GET /api/reviews` across ALL repos, most recent first,
 *   with title, repo, PR/branch, last opened, version count, stale state,
 *   progress (hunks reviewed/total, pending comments) and guide status.
 *   Click resumes; Remove (with confirm) deletes local data only.
 * - New review (primary action): the existing picker flow (recent, detected,
 *   add by path → authoring / review-requested / branches, PR by URL or
 *   number, demo). Selections remembered in `localStorage`.
 * - Readiness callouts fill in after render (never block page load); each
 *   links to the relevant Settings section.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  CreateReviewRequest,
  ReadinessCheck,
  Repo,
  RepoChange,
  ReviewSummary,
} from "@unvibe/shared";
import { api } from "../api/client.js";
import { toast } from "../floating/Toast.js";

const REPO_KEY = "unvibe.start.repoId";

function changeKey(c: RepoChange, i: number): string {
  return `${c.kind}-${c.reviewId ?? c.prNumber ?? c.branch ?? i}`;
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)}h ago`;
  if (d < 86400_000 * 30) return `${Math.floor(d / 86400_000)}d ago`;
  try {
    return new Date(ts).toLocaleDateString();
  } catch {
    return "";
  }
}

function guideLabel(s: ReviewSummary): string {
  switch (s.guideStatus) {
    case "ready":
      return "Guide ready";
    case "running":
      return s.guideDetail ?? "Guide running";
    case "error":
      return s.guideDetail ? `Guide error · ${s.guideDetail}` : "Guide error";
    case "disabled":
      return "Guide disabled";
    default:
      return "Guide not started";
  }
}

/** Parse "123" / "#123" / PR URL / "owner/repo#123" into { repoId, pr }. */
function parsePrInput(
  raw: string,
  repos: Repo[],
  selectedId: string | null,
): { repoId: string; pr: number } | { error: string } {
  const input = raw.trim();
  if (!input) return { error: "Enter a PR number or URL." };
  const num = input.match(/^#?(\d+)$/);
  if (num) {
    if (!selectedId) return { error: "Pick a repo first, then enter its PR number." };
    return { repoId: selectedId, pr: Number(num[1]) };
  }
  const url = input.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/pull\/(\d+)/i);
  if (url) {
    const [, owner, name, n] = url;
    const found = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!found) return { error: `Repo ${owner}/${name} isn't in your list — add it by path first.` };
    return { repoId: found.id, pr: Number(n) };
  }
  const short = input.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/);
  if (short) {
    const [, owner, name, n] = short;
    const found = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!found) return { error: `Repo ${owner}/${name} isn't in your list — add it by path first.` };
    return { repoId: found.id, pr: Number(n) };
  }
  return { error: "Enter a PR number (e.g. 5020) or a GitHub PR URL." };
}

export function StartPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(REPO_KEY);
      // The demo pseudo-repo is never a selection (an old build stored it).
      return saved && saved !== "demo" ? saved : null;
    } catch {
      return null;
    }
  });
  const [authoring, setAuthoring] = useState<RepoChange[]>([]);
  const [requested, setRequested] = useState<RepoChange[]>([]);
  const [branches, setBranches] = useState<RepoChange[]>([]);
  const [demo, setDemo] = useState<RepoChange[]>([]);
  const [path, setPath] = useState("");
  const [opening, setOpening] = useState<string | null>(null);

  // Prior sessions (front-screen list).
  const [sessions, setSessions] = useState<ReviewSummary[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // PR by URL / number.
  const [prInput, setPrInput] = useState("");
  const [prError, setPrError] = useState<string | null>(null);

  // Readiness (fills in after render; never blocks).
  const [readiness, setReadiness] = useState<ReadinessCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const newReviewRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const r = await api.reviews();
      setSessions(r.reviews);
      setSessionsError(null);
    } catch {
      setSessionsError("Couldn't load prior sessions.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .repos()
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        setSelectedId((prev) => {
          if (prev && prev !== "demo" && r.repos.some((x) => x.id === prev)) return prev;
          // Never auto-select the demo pseudo-repo: PR sections below only
          // make sense for a real checkout.
          return r.repos.find((x) => x.id !== "demo")?.id ?? null;
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
    void loadSessions();
    // Readiness fills in after first paint (never blocks page load).
    api
      .readiness()
      .then((r) => {
        if (!cancelled) setReadiness(r.checks);
      })
      .catch(() => {
        if (!cancelled) setReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

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
        // `recent` mixes branches and previous reviews; branches only here
        // (prior sessions come from GET /api/reviews across all repos).
        setBranches(rec.changes.filter((c) => c.kind === "branch"));
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
        await loadSessions();
        navigate(`/review/${snap.review.id}`);
      } catch {
        toast("Couldn't open review");
      } finally {
        setOpening(null);
      }
    },
    [navigate, loadSessions],
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

  const removeSession = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await api.deleteReview(id);
        setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        setConfirmDelete(null);
      } catch {
        toast("Couldn't remove review");
      } finally {
        setDeleting(null);
      }
    },
    [],
  );

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const r = await api.readiness(true);
      setReadiness(r.checks);
    } catch {
      toast("Couldn't re-check");
    } finally {
      setChecking(false);
    }
  }, []);

  const openPrInput = useCallback(() => {
    const parsed = parsePrInput(prInput, repos, selectedId);
    if ("error" in parsed) {
      setPrError(parsed.error);
      return;
    }
    setPrError(null);
    void openReview(`pr-${parsed.pr}`, { repoId: parsed.repoId, pr: parsed.pr });
  }, [prInput, repos, selectedId, openReview]);

  const scrollToNew = useCallback(() => {
    newReviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const remembered = repos.filter((r) => !r.detected && r.id !== "demo");
  const detected = repos.filter((r) => r.detected && r.id !== "demo");
  const problems = (readiness ?? []).filter((c) => c.status !== "ok");
  const ghProblem = problems.find((c) => c.id === "gh");
  const mainProblem = problems.find((c) => c.id === "agent:main");
  const allReady = readiness !== null && problems.length === 0;

  return (
    <div className="app">
      <header className="top">
        <div className="pr">
          <Link className="brand" to="/">
            Unvibe
          </Link>
          {allReady ? (
            <span className="hint" data-testid="readiness-ready">
              Ready · gh + agents ok
            </span>
          ) : null}
        </div>
        <Link className="tbtn" to="/settings">
          Settings
        </Link>
      </header>
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 760 }}>
          {/* Readiness callouts: one compact row per problem, each linking
              to the relevant Settings section. Nothing when all is well
              (apart from the small ready indicator above). */}
          {problems.length > 0 ? (
            <div aria-label="Environment problems" style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
              {problems.map((c) => (
                <div
                  key={c.id}
                  className="ci"
                  data-testid={`readiness-callout-${c.id}`}
                  style={{ border: "1px solid var(--line)", alignItems: "center" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      <b>{c.label}:</b> {c.summary}
                    </div>
                    {c.fix ? <div className="hint">{c.fix}</div> : null}
                  </div>
                  <div className="frow" style={{ gap: 6 }}>
                    <Link className="tbtn" to={`/settings${c.settingsAnchor ?? "#environment"}`}>
                      Settings
                    </Link>
                  </div>
                </div>
              ))}
              <div>
                <button className="mini" type="button" onClick={() => void recheck()} disabled={checking}>
                  {checking ? "Checking…" : "Re-check"}
                </button>
              </div>
            </div>
          ) : null}

          {/* Prior sessions first. */}
          <div className="eyebrow">Unvibe</div>
          <h1 className="title">Reviews</h1>
          {sessions === null && !sessionsError ? (
            <p className="hint">Loading prior sessions…</p>
          ) : sessionsError ? (
            <p className="hint" role="alert">
              {sessionsError}
            </p>
          ) : sessions!.length === 0 ? (
            <div data-testid="sessions-empty">
              <p className="hint" style={{ fontSize: 13, color: "var(--ink)" }}>
                Unvibe reads a branch or pull request with an agent alongside, keeping
                explanations tied to the code.
              </p>
              <p className="hint">
                Open your first review below — pick a repo, a PR or a branch, or try the demo.
              </p>
              <button className="btn" type="button" onClick={scrollToNew}>
                New review
              </button>
            </div>
          ) : (
            <div aria-label="Prior sessions" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {sessions!.map((s) => (
                <div key={s.id} className="ci" data-testid={`session-${s.id}`}>
                  <button
                    className="cj"
                    type="button"
                    disabled={opening !== null || deleting !== null}
                    onClick={() => navigate(`/review/${s.id}`)}
                    title={`${s.title} (${s.branch})`}
                  >
                    <span className="cw">
                      {s.repoOwner}/{s.repoName} · {s.prNumber ? `#${s.prNumber}` : s.branch}
                      {s.currentVersion > 1 ? ` · v${s.currentVersion}` : ""}
                      {" · "}
                      {timeAgo(s.lastOpened)}
                    </span>
                    <span className="cx2">{s.title}</span>
                    <span className="hint">
                      {s.reviewedHunks}/{s.totalHunks} hunks reviewed
                      {s.pendingComments > 0 ? ` · ${s.pendingComments} pending` : ""}
                      {" · "}
                      {guideLabel(s)}
                    </span>
                  </button>
                  <div className="frow" style={{ gap: 4, alignItems: "center" }}>
                    {s.stale ? <span className="prtag">new commits · Update</span> : null}
                    {confirmDelete === s.id ? (
                      <>
                        <span className="hint">Remove local data only?</span>
                        <button
                          className="btn"
                          type="button"
                          disabled={deleting === s.id}
                          onClick={() => void removeSession(s.id)}
                        >
                          {deleting === s.id ? "Removing…" : "Remove"}
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={deleting === s.id}
                          onClick={() => setConfirmDelete(null)}
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        className="mini"
                        type="button"
                        aria-label={`Remove ${s.title}`}
                        disabled={deleting !== null}
                        onClick={() => setConfirmDelete(s.id)}
                        title="Remove this review's local data (never touches GitHub or your checkout; deletes the managed worktree)"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* New review: the existing picker flow, led by an obvious primary action. */}
          <div ref={newReviewRef} id="new-review" style={{ scrollMarginTop: 12 }}>
            <div className="divider">New review</div>
            {mainProblem ? (
              <p className="hint" data-testid="newreview-agent-hint">
                Main agent not ready ({mainProblem.summary}) — the guide may not generate. You can
                still open the diff and comment.
              </p>
            ) : null}

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
              <p className="hint">No repos yet. Add a checkout by path.</p>
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

            <div className="divider">Open a PR by URL or number</div>
            <div className="frow" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <input
                type="text"
                aria-label="Open a PR by URL or number"
                placeholder="PR number (5020) or owner/repo pull URL"
                value={prInput}
                onChange={(e) => {
                  setPrInput(e.target.value);
                  setPrError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openPrInput();
                }}
                style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
              />
              <button className="btn" type="button" onClick={openPrInput} disabled={opening !== null}>
                Open PR
              </button>
            </div>
            {prError ? (
              <p className="hint" role="alert">
                {prError}
              </p>
            ) : null}
            {ghProblem ? (
              <p className="hint" data-testid="newreview-gh-hint">
                PR lists need gh ({ghProblem.summary}). You can still open a local branch below or a
                PR by number once gh works.
              </p>
            ) : null}

            {selectedId && selectedId !== "demo" ? (
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
          </div>
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
