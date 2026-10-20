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
 *   the loading state so it can never stick forever. When storage holds
 *   the new repo's last successful fetch (#90), those kept rows show at
 *   once and the fresh fetch only refreshes underneath. A total failure
 *   shows an inline error with a Retry button (a background refresh keeps
 *   the kept rows rendered underneath); a single failed filter
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
import { changePrUrl, githubPrUrl } from "@unvibe/shared";
import { Button, Card } from "../ui/index.js";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { ingestStepLabel, stageLabel } from "../guide/stageLabels.js";
import { Toast, toast } from "../floating/Toast.js";
import { ScreenTopBar } from "../shell/ScreenTopBar.js";
import {
  clearAllKeptLists,
  getKeptLists,
  getKeptViewer,
  initialKept,
  keptStatusText,
  pruneKeptLists,
  setKeptLists,
  setKeptViewer,
} from "./keptChanges.js";

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

/**
 * Review-request scope (#95): rows the service marked team-only read as
 * "team"; everything else (direct rows, other lists, rows stored before
 * the scope existed) reads as direct, as the single list did before.
 */
export function reviewScopeOf(c: RepoChange): "direct" | "team" {
  return c.reviewScope === "team" ? "team" : "direct";
}

/** Recency windows for the review-request filter (#95): last update within. */
export type RecencyWindow = "all" | "1d" | "3d" | "1w" | "2w";

export const RECENCY_KEY = "unvibe.start.reviewRecency";

export const RECENCY_WINDOWS: {
  value: RecencyWindow;
  label: string;
  ms: number | null;
  emptyNote: string;
  branchesNote: string;
}[] = [
  { value: "all", label: "All", ms: null, emptyNote: "", branchesNote: "" },
  {
    value: "1d",
    label: "Last day",
    ms: 86400_000,
    emptyNote: "No PRs updated in the last day.",
    branchesNote: "No branches updated in the last day.",
  },
  {
    value: "3d",
    label: "Last 3 days",
    ms: 3 * 86400_000,
    emptyNote: "No PRs updated in the last 3 days.",
    branchesNote: "No branches updated in the last 3 days.",
  },
  {
    value: "1w",
    label: "Last week",
    ms: 7 * 86400_000,
    emptyNote: "No PRs updated in the last week.",
    branchesNote: "No branches updated in the last week.",
  },
  {
    value: "2w",
    label: "Last 2 weeks",
    ms: 14 * 86400_000,
    emptyNote: "No PRs updated in the last 2 weeks.",
    branchesNote: "No branches updated in the last 2 weeks.",
  },
];

function isRecencyWindow(v: unknown): v is RecencyWindow {
  return RECENCY_WINDOWS.some((w) => w.value === v);
}

function readRecency(): RecencyWindow {
  try {
    const saved = localStorage.getItem(RECENCY_KEY);
    if (isRecencyWindow(saved)) return saved;
  } catch {
    // Ignore: default below.
  }
  return "all";
}

/**
 * True when the row is recent enough for the window (#95). Recency means
 * last PR update; rows with no known update stay visible (their age is
 * unknown, not old).
 */
export function inRecencyWindow(c: RepoChange, windowMs: number | null, now = Date.now()): boolean {
  if (windowMs === null) return true;
  if (typeof c.updatedAt !== "number" || !Number.isFinite(c.updatedAt)) return true;
  return c.updatedAt >= now - windowMs;
}

/**
 * Newest first for the authoring list (#131): rows without a time sort
 * last (stable). Mirrors the service's `byUpdatedDesc`, so kept rows and
 * any unsorted response still read newest first.
 */
