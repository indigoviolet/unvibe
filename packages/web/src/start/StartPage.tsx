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
 *   A pasted PR URL (or `owner/name#N`) for a repo that is NOT in the
 *   list offers to clone it instead of erroring (#27): confirm clones via
 *   `POST /api/repos`, selects the new repo and opens the PR; cancel
 *   leaves the input as typed. Both sides parse with the shared
 *   `parseGitHubRepoInput`, so the page and the service always agree.
 *   The PR input never waits on the lists. List loads are tracked per
 *   selection (loading / loaded / failed): switching repos clears the old
 *   lists synchronously so stale data can never render, a nonce guarantees
 *   the clear is always paired with a fresh load (even re-selecting the
 *   current repo, which still fires `change`), and a 30 s timeout bounds
 *   the loading state so it can never stick forever. A total failure
 *   shows an inline error with a Retry button; a single failed filter
 *   shows its error in that section while the others still render
 *   (the service already degrades gh/git failures to empty per source).
 *   A managed clone that could not be refreshed reports the service's
 *   `fetchError` note once above the lists. Managed clones read
 *   "owner/name (cloned)" in the selector.
 * - Sessions whose repo is in neither the remembered nor the detected
 *   list (a checkout that went away, or repos failing to load) are not
 *   dropped: they render in a labelled group at the end of Reviews with
 *   working open and Remove.
 * - With no repos at all, a short empty state offers both routes in:
 *   paste a PR URL below and Unvibe clones the repo and opens it, or add
  *   a repo in `/settings?tab=repositories` (the demo row still shows). The PR
 *   opener also renders whenever no repo is selected. Repos are never
 *   added via a path here.
 * - Readiness callouts fill in after render (never block page load); each
 *   links to the relevant Settings section. The agent/gh hints sit next to
 *   the lists they concern (`newreview-agent-hint` by Reviews,
 *   `newreview-gh-hint` by the PR lists).
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
import { parseGitHubRepoInput } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Toast, toast } from "../floating/Toast.js";
import { PreviewBuildBadge } from "../shell/PreviewBuildBadge.js";

const REPO_KEY = "unvibe.start.repoId";

/** Upper bound for a lists load: the page must never stick on "Loading…". */
const LISTS_TIMEOUT_MS = 30_000;

/** Per-section list errors: a failed filter shows its error, not "Nothing found.". */
interface ListErrors {
  authoring: string | null;
  requested: string | null;
  branches: string | null;
}

const EMPTY_ERRORS: ListErrors = { authoring: null, requested: null, branches: null };

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

