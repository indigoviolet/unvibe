/**
 * Start page (`/`, PRD §4.2): everything follows one chosen repo.
 *
 * - A repo selector sits in the top bar next to the "Unvibe" brand, listing
 *   remembered repos and detected checkouts (grouped so detected ones are
 *   distinguishable; `owner/name` with the local path as the title).
 *   Selection persists in `localStorage` (`unvibe.start.repoId`); the `demo`
 *   pseudo-repo is never selectable.
 * - The Reviews list shows only the selected repo's reviews (filtered on
 *   `ReviewSummary.repoId`, which the service populates from the review
 *   row). The demo is a row inside the Reviews list ("Demo · no tokens",
 *   opening with `{ repoId: "demo" }`), shown regardless of the selected
 *   repo; when a demo review already exists as a session, that session row
 *   shows instead of a second demo entry.
 * - The PR / branch lists and "Open a PR by URL or number" are scoped to
 *   the selected repo. A pasted PR URL for a different known repo still
 *   works: it opens the review and switches the selector to that repo.
 *   While a newly selected repo's lists load, the previous repo's lists
 *   are hidden (a loading hint shows instead of stale data).
 * - With no repos at all, a short empty state links to Settings
 *   (`/settings#repositories`), where repos are added; the demo row still
 *   shows. Repos are never added here.
 * - Readiness callouts fill in after render (never block page load); each
 *   links to the relevant Settings section. The agent/gh hints sit next to
 *   the lists they concern (`newreview-agent-hint` by Reviews,
 *   `newreview-gh-hint` by the PR lists).
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  CreateReviewRequest,
  ReadinessCheck,
  Repo,
  RepoChange,
  ReviewSummary,
} from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
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

/** Plain-words guide state for a prior review row (no job-kind jargon). */
function guideLabel(s: ReviewSummary): string {
  switch (s.guideStatus) {
    case "ready":
      return "Guide ready";
    case "running":
      return runningLabel(s.guideDetail);
    case "error":
      return "Guide didn't finish";
    case "disabled":
      return "Guide off";
    default:
      return "Guide not started";
  }
}