export function byUpdatedDesc(a: RepoChange, b: RepoChange): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
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
  // Stage names shared with the guide empty state (guide/stageLabels.ts);
  // the rest are start-page-only labels.
  const shared = stageLabel(first);
  if (shared) return shared;
  switch (first) {
    case "explain":
      return "Writing explanation…";
    case "ask":
      return "Answering a question…";
    case "depth":
      return "Rewriting…";
    case "examples":
      return "Adding examples…";
    case "diagram":
      return "Drawing diagram…";
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
  return { error: "Enter a PR number or a GitHub PR URL." };
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
  // Kept rows (#90) for the initially selected repo, read once: the list
  // states below all initialise from this one value.
  const [initial] = useState(() => initialKept(REPO_KEY));
  const [authoring, setAuthoring] = useState<RepoChange[]>(initial.kept?.authoring ?? []);
  const [requested, setRequested] = useState<RepoChange[]>(initial.kept?.requested ?? []);
  const [branches, setBranches] = useState<RepoChange[]>(initial.kept?.branches ?? []);
  const [listErrors, setListErrors] = useState<ListErrors>(EMPTY_ERRORS);
  // The repo the PR/branch lists below were loaded for (null = none yet or
  // cleared). The render gates on this so a newly selected repo never shows
  // the previous repo's data. With kept lists (#90) this starts as the
  // selected repo when a kept entry exists, so the kept rows render on the
  // first paint and the fetch only refreshes underneath.
  const [listsFor, setListsFor] = useState<string | null>(initial.kept ? initial.repoId : null);
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
  const [fetchNote, setFetchNote] = useState<string | null>(initial.kept?.fetchNote ?? null);
  // Kept lists (#90): when the shown rows came from storage, their fetch
  // time drives the quiet "Updated …" line. `refreshing` is true while a
  // background refresh is in flight on top of kept rows.
  const [keptFetchedAt, setKeptFetchedAt] = useState<number | null>(initial.kept?.fetchedAt ?? null);
  const [refreshing, setRefreshing] = useState(false);
  // Review-request recency filter (#95): remembered like the repo choice.
  const [recency, setRecency] = useState<RecencyWindow>(readRecency);

  // Readiness (fills in after render; never blocks).
  const [readiness, setReadiness] = useState<ReadinessCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const r = await api.reviews();
      setSessions(r.reviews);
      setSessionsError(null);
    } catch {
      setSessionsError("Couldn't load your reviews.");
    }
  }, []);

  // Monotonic load id: a superseded selection's late responses are ignored.
  // (A late batch for the CURRENT id still applies: it is fresher than the
  // cleared state and newer than nothing else in flight.)
  // With kept lists (#90) a load is a background refresh when storage held
  // rows for the repo: the kept rows stay rendered, the fetch replaces them
  // when it lands, and a failed refresh keeps them with the error note.
  const loadSeq = useRef(0);
  const loadLists = useCallback(async (id: string) => {
    const seq = ++loadSeq.current;
    const kept = getKeptLists(id);
    const hadKept = kept !== null;
    // A background refresh shows its quiet sign; a first load keeps the
    // existing "Loading…" state (no kept age to describe).
    if (hadKept) setRefreshing(true);
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
    if (settled === null) {
      // Timeout: a superseded selection's late timer is ignored so it can
      // never overwrite the current repo's lists.
      if (loadSeq.current !== seq) return;
      if (hadKept) {
        // Failed background refresh: keep the old lists, show the note.
        setListErrors(EMPTY_ERRORS);
        setListsError("it took too long — the service may be busy");
        setRefreshing(false);
        return;
      }
      setListErrors(EMPTY_ERRORS);
      setListsError("it took too long — the service may be busy");
      setListsFor(id);
      return;
    }
    const [a, r, rec] = settled;
    const fulfilled = [a, r, rec].filter((x) => x.status === "fulfilled").length;
    const freshAuthoring = a.status === "fulfilled" ? a.value.changes : (kept?.authoring ?? []);
    const freshRequested = r.status === "fulfilled" ? r.value.changes : (kept?.requested ?? []);
    // `recent` mixes branches and previous reviews; branches only here
    // (prior sessions come from GET /api/reviews, filtered per repo).
    const freshBranches =
      rec.status === "fulfilled"
        ? rec.value.changes.filter((c) => c.kind === "branch")
        : (kept?.branches ?? []);
    // A managed clone that could not be refreshed reports the same
    // `fetchError` on every call: show it once, near the lists. A fresh
    // success clears a stale note; a total failure keeps the old one.
    const freshNote =
      [a, r, rec].flatMap((x) =>
        x.status === "fulfilled" && x.value.fetchError ? [x.value.fetchError] : [],
      )[0] ?? (fulfilled === 0 ? (kept?.fetchNote ?? null) : null);
    // Stale response for a previous repo: refresh its kept entry so a return
    // visit shows fresh rows, but never touch the current repo's state.
    if (loadSeq.current !== seq) {
      if (fulfilled > 0) {
        try {
          setKeptLists(id, {
            authoring: freshAuthoring,
            requested: freshRequested,
            branches: freshBranches,
            fetchNote:
              [a, r, rec].flatMap((x) =>
                x.status === "fulfilled" && x.value.fetchError ? [x.value.fetchError] : [],
              )[0] ?? null,
          });
        } catch {
          // Best effort.
        }
      }
      return;
    }
    setAuthoring(freshAuthoring);
    setRequested(freshRequested);
    setBranches(freshBranches);
    setFetchNote(freshNote);
    setListErrors({
      authoring: a.status === "rejected" ? friendlyError(a.reason) : null,
      requested: r.status === "rejected" ? friendlyError(r.reason) : null,
      branches: rec.status === "rejected" ? friendlyError(rec.reason) : null,
    });
    const rejected = [a, r, rec].filter((x): x is PromiseRejectedResult => x.status === "rejected");
    setListsError(rejected.length === 3 ? friendlyError(rejected[0].reason) : null);
    // Keep the last successful response per repo (failed filters reuse the
    // kept rows merged above). A total failure keeps the old entry and its
    // age, so the status line still describes what is shown.
    if (fulfilled > 0) {
      try {
        const saved = setKeptLists(id, {
          authoring: freshAuthoring,
          requested: freshRequested,
          branches: freshBranches,
          fetchNote: freshNote,
        });
        setKeptFetchedAt(saved.fetchedAt);
      } catch {
        // Storage is best effort; the rendered lists are already updated.
      }
    }
    setListsFor(id);
    setRefreshing(false);
  }, []);

  /** Select a repo: with kept rows (#90) they render synchronously so the
      previous repo's data can never flash, and the load effect refreshes
      underneath. Without kept rows the old lists clear as before, so a
      first load behaves exactly as today. The nonce bump guarantees the
      effect fires a fresh load even when the id is unchanged. */
  const selectRepo = useCallback(
    (id: string) => {
      const kept = getKeptLists(id);
      if (kept) {
        setAuthoring(kept.authoring);
        setRequested(kept.requested);
        setBranches(kept.branches);
        setListErrors(EMPTY_ERRORS);
        setListsError(null);
        setFetchNote(kept.fetchNote);
        setListsFor(id);
        setKeptFetchedAt(kept.fetchedAt);
        setRefreshing(true);
      } else {
        setAuthoring([]);
        setRequested([]);
        setBranches([]);
        setListErrors(EMPTY_ERRORS);
        setListsError(null);
        setFetchNote(null);
        setListsFor(null);
        setKeptFetchedAt(null);
        setRefreshing(false);
      }
      setSelectedId(id);
      setListsNonce((n) => n + 1);
    },
    [],
  );

  const selectRecency = useCallback((w: RecencyWindow) => {
    setRecency(w);
    try {
      localStorage.setItem(RECENCY_KEY, w);
    } catch {
      // Ignore: the choice simply does not persist.
    }
  }, []);

  const retryLists = useCallback(() => {
    if (!selectedId) return;
    // Retry keeps the shown rows (kept or fresh) and refreshes underneath;
    // a first load with nothing shown behaves as before.
    setListsError(null);
    if (getKeptLists(selectedId)) setRefreshing(true);
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
        // Kept lists (#90) must not outlive their repo: drop entries for
        // repos no longer listed (removed repo, changed login's list).
        try {
          pruneKeptLists(r.repos.map((x) => x.id));
        } catch {
          // Best effort.
        }
        // A changed login must not keep showing the previous user's PRs:
        // the viewer login rides alongside the kept lists, and a mismatch
        // clears them (the background refresh replaces them right away).
        api
          .viewer()
          .then((v) => {
            if (cancelled) return;
            try {
              const prev = getKeptViewer();
              if (prev !== null && v.login !== prev) clearAllKeptLists();
              if (v.login !== prev) setKeptViewer(v.login);
            } catch {
              // Best effort.
            }
          })
          .catch(() => {
            // Viewer unknown (offline/gh down): keep what is stored.
          });
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

  /**
   * #149: open a PR/branch row — a row that already has a review opens it
   * directly (no new review, no repeated agent work); otherwise the review
   * is created (the service reuses a ready review there too).
   */
  const openChange = useCallback(
    (c: RepoChange, i: number, body: CreateReviewRequest) => {
      if (c.reviewId) {
        navigate(`/review/${c.reviewId}`);
        return;
      }
      void openReview(changeKey(c, i), body);
    },
    [navigate, openReview],
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
      if (!repo) throw new Error("it was cloned but is missing from your repos — reload the page");
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
          placeholder="PR number or GitHub PR URL"
          value={prInput}
          onChange={(e) => {
            setPrInput(e.target.value);
            setPrError(null);
            setPrOffer(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") openPrInput();
          }}
          className="ui-input"
          style={{ flex: "1 1 220px" }}
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
              {prOffer.owner}/{prOffer.name} isn&apos;t in your repos. Clone it and open #
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
  // Quiet kept-lists sign (#90, #148): how old the shown rows are, plus a
  // refresh marker while the background fetch is in flight. Short plain
  // sentence case. It rides the refresh icon's tooltip, so no text line
  // ever appears or shifts the layout.
  const keptStatus =
    listsFor !== null && listsFor === selectedId ? keptStatusText(keptFetchedAt, refreshing) : null;

  // Review requests, split (#95): asked of you by name vs only of a team
  // you belong to (a PR asking both reads once, as direct). The service
  // returns every PR list newest-first; the recency window only hides
  // rows. #131 extends the window (and the newest-first order) to "Your
  // PRs" and to Recent branches (by last commit date); Reviews stays
  // unfiltered, ordered by recent activity.
  const directRequested = requested.filter((c) => reviewScopeOf(c) === "direct");
  const teamRequested = requested.filter((c) => reviewScopeOf(c) === "team");
  const windowMs = RECENCY_WINDOWS.find((w) => w.value === recency)?.ms ?? null;
  const windowEmptyNote = RECENCY_WINDOWS.find((w) => w.value === recency)?.emptyNote ?? "";
  const branchesEmptyNote = RECENCY_WINDOWS.find((w) => w.value === recency)?.branchesNote ?? "";
  const visibleDirect = directRequested.filter((c) => inRecencyWindow(c, windowMs));
  const visibleTeam = teamRequested.filter((c) => inRecencyWindow(c, windowMs));
  const visibleAuthoring = [...authoring]
    .sort(byUpdatedDesc)
    .filter((c) => inRecencyWindow(c, windowMs));
  const visibleBranches = [...branches]
    .sort(byUpdatedDesc)
    .filter((c) => inRecencyWindow(c, windowMs));

  return (
    <div className="app">
      <Toast />
      <ScreenTopBar showBadge />
      <main className="col" style={{ padding: 24 }}>
        <div className="doc" style={{ maxWidth: 760 }}>
          {realRepos.length > 0 && selectedId ? (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>
              <select
                aria-label="Repo"
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
                  <optgroup label="Found on this machine">
                    {detected.map((r) => (
                      <option key={r.id} value={r.id} title={r.localPath}>
                        {r.owner}/{r.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          ) : null}
          {/* Readiness callouts: one compact row per problem, each linking
              to the relevant Settings section. Nothing when all is well
              (apart from the quiet ready line at the bottom of the page). */}
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
                    <Button variant="quiet" size="sm" type="button" onClick={() => void recheck()} disabled={checking}>
                      {checking ? "Checking…" : "Re-check"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Reviews for the selected repo, then the demo row. */}
          <h1 className="divider">Reviews</h1>
          {mainProblem ? (
            <p className="hint" data-testid="newreview-agent-hint">
              The main model isn&apos;t ready ({mainProblem.summary}), so the guide may not be written. You can
              still open the diff and comment.
            </p>
          ) : null}
          {sessions === null && !sessionsError ? (
            <p className="hint">Loading reviews…</p>
          ) : sessionsError ? (
            <p className="hint" role="alert">
              {sessionsError}
            </p>
          ) : (
            <div aria-label="Reviews" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                        <span className="cw">Demo · no agent needed</span>
                        <span className="cx2">{c.title}</span>
                      </button>
                      {opening === changeKey(c, i) ? <span className="hint">Opening…</span> : null}
                    </div>
                  ))
                : null}
              {orphanSessions.length > 0 ? (
                <div data-testid="orphan-sessions">
                  <p className="hint" data-testid="orphan-sessions-label">
                    These reviews are for repos that are no longer in your list. You can still open or
                    remove them.
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
                <div className="divider">Repos</div>
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
                  Listing PRs needs gh ({ghProblem.summary}). You can still open a local branch below.
                </p>
              ) : null}

              {listsFor !== selectedId ? (
                <p className="hint" data-testid="repo-lists-loading">
                  Loading {selected ? `${selected.owner}/${selected.name}` : "repo"}…
                </p>
              ) : listsError && keptFetchedAt === null ? (
                <p className="hint" role="alert" data-testid="lists-error">
                  Couldn&apos;t load PRs and branches for {selected ? `${selected.owner}/${selected.name}` : "this repo"}: {listsError}{" "}
                  <button className="mini" type="button" onClick={retryLists}>
                    Retry
                  </button>
                </p>
              ) : (
                <Card as="section" variant="plain" className="prblock" aria-label="PRs and branches" data-testid="pr-block">
                  <div className="prblock-head">
                    <h2 className="prblock-title">PRs and branches</h2>
                    <div className="prblock-tools">
                      {/* Manual refresh (#148): the same load the Retry
                          button below triggers. The last-fetch time rides
                          the tooltip; the icon spins while fetching. */}
                      <button
                        className="ib"
                        type="button"
                        onClick={retryLists}
                        title={keptStatus ?? "Refresh lists"}
                        aria-label="Refresh lists"
                        data-testid="lists-refresh"
                      >
                        <span className={refreshing ? "spin" : undefined} aria-hidden="true">
                          <Icon name="refresh" />
                        </span>
                      </button>
                      {/* Recency filter (#95, #131, #148): one compact
                          control for everything in this block — "Your
                          PRs", both review groups and Recent branches (by
                          last commit date). Reviews above stays
                          unfiltered. */}
                      <select
                        aria-label="Updated within"
                        className="tbtn"
                        value={recency}
                        onChange={(e) => {
                          if (isRecencyWindow(e.target.value)) selectRecency(e.target.value);
                        }}
                      >
                        {RECENCY_WINDOWS.map((w) => (
                          <option key={w.value} value={w.value}>
                            {w.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {listsError ? (
                    <p className="hint" role="alert" data-testid="lists-error">
                      Couldn&apos;t load PRs and branches for {selected ? `${selected.owner}/${selected.name}` : "this repo"}: {listsError}{" "}
                      <button className="mini" type="button" onClick={retryLists}>
                        Retry
                      </button>
                    </p>
                  ) : null}
                  {fetchNote ? (
                    <p className="hint" data-testid="fetch-note">
                      {fetchNote}
                    </p>
                  ) : null}
                  <ChangeSection
                    title="Your PRs"
                    changes={visibleAuthoring}
                    error={listErrors.authoring}
                    errorTestId="changes-error-authoring"
                    opening={opening}
                    empty="No open PRs."
                    emptyTestId="authoring-empty"
                    filteredNote={authoring.length > 0 && visibleAuthoring.length === 0 ? windowEmptyNote : null}
                    onShowAll={() => selectRecency("all")}
                    owner={selected?.owner ?? null}
                    name={selected?.name ?? null}
                    onOpen={(c, i) =>
                      openChange(c, i, {
                        repoId: selectedId,
                        pr: c.prNumber,
                        branch: c.branch,
                        title: c.title,
                        ...(c.author ? { author: c.author } : {}),
                      })
                    }
                  />
                  <div className="divider">Waiting on your review</div>
                  {listErrors.requested ? (
                    <p className="hint" role="alert" data-testid="changes-error-requested">
                      {listErrors.requested}
                    </p>
                  ) : null}
                  <div className="subhead">Requested of you</div>
                  {visibleDirect.length === 0 ? (
                    <p className="hint" data-testid="requested-direct-empty">
                      {directRequested.length === 0 ? (
                        "No PRs requested of you."
                      ) : (
                        <>
                          {windowEmptyNote}{" "}
                          <button type="button" className="mini" onClick={() => selectRecency("all")}>
                            Show all
                          </button>
                        </>
                      )}
                    </p>
                  ) : (
                    visibleDirect.map((c, i) => (
                      <ChangeRow
                        key={changeKey(c, i)}
                        c={c}
                        i={i}
                        opening={opening}
                        owner={selected?.owner ?? null}
                        name={selected?.name ?? null}
                        onOpen={(row, j) =>
                          openChange(row, j, {
                            repoId: selectedId,
                            pr: row.prNumber,
                            branch: row.branch,
                            title: row.title,
                            ...(row.author ? { author: row.author } : {}),
                          })
                        }
                      />
                    ))
                  )}
                  <div className="subhead">Requested of your team</div>
                  {visibleTeam.length === 0 ? (
                    <p className="hint" data-testid="requested-team-empty">
                      {teamRequested.length === 0 ? (
                        "No PRs requested of your team."
                      ) : (
                        <>
                          {windowEmptyNote}{" "}
                          <button type="button" className="mini" onClick={() => selectRecency("all")}>
                            Show all
                          </button>
                        </>
                      )}
                    </p>
                  ) : (
                    visibleTeam.map((c, i) => (
                      <ChangeRow
                        key={changeKey(c, i)}
                        c={c}
                        i={i}
                        opening={opening}
                        owner={selected?.owner ?? null}
                        name={selected?.name ?? null}
                        onOpen={(row, j) =>
                          openChange(row, j, {
                            repoId: selectedId,
                            pr: row.prNumber,
                            branch: row.branch,
                            title: row.title,
                            ...(row.author ? { author: row.author } : {}),
                          })
                        }
                      />
                    ))
                  )}
                  <ChangeSection
                    title="Recent branches"
                    changes={visibleBranches}
                    error={listErrors.branches}
                    errorTestId="changes-error-branches"
                    opening={opening}
                    empty="No branches."
                    emptyTestId="branches-empty"
                    filteredNote={branches.length > 0 && visibleBranches.length === 0 ? branchesEmptyNote : null}
                    onShowAll={() => selectRecency("all")}
                    owner={selected?.owner ?? null}
                    name={selected?.name ?? null}
                    onOpen={(c, i) => openChange(c, i, { repoId: selectedId, branch: c.branch })}
                  />
                </Card>
              )}
            </>
          )}
          {allReady ? (
            <p className="hint" data-testid="readiness-ready" style={{ marginTop: 24 }}>
              Ready
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export function SessionRow({
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
  // #94: where the review names a GitHub PR, the number links to the PR
  // page (new tab). Branch-only reviews and the demo get no link. The
  // title button (and the row around it) still opens the review.
  const prUrl =
    s.prNumber !== undefined && s.repoId !== "demo"
      ? githubPrUrl(s.repoOwner, s.repoName, s.prNumber)
      : null;
  const canOpen = opening === null && deleting === null;
  return (
    <div key={s.id} className="ci" data-testid={`session-${s.id}`}>
      <div className="cj" onClick={canOpen ? onOpen : undefined}>
        <span className="cw">
          {s.repoOwner}/{s.repoName} ·{" "}
          {prUrl !== null && s.prNumber !== undefined ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open PR #${s.prNumber} on GitHub`}
            >
              #{s.prNumber}
            </a>
          ) : s.prNumber !== undefined ? (
            `#${s.prNumber}`
          ) : (
            s.branch
          )}
          {s.currentVersion > 1 ? ` · v${s.currentVersion}` : ""}
          {" · "}
          {timeAgo(s.lastOpened)}
        </span>
        <button
          className="cj-open"
          type="button"
          disabled={!canOpen}
          onClick={onOpen}
          title={`${s.title} (${s.branch})`}
        >
          <span className="cx2">{s.title}</span>
        </button>
        <span className="hint">
          {s.ingestStatus === "loading" ? (
            <>{ingestStepLabel(s.ingestStep)}</>
          ) : s.ingestStatus === "failed" ? (
            <>{s.ingestError ? `Couldn't open this review: ${s.ingestError}` : "Couldn't open this review"}</>
          ) : s.ingestStatus === "empty" ? (
            <>{s.ingestError ?? "No changes to review: the diff is empty."}</>
          ) : (
            <>
              {s.reviewedHunks}/{s.totalHunks} hunks reviewed
              {s.pendingComments > 0 ? ` · ${s.pendingComments} for PR` : ""}
              {" · "}
              {guideLabel(s)}
            </>
          )}
        </span>
      </div>
      <div className="frow" style={{ gap: 4, alignItems: "center" }}>
        {s.ingestStatus === "loading" ? <span className="prtag">opening</span> : null}
        {s.ingestStatus === "failed" ? <span className="prtag">couldn&apos;t open</span> : null}
        {s.ingestStatus === "empty" ? <span className="prtag">no changes</span> : null}
        {s.stale && s.ingestStatus !== "loading" && s.ingestStatus !== "failed" && s.ingestStatus !== "empty" ? (
          <span className="prtag">new commits</span>
        ) : null}
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
            title="Remove this review from Unvibe. GitHub and your own folder are not touched; the working copy Unvibe made is deleted."
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

/**
 * Diff size for a PR row (#100): formatted add/delete/file parts, or null
 * when the row carries no size data (the row omits the size then).
 * Thousands separators per the glossary; "1 file" stays singular.
 */
export interface DiffSizeParts {
  additions: string | null;
  deletions: string | null;
  files: string | null;
}

export function diffSizeParts(
  c: Pick<RepoChange, "additions" | "deletions" | "changedFiles">,
): DiffSizeParts | null {
  const num = (n: number | undefined): string | null =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n.toLocaleString("en-US") : null;
  const additions = num(c.additions);
  const deletions = num(c.deletions);
  const changed = num(c.changedFiles);
  if (additions === null && deletions === null && changed === null) return null;
  return {
    additions: additions === null ? null : `+${additions}`,
    // U+2212 minus, as in the diff pane.
    deletions: deletions === null ? null : `−${deletions}`,
    files: changed === null ? null : `${changed} ${c.changedFiles === 1 ? "file" : "files"}`,
  };
}

/**
 * One PR/branch list row (#95, #100, #94): the head line carries the PR
 * number and branch, author, relative update time, diff size and team
 * names — each omitted when unknown — above the title that opens the
 * review. Where the row names a GitHub PR, the number is a link to the PR
 * page (new tab); the title button (and the row around it) opens the
 * review, so the link never triggers the row and both stay
 * keyboard-reachable.
 */
function ChangeRow({
  c,
  i,
  opening,
  onOpen,
  owner,
  name,
}: {
  c: RepoChange;
  i: number;
  opening: string | null;
  onOpen: (c: RepoChange, i: number) => void;
  owner: string | null;
  name: string | null;
}): React.JSX.Element {
  const size = diffSizeParts(c);
  const prLabel = c.kind === "pr" ? (c.prNumber !== undefined ? `#${c.prNumber}` : "PR") : null;
  const prUrl = prLabel !== null && owner !== null && name !== null ? changePrUrl(c, owner, name) : null;
  const open = opening === null ? (): void => onOpen(c, i) : undefined;
  return (
    <div className="ci">
      <div className="cj" onClick={open}>
        <span className="cw">
          {prLabel !== null ? (
            <>
              {prUrl !== null ? (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Open PR ${prLabel} on GitHub`}
                >
                  {prLabel}
                </a>
              ) : (
                prLabel
              )}
              {c.branch ? ` · ${c.branch}` : ""}
            </>
          ) : (
            (c.branch ?? c.title)
          )}
          {c.author ? ` · ${c.author}` : ""}
          {(c.kind === "pr" || c.kind === "branch") && typeof c.updatedAt === "number"
            ? ` · ${timeAgo(c.updatedAt)}`
            : ""}
          {size !== null ? (
            <>
              {" · "}
              {size.additions !== null ? <span className="a">{size.additions}</span> : null}
              {size.additions !== null && size.deletions !== null ? " " : null}
              {size.deletions !== null ? <span className="d">{size.deletions}</span> : null}
              {size.files !== null ? (
                <>{size.additions !== null || size.deletions !== null ? " · " : ""}{size.files}</>
              ) : null}
            </>
          ) : null}
          {c.requestedTeams && c.requestedTeams.length > 0 ? ` · via ${c.requestedTeams.join(", ")}` : ""}
        </span>
        <button className="cj-open" type="button" disabled={opening !== null} onClick={() => onOpen(c, i)}>
          <span className="cx2">{c.title}</span>
        </button>
      </div>
      {c.reviewId || opening === changeKey(c, i) ? (
        <div className="frow" style={{ gap: 4, alignItems: "center" }}>
          {c.reviewId ? <span className="prtag">review</span> : null}
          {c.reviewId && c.stale ? <span className="prtag">new commits</span> : null}
          {opening === changeKey(c, i) ? <span className="hint">Opening…</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ChangeSection({
  title,
  changes,
  error,
  errorTestId,
  opening,
  empty,
  emptyTestId,
  filteredNote,
  onShowAll,
  onOpen,
  owner,
  name,
}: {
  title: string;
  changes: RepoChange[];
  /** A failed filter shows its error; with kept rows (#90) the kept rows
      stay rendered underneath instead of emptying the section. */
  error: string | null;
  errorTestId: string;
  opening: string | null;
  empty: string;
  /** #131: test id for the empty state (authoring and branches need one). */
  emptyTestId?: string;
  /** #131: when the recency window hides every row, this note replaces the
      generic empty text, with a way back to All. Null means genuinely empty. */
  filteredNote?: string | null;
  onShowAll?: (() => void) | null;
  onOpen: (c: RepoChange, i: number) => void;
  owner: string | null;
  name: string | null;
}): React.JSX.Element {
  return (
    <>
      <div className="divider">{title}</div>
      {error ? (
        <p className="hint" role="alert" data-testid={errorTestId}>
          {error}
        </p>
      ) : null}
      {changes.length === 0 && !error ? (
        filteredNote ? (
          <p className="hint" data-testid={emptyTestId}>
            {filteredNote}{" "}
            <button type="button" className="mini" onClick={onShowAll ?? undefined}>
              Show all
            </button>
          </p>
        ) : (
          <p className="hint" data-testid={emptyTestId}>
            {empty}
          </p>
        )
      ) : (
        changes.map((c, i) => (
          <ChangeRow key={changeKey(c, i)} c={c} i={i} opening={opening} onOpen={onOpen} owner={owner} name={name} />
        ))
      )}
    </>
  );
}