/** Parse "123" / "#123" / PR URL / "owner/repo#123" into a target or an error. */
function parsePrInput(
  raw: string,
  repos: Repo[],
  selectedId: string | null,
): { repoId: string; pr: number } | { offer: { owner: string; name: string; pr: number } } | { error: string } {
  const input = raw.trim();
  if (!input) return { error: "Enter a PR number or URL." };
  const num = input.match(/^#?(\d+)$/);
  if (num) {
    if (!selectedId) return { error: "Add a repo in Settings first, then enter its PR number." };
    return { repoId: selectedId, pr: Number(num[1]) };
  }
  // Repo-scoped forms (a PR URL or `owner/name#N`): the shared parser is
  // the single definition both sides validate against, so the page and
  // the service always agree on what a paste means. A repo that is not in
  // the list becomes a clone offer instead of an error.
  let ref: { owner: string; name: string; prNumber?: number } | null = null;
  try {
    ref = parseGitHubRepoInput(input);
  } catch {
    ref = null;
  }
  if (ref && ref.prNumber !== undefined) {
    const found = repos.find(
      (r) => r.owner.toLowerCase() === ref.owner.toLowerCase() && r.name.toLowerCase() === ref.name.toLowerCase(),
    );
    if (found) return { repoId: found.id, pr: ref.prNumber };
    return { offer: { owner: ref.owner, name: ref.name, pr: ref.prNumber } };
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
  const [listErrors, setListErrors] = useState<ListErrors>(EMPTY_ERRORS);
  // The repo the PR/branch lists below were loaded for (null = none yet or
  // cleared). The render gates on this so a newly selected repo never shows
  // the previous repo's data.
  const [listsFor, setListsFor] = useState<string | null>(null);
  // Whole-load failure (every filter rejected, or the load timed out):
  // inline message + Retry.
  const [listsError, setListsError] = useState<string | null>(null);
  // Bumped on every explicit selection so the load effect re-runs even
  // when the id is unchanged: `selectOption` fires `change` (and
  // `selectRepo` clears) even for the already-selected repo, and without
  // this the effect's id-equality bail-out would leave no load in flight
  // — a permanent "Loading…" with no recovery.
  const [listsNonce, setListsNonce] = useState(0);
  // True once GET /api/repos has resolved (even demo-only).
  const [reposLoaded, setReposLoaded] = useState(false);
  // True when GET /api/repos itself failed (offline service).
  const [reposError, setReposError] = useState(false);
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
  // Clone offer for a pasted PR whose repo is not in the list (#27):
  // confirm clones, selects the repo and opens the PR; cancel keeps the
  // input as typed.
  const [prOffer, setPrOffer] = useState<{ owner: string; name: string; pr: number; input: string } | null>(null);
  const [cloningPr, setCloningPr] = useState<string | null>(null);
  // Stale-clone note from the lists (`fetchError` on RepoChangesResponse):
  // the three calls all carry it, so the first one wins and shows once.
  const [fetchNote, setFetchNote] = useState<string | null>(null);

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

  // Monotonic load id: a superseded selection's late responses are ignored.
  // (A late batch for the CURRENT id still applies: it is fresher than the
  // cleared state and newer than nothing else in flight.)
  const loadSeq = useRef(0);
  const loadLists = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    // Settled, not all-or-nothing: one failing filter must not sink the
    // others (branches are local even when the gh-backed PR lists fail).
    // Raced against a timeout so the page can never stick on "Loading…"
    // forever no matter how the requests stall.
    const settled = await Promise.race([
      Promise.allSettled([
        api.repoChanges(id, "authoring"),
        api.repoChanges(id, "review-requested"),
        api.repoChanges(id, "recent"),
      ]),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), LISTS_TIMEOUT_MS);
      }),
    ]);
    if (loadSeq.current !== seq) return;
    if (settled === null) {
      setListErrors(EMPTY_ERRORS);
      setListsError("the lists request timed out — the service may be busy");
      setListsFor(id);
      return;
    }
    const [a, r, rec] = settled;
    setAuthoring(a.status === "fulfilled" ? a.value.changes : []);
    setRequested(r.status === "fulfilled" ? r.value.changes : []);
    // `recent` mixes branches and previous reviews; branches only here
    // (prior sessions come from GET /api/reviews, filtered per repo).
    setBranches(rec.status === "fulfilled" ? rec.value.changes.filter((c) => c.kind === "branch") : []);
    // A managed clone that could not be refreshed reports the same
    // `fetchError` on every call: show it once, near the lists.
    setFetchNote(
      [a, r, rec].flatMap((x) =>
        x.status === "fulfilled" && x.value.fetchError ? [x.value.fetchError] : [],
      )[0] ?? null,
    );
    setListErrors({
      authoring: a.status === "rejected" ? friendlyError(a.reason) : null,
      requested: r.status === "rejected" ? friendlyError(r.reason) : null,
      branches: rec.status === "rejected" ? friendlyError(rec.reason) : null,
    });
    const rejected = [a, r, rec].filter((x): x is PromiseRejectedResult => x.status === "rejected");
    setListsError(rejected.length === 3 ? friendlyError(rejected[0].reason) : null);
    setListsFor(id);
  }, []);

  /** Select a repo, clearing the old lists synchronously so stale data can
      never render — not even for one frame before the load effect runs.
      The nonce bump guarantees the effect fires a fresh load even when
      the id is unchanged (same-value selection still clears). */
  const selectRepo = useCallback(
    (id: string) => {
      setAuthoring([]);
      setRequested([]);
      setBranches([]);
      setListErrors(EMPTY_ERRORS);
      setListsError(null);
      setFetchNote(null);
      setListsFor(null);
      setSelectedId(id);
      setListsNonce((n) => n + 1);
    },
    [],
  );

  const retryLists = useCallback(() => {
    if (!selectedId) return;
    setListsError(null);
    setFetchNote(null);
    setListsFor(null);
    void loadLists(selectedId);
  }, [selectedId, loadLists]);

  useEffect(() => {
    let cancelled = false;
    api
      .repos()
      .then((r) => {
        if (cancelled) return;
        setRepos(r.repos);
        setReposLoaded(true);
        setSelectedId((prev) => {
          if (prev && prev !== "demo" && r.repos.some((x) => x.id === prev)) return prev;
          // Never auto-select the demo pseudo-repo: the lists below only
          // make sense for a real checkout.
          return r.repos.find((x) => x.id !== "demo")?.id ?? null;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setReposLoaded(true);
        setReposError(true);
        // Offline service: repos stay empty; sessions below still render.
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
    void loadLists(selectedId);
  }, [selectedId, listsNonce, loadLists]);

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
      setPrOffer(null);
      return;
    }
    if ("offer" in parsed) {
      setPrError(null);
      setPrOffer({ ...parsed.offer, input: prInput });
      return;
    }
    setPrError(null);
    setPrOffer(null);
    // A pasted URL for a different known repo opens that repo's PR and
    // switches the selector to it.
    if (parsed.repoId !== selectedId) selectRepo(parsed.repoId);
    void openReview(`pr-${parsed.pr}`, { repoId: parsed.repoId, pr: parsed.pr });
  }, [prInput, repos, selectedId, openReview, selectRepo]);

  const cloneAndOpenPr = useCallback(async () => {
    if (!prOffer || cloningPr) return;
    const label = `${prOffer.owner}/${prOffer.name}`;
    setCloningPr(label);
    setPrError(null);
    try {
      const added = await api.addRepo({ url: prOffer.input });
      // Find the clone in the returned list (the service answers the full
      // list, not the row): prefer the managed match, fall back to any
      // owner/name match.
      const lower = (s: string) => s.toLowerCase();
      const match = (r: Repo) => lower(r.owner) === lower(prOffer.owner) && lower(r.name) === lower(prOffer.name);
      const repo =
        added.repos.find((r) => r.id !== "demo" && r.managed === true && match(r)) ??
        added.repos.find((r) => r.id !== "demo" && match(r));
      if (!repo) throw new Error("the service added the repo but did not list it");
      setRepos(added.repos);
      selectRepo(repo.id);
      try {
        localStorage.setItem(REPO_KEY, repo.id);
      } catch {
        // Ignore: selection still applies for this page load.
      }
      setPrOffer(null);
      void openReview(`pr-${added.prNumber ?? prOffer.pr}`, {
        repoId: repo.id,
        pr: added.prNumber ?? prOffer.pr,
      });
    } catch (err) {
      setPrError(`Couldn't clone ${label}: ${friendlyError(err)}`);
    } finally {
      setCloningPr(null);
    }
  }, [prOffer, cloningPr, openReview, selectRepo]);

  // "Open a PR by URL or number", shared by every branch below that can
  // open one: the selected repo's lists, the no-selection hint, and the
  // no-repos state (a fresh install pastes a PR URL here and Unvibe clones
  // it — the main case for the clone offer). Bare numbers still need a
  // selected repo; PR URLs and `owner/name#N` offer to clone when unknown.
  const renderPrOpener = (): React.JSX.Element => (
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
            setPrOffer(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") openPrInput();
          }}
          style={{ flex: "1 1 220px", border: "1px solid var(--line)", borderRadius: 6, padding: "3px 8px" }}
        />
        <button className="btn" type="button" onClick={openPrInput} disabled={opening !== null || cloningPr !== null}>
          Open PR
        </button>
      </div>
      {prError ? (
        <p className="hint" role="alert">
          {prError}
        </p>
      ) : null}
      {prOffer && !cloningPr ? (
        <div className="ci" data-testid="pr-clone-offer">
          <div style={{ minWidth: 0 }}>
            <span className="hint">
              {prOffer.owner}/{prOffer.name} isn&apos;t in your list. Clone it and open #
              {prOffer.pr}?
            </span>
          </div>
          <div className="frow" style={{ gap: 4, alignItems: "center" }}>
            <button className="btn" type="button" onClick={() => void cloneAndOpenPr()}>
              Clone and open #{prOffer.pr}
            </button>
            <button className="btn ghost" type="button" onClick={() => setPrOffer(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {cloningPr ? (
        <p className="hint" data-testid="pr-cloning">
          Cloning {cloningPr}…
        </p>
      ) : null}
    </>
  );

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
  // Sessions whose repo is neither demo nor known (a checkout that went
  // away, or repos failing to load) render in their own group below so
  // they stay openable and removable.
  const visibleSessions = (sessions ?? []).filter((s) => s.repoId === selectedId);
  const demoSessions = (sessions ?? []).filter((s) => s.repoId === "demo");
  const showDemoEntry = demoSessions.length === 0 && demo.length > 0;
  const knownIds = new Set(repos.map((r) => r.id));
  const orphanSessions = reposLoaded
    ? (sessions ?? []).filter((s) => s.repoId !== "demo" && !knownIds.has(s.repoId))
    : [];

  return (
    <div className="app">
      <Toast />
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
              onChange={(e) => selectRepo(e.target.value)}
            >
              {remembered.length > 0 ? (
                <optgroup label="Repos">
                  {remembered.map((r) => (
                    <option key={r.id} value={r.id} title={r.localPath}>
                      {r.owner}/{r.name}
                      {r.managed ? " (cloned)" : ""}
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
          <PreviewBuildBadge />
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
                    <Link className="tbtn" to={`/settings?tab=${(c.settingsAnchor ?? "#environment").replace(/^#/, "")}`}>
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
          <h1 className="divider">Reviews</h1>
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
              {visibleSessions.length === 0 && demoSessions.length === 0 && orphanSessions.length === 0 ? (
                <p className="hint" data-testid="sessions-empty">
                  {reposLoaded && realRepos.length === 0 ? (
                    <>
                      No reviews yet. <Link to="/settings?tab=repositories">Add a repo in Settings</Link>{" "}
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
              {orphanSessions.length > 0 ? (
                <div data-testid="orphan-sessions">
                  <p className="hint" data-testid="orphan-sessions-label">
                    These reviews belong to checkouts that are no longer in the repo list — open or
                    remove them here.
                  </p>
                  {orphanSessions.map((s) => (
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
                </div>
              ) : null}
            </div>
          )}

          {/* PRs and branches for the selected repo. The PR input never
              waits on the lists; the lists track loading / loaded / failed
              per selection below it. */}
          {!reposLoaded || realRepos.length === 0 ? (
            reposLoaded ? (
              <div data-testid="no-repos">
                <div className="divider">Repositories</div>
                {reposError ? (
                  <p className="hint" role="alert">
                    Couldn&apos;t load the repo list. Check the service is running, then reload the
                       page — or <Link to="/settings?tab=repositories">manage repos in Settings</Link>.
                  </p>
                ) : (
                  <>
                    <p className="hint">
                      No repos yet. Paste a PR URL below and Unvibe will clone the repo and open
                       it — or <Link to="/settings?tab=repositories">add one in Settings</Link> to
                      browse its PRs and branches.
                    </p>
                    {renderPrOpener()}
                  </>
                )}
              </div>
            ) : null
          ) : !selectedId ? (
            <>
              <p className="hint">Pick a repo above to browse its PRs and branches, or open a PR below.</p>
              {renderPrOpener()}
            </>
          ) : (
            <>
              {renderPrOpener()}
              {ghProblem ? (
                <p className="hint" data-testid="newreview-gh-hint">
                  PR lists need gh ({ghProblem.summary}). You can still open a local branch below or a
                  PR by number once gh works.
                </p>
              ) : null}

              {listsFor !== selectedId ? (
                <p className="hint" data-testid="repo-lists-loading">
                  Loading {selected ? `${selected.owner}/${selected.name}` : "repo"}…
                </p>
              ) : listsError ? (
                <p className="hint" role="alert" data-testid="lists-error">
                  Couldn&apos;t load {selected ? `${selected.owner}/${selected.name}` : "this repo"}
                  &apos;s lists: {listsError}{" "}
                  <button className="mini" type="button" onClick={retryLists}>
                    Retry
                  </button>
                </p>
              ) : (
                <>
                  {fetchNote ? (
                    <p className="hint" data-testid="fetch-note">
                      {fetchNote}
                    </p>
                  ) : null}
                  <ChangeSection
                    title="PRs you're authoring"
                    changes={authoring}
                    error={listErrors.authoring}
                    errorTestId="changes-error-authoring"
                    opening={opening}
                    empty="Nothing found."
                    onOpen={(c, i) =>
                      openReview(changeKey(c, i), { repoId: selectedId, pr: c.prNumber, branch: c.branch })
                    }
                  />
                  <ChangeSection
                    title="Waiting on your review"
                    changes={requested}
                    error={listErrors.requested}
                    errorTestId="changes-error-requested"
                    opening={opening}
                    empty="Nothing waiting."
                    onOpen={(c, i) =>
                      openReview(changeKey(c, i), { repoId: selectedId, pr: c.prNumber, branch: c.branch })
                    }
                  />
                  <ChangeSection
                    title="Recent branches"
                    changes={branches}
                    error={listErrors.branches}
                    errorTestId="changes-error-branches"
                    opening={opening}
                    empty="No branches."
                    onOpen={(c, i) => openReview(changeKey(c, i), { repoId: selectedId, branch: c.branch })}
                  />
                </>
              )}
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
            <span className="hint">Remove this review from Unvibe? Nothing changes on GitHub.</span>
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
              Cancel
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

/**
 * Head line for a start-page change row (#91): PR rows show `#N · branch`
 * when the branch is known and just `#N` when it is not (`gh search prs`
 * has no head-branch field, so `branch` is unset for these rows) — never
 * `#N · undefined` and never a dangling separator.
 */
export function changeHead(c: RepoChange): string {
  if (c.kind === "pr") {
    const num = c.prNumber !== undefined ? `#${c.prNumber}` : "PR";
    return c.branch ? `${num} · ${c.branch}` : num;
  }
  return c.branch ?? c.title;
}

function ChangeSection({
  title,
  changes,
  error,
  errorTestId,
  opening,
  empty,
  onOpen,
}: {
  title: string;
  changes: RepoChange[];
  /** A failed filter shows its error instead of the empty copy or rows. */
  error: string | null;
  errorTestId: string;
  opening: string | null;
  empty: string;
  onOpen: (c: RepoChange, i: number) => void;
}): React.JSX.Element {
  return (
    <>
      <div className="divider">{title}</div>
      {error ? (
        <p className="hint" role="alert" data-testid={errorTestId}>
          {error}
        </p>
      ) : changes.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        changes.map((c, i) => (
          <div key={changeKey(c, i)} className="ci">
            <button className="cj" type="button" disabled={opening !== null} onClick={() => onOpen(c, i)}>
              <span className="cw">
                {changeHead(c)}
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