/** Map the service's "Running: <job kinds>" detail to one short line. */
function runningLabel(detail: string | undefined): string {
  const kinds = (detail ?? "").replace(/^Running:\s*/i, "").split(",").map((k) => k.trim().toLowerCase());
  const first = kinds.find((k) => k !== "");
  switch (first) {
    case "reader":
      return "Reading the change…";
    case "base":
      return "Preparing shared context…";
    case "critic":
      return "Checking findings…";
    case "concept":
      return "Writing concepts…";
    case "hunk-pass":
      return "Summarizing code…";
    case "go-deeper":
      return "Filling deeper cards…";
    case "explain":
      return "Writing an explanation…";
    case "ask":
      return "Answering a question…";
    case "depth":
      return "Rewriting depth…";
    case "examples":
      return "Adding examples…";
    case "diagram":
      return "Drawing a diagram…";
    case "second-opinion":
      return "Getting a second opinion…";
    case "update-pass":
      return "Updating for new commits…";
    case "summarize":
      return "Summarizing…";
    default:
      return "Working…";
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
    if (!selectedId) return { error: "Add a repo in Settings first, then enter its PR number." };
    return { repoId: selectedId, pr: Number(num[1]) };
  }
  const url = input.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/pull\/(\d+)/i);
  if (url) {
    const [, owner, name, n] = url;
    const found = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!found) return { error: `Repo ${owner}/${name} isn't in your list — add it in Settings.` };
    return { repoId: found.id, pr: Number(n) };
  }
  const short = input.match(/^([^/\s]+)\/([^/\s#]+)#(\d+)$/);
  if (short) {
    const [, owner, name, n] = short;
    const found = repos.find(
      (r) => r.owner.toLowerCase() === owner.toLowerCase() && r.name.toLowerCase() === name.toLowerCase(),
    );
    if (!found) return { error: `Repo ${owner}/${name} isn't in your list — add it in Settings.` };
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
  // The repo the PR/branch lists below were loaded for. While a newly
  // selected repo loads, its lists stay hidden instead of showing the
  // previous repo's data.
  const [listsFor, setListsFor] = useState<string | null>(null);
  const [demo, setDemo] = useState<RepoChange[]>([]);
  const [opening, setOpening] = useState<string | null>(null);

  // Prior sessions (front-screen list, filtered to the selected repo below).
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

  const loadSessions = useCallback(async () => {
    try {
      const r = await api.reviews();
      setSessions(r.reviews);
      setSessionsError(null);
    } catch {
      setSessionsError("Couldn't load previous reviews.");
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
          // Never auto-select the demo pseudo-repo: the lists below only
          // make sense for a real checkout.
          return r.repos.find((x) => x.id !== "demo")?.id ?? null;
        });
      })
      .catch(() => {
        // Offline service: the page stays empty.
      });
    // Demo entry (repo-less `demo` change): no tokens, same pipeline path.
    // It renders as a row inside the Reviews list (see below).
    api
      .repoChanges("demo")
      .then((r) => {
        if (!cancelled) setDemo(r.changes.filter((c) => c.kind === "demo"));
      })
      .catch(() => {
        // Demo unavailable: the entry stays hidden.
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
        // (prior sessions come from GET /api/reviews, filtered per repo).
        setBranches(rec.changes.filter((c) => c.kind === "branch"));
        setListsFor(selectedId);
      } catch {
        // Leave the loading hint in place (listsFor stays behind).
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
      } catch (err) {
        toast(`Couldn't open the review: ${friendlyError(err)}`);
      } finally {
        setOpening(null);
      }
    },
    [navigate, loadSessions],
  );

  const removeSession = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await api.deleteReview(id);
        setSessions((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
        setConfirmDelete(null);
      } catch (err) {
        toast(`Couldn't remove the review: ${friendlyError(err)}`);
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
    } catch (err) {
      toast(`Couldn't re-check: ${friendlyError(err)}`);
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
    // A pasted URL for a different known repo opens that repo's PR and
    // switches the selector to it.
    if (parsed.repoId !== selectedId) setSelectedId(parsed.repoId);
    void openReview(`pr-${parsed.pr}`, { repoId: parsed.repoId, pr: parsed.pr });
  }, [prInput, repos, selectedId, openReview]);

  // The demo pseudo-repo is never selectable; detected checkouts group
  // separately so they read as auto-found rather than remembered.
  const remembered = repos.filter((r) => !r.detected && r.id !== "demo");
  const detected = repos.filter((r) => r.detected && r.id !== "demo");
  const realRepos = repos.filter((r) => r.id !== "demo");
  const selected = realRepos.find((r) => r.id === selectedId) ?? null;
  const problems = (readiness ?? []).filter((c) => c.status !== "ok");
  const ghProblem = problems.find((c) => c.id === "gh");
  const mainProblem = problems.find((c) => c.id === "agent:main");
  const allReady = readiness !== null && problems.length === 0;

  // Reviews for the selected repo only (`ReviewSummary.repoId` comes from
  // the service's review row, so this stays correct for remembered and
  // detected repos alike). Demo sessions (`repoId: "demo"`) never match a
  // real selection; they render as the demo row instead (no duplicates).
  const visibleSessions = (sessions ?? []).filter((s) => s.repoId === selectedId);
  const demoSessions = (sessions ?? []).filter((s) => s.repoId === "demo");
  const showDemoEntry = demoSessions.length === 0 && demo.length > 0;

  return (
    <div className="app">
      <header className="top">
        <div className="pr">
          <Link className="brand" to="/">
            Unvibe
          </Link>
          {realRepos.length > 0 && selectedId ? (
            <select
              aria-label="Repository"
              className="tbtn"
              value={selectedId}
              title={selected?.localPath ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {remembered.length > 0 ? (
                <optgroup label="Repos">
                  {remembered.map((r) => (
                    <option key={r.id} value={r.id} title={r.localPath}>
                      {r.owner}/{r.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {detected.length > 0 ? (
                <optgroup label="Detected checkouts">
                  {detected.map((r) => (
                    <option key={r.id} value={r.id} title={r.localPath}>
                      {r.owner}/{r.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : null}
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
                    <Link className="tbtn" to="/doctor">
                      Doctor
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

          {/* Reviews for the selected repo, then the demo row. */}
          <div className="eyebrow">Unvibe</div>
          <h1 className="title">Reviews</h1>
          {mainProblem ? (
            <p className="hint" data-testid="newreview-agent-hint">
              Main agent not ready ({mainProblem.summary}) — the guide may not generate. You can
              still open the diff and comment.
            </p>
          ) : null}
          {sessions === null && !sessionsError ? (
            <p className="hint">Loading previous reviews…</p>
          ) : sessionsError ? (
            <p className="hint" role="alert">
              {sessionsError}
            </p>
          ) : (
            <div aria-label="Prior reviews" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {visibleSessions.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  opening={opening}
                  deleting={deleting}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                  removeSession={removeSession}
                  onOpen={() => navigate(`/review/${s.id}`)}
                />
              ))}
              {demoSessions.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  opening={opening}
                  deleting={deleting}
                  confirmDelete={confirmDelete}
                  setConfirmDelete={setConfirmDelete}
                  removeSession={removeSession}
                  onOpen={() => navigate(`/review/${s.id}`)}
                />
              ))}
              {visibleSessions.length === 0 && demoSessions.length === 0 ? (
                <p className="hint" data-testid="sessions-empty">
                  {realRepos.length === 0 ? (
                    <>
                      No reviews yet. <Link to="/settings#repositories">Add a repo in Settings</Link>{" "}
                      to open your first review — or try the demo below.
                    </>
                  ) : (
                    <>
                      No reviews for {selected ? `${selected.owner}/${selected.name}` : "this repo"}{" "}
                      yet. Open a PR or branch below to start one.
                    </>
                  )}
                </p>
              ) : null}
              {showDemoEntry
                ? demo.map((c, i) => (
                    <div key={changeKey(c, i)} className="ci" data-testid="demo-entry">
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
                  ))
                : null}
            </div>
          )}

          {/* PRs and branches for the selected repo. */}
          {realRepos.length === 0 ? (
            <div data-testid="no-repos">
              <div className="divider">Repositories</div>
              <p className="hint">
                No repos yet. <Link to="/settings#repositories">Add one in Settings</Link> to browse
                its PRs and branches.
              </p>
            </div>
          ) : !selectedId ? (
            <p className="hint">Pick a repo above to browse its PRs and branches.</p>
          ) : listsFor !== selectedId ? (
            <p className="hint" data-testid="repo-lists-loading">
              Loading {selected ? `${selected.owner}/${selected.name}` : "repo"}…
            </p>
          ) : (
            <>
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
          )}
        </div>
      </main>
    </div>
  );
}

function SessionRow({
  s,
  opening,
  deleting,
  confirmDelete,
  setConfirmDelete,
  removeSession,
  onOpen,
}: {
  s: ReviewSummary;
  opening: string | null;
  deleting: string | null;
  confirmDelete: string | null;
  setConfirmDelete: (id: string | null) => void;
  removeSession: (id: string) => Promise<void>;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <div key={s.id} className="ci" data-testid={`session-${s.id}`}>
      <button
        className="cj"
        type="button"
        disabled={opening !== null || deleting !== null}
        onClick={onOpen}
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
