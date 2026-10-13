/**
 * Diff pane (PRD §4.13): toolbar, files panel, file/hunk list.
 *
 * Behaviour ported from `prototype.html`; data comes from the review
 * snapshot (`files` + `hunkStates`). Hunk state (folded, reviewed, note,
 * summary) persists through `PATCH /api/reviews/:id/hunks/:hash`; in mock
 * mode the in-memory API applies the same change through the WS-patch path.
 * View preferences persist in `localStorage`.
 *
 * Later milestones plug in here without touching this file's contract:
 * - threads/expansions render under a line via `lineSlots` (prop or
 *   `LineSlotProvider`) keyed `${fileKey}:${newSideLine}`;
 * - line-number clicks emit `onLineClick` ("start a comment" hook);
 * - the guide agent jumps here via `revealSource("diff:…")`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Hunk, ReviewFile, UpdateHunkRequest } from "@unvibe/shared";
import { looksLikeJson } from "@unvibe/shared";
import { api } from "../../api/client.js";
import { ErrorBoundary, InlineFallback } from "../../components/ErrorBoundary.js";
import { Icon } from "../../components/Icon.js";
import { toast } from "../../floating/Toast.js";
import { useReview } from "../../state/store.js";
import {
  comparisonToBanner,
  statusToBanner,
  VersionBanner,
  type BannerCounts,
} from "../../versions/VersionBanner.js";
import { refreshErrorNotice } from "../../versions/versionUtils.js";
import { useReviewVersion } from "../../versions/useReviewVersion.js";
import { FileSection, type DiffViewMode, type HunkActions, type HunkUiState } from "./FileSection.js";
import {
  buildFileTree,
  citedHunkHashes,
  filterFiles,
  hunkOverlaps,
  shouldHideHunk,
  type TreeRow,
} from "./diffLogic.js";
import { useLineSlots, type LineSlots } from "./lineSlots.js";
import {
  onRevealSource,
  parseDiffRef,
  revealSource,
  takePendingReveal,
  type RevealTarget,
} from "./revealSource.js";

export const WIDEN_EVENT = "unvibe:widen-pane";

const PREFS_KEY = "unvibe.diff.prefs.v1";
const CATS = [
  { k: "source", l: "Code" },
  { k: "tests", l: "Tests" },
  { k: "docs", l: "Docs" },
  { k: "config", l: "Config" },
  { k: "generated", l: "Generated" },
] as const;

interface DiffPrefs {
  view: DiffViewMode;
  hideUninteresting: boolean;
  hideReviewed: boolean;
  cats: string[];
  filesOpen: boolean;
}

const DEFAULT_PREFS: DiffPrefs = {
  view: "unified",
  hideUninteresting: true,
  hideReviewed: false,
  cats: CATS.map((c) => c.k),
  filesOpen: false,
};

function loadPrefs(): DiffPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const p = JSON.parse(raw) as Partial<DiffPrefs>;
    return {
      view: p.view === "split" ? "split" : "unified",
      hideUninteresting: p.hideUninteresting ?? true,
      hideReviewed: p.hideReviewed ?? false,
      cats: Array.isArray(p.cats) && p.cats.length > 0 ? p.cats : [...DEFAULT_PREFS.cats],
      filesOpen: p.filesOpen ?? false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export interface DiffViewProps {
  reviewId: string;
  /** Extra rows under a diff line, keyed `${fileKey}:${newSideLine}`. */
  lineSlots?: LineSlots;
  /** New-side lines that already have a comment (shows the comment icon). */
  commentedLines?: ReadonlySet<string>;
  /** "Start a comment" hook: fired when a new-side line number is clicked. */
  onLineClick?: (fileKey: string, line: number) => void;
}

interface Highlight {
  fileKey: string;
  start: number;
  end: number;
  nonce: number;
}

export function DiffView({ reviewId, lineSlots, commentedLines, onLineClick }: DiffViewProps): ReactNode {
  const snapshot = useReview((s) => s.snapshot);
  const setSnapshot = useReview((s) => s.setSnapshot);
  const [prefs, setPrefs] = useState<DiffPrefs>(loadPrefs);
  const [fq, setFq] = useState("");
  const [fileFold, setFileFold] = useState<Record<string, boolean>>({});
  const [unhidden, setUnhidden] = useState<Record<string, boolean>>({});
  const [dirOpen, setDirOpen] = useState<Record<string, boolean>>({});
  const [editingNote, setEditingNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [fileHighlight, setFileHighlight] = useState<string | null>(null);
  const [banner, setBanner] = useState<BannerCounts | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [eagerFiles, setEagerFiles] = useState<ReadonlySet<string>>(new Set());
  const versionParam = useReviewVersion();
  const [briefs, setBriefs] = useState<Record<string, string> | null>(null);
  const hlTimer = useRef<number | undefined>(undefined);
  const ctxSlots = useLineSlots();
  const slots = useMemo(() => ({ ...ctxSlots, ...lineSlots }), [ctxSlots, lineSlots]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Private mode: prefs just don't persist.
    }
  }, [prefs]);

  // Snapshot: the guide column fetches it too; fetch here when absent so the
  // diff pane works standalone (tests, deep links). `?version=n` views an
  // older version read-only (PRD §8).
  useEffect(() => {
    if (snapshot) return;
    let cancelled = false;
    api
      .review(reviewId, versionParam)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap);
      })
      .catch(() => {
        // Service stubs return 501 until Service M1 lands; the pane shows loading.
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, versionParam, snapshot, setSnapshot]);

  // Refresh on open: a cheap fetch-and-compare, no agent time (PRD §8).
  // Skipped while viewing an older version, and a no-op for reviews with
  // no git source (demo). Counts come from the refresh `comparison`, or
  // from `versionStatus` already on the snapshot.
  const sourceRepoId = snapshot?.review.repoId;
  useEffect(() => {
    if (versionParam !== undefined || !sourceRepoId || sourceRepoId === "demo") return;
    let cancelled = false;
    api
      .refresh(reviewId)
      .then((r) => {
        if (cancelled) return;
        if (r.newVersion && r.comparison) {
          const snap = useReview.getState().snapshot;
          const current = snap?.review.currentVersion ?? r.comparison.newVersion;
          setBanner(comparisonToBanner(r.comparison, current));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) toast(refreshErrorNotice(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reviewId, versionParam, sourceRepoId]);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api.refresh(reviewId);
      if (r.newVersion && r.comparison) {
        const snap = useReview.getState().snapshot;
        const current = snap?.review.currentVersion ?? r.comparison.newVersion;
        setBanner(comparisonToBanner(r.comparison, current));
        setSnapshot(await api.review(reviewId));
      } else {
        setBanner(null);
        toast("Already up to date");
      }
    } catch (err) {
      toast(refreshErrorNotice(err));
    } finally {
      setRefreshing(false);
    }
  }, [reviewId, setSnapshot]);

  const onUpdated = useCallback(async () => {
    setBanner(null);
    try {
      setSnapshot(await api.review(reviewId));
      toast("Review updated");
    } catch {
      toast("Updated. Reload the page to see it.");
    }
  }, [reviewId, setSnapshot]);

  // Mock-only hidden-row brief copy (prototype BRIEF; M2's hunk pass
  // produces these per hunk). Code-split so production never loads it.
  useEffect(() => {
    if (import.meta.env.VITE_MOCK === "1") {
      import("../../mock/diff.js")
        .then((m) => setBriefs(m.HUNK_BRIEFS))
        .catch(() => {});
    }
  }, []);

  // #99: a stored summary holding the agent's raw JSON reads as absent,
  // so the hunk shows its Summarize action instead of the JSON text. The
  // stored row is untouched: the next summarize regenerates or clears it.
  const states = useMemo(
    () =>
      new Map<string, HunkUiState>(
        (snapshot?.hunkStates ?? []).map((s) => [
          s.contentHash,
          s.summary !== undefined && looksLikeJson(s.summary) ? { ...s, summary: undefined } : s,
        ]),
      ),
    [snapshot],
  );

  const reviewedCount = useCallback(
    (f: ReviewFile) => f.hunks.filter((h) => states.get(h.contentHash)?.reviewed).length,
    [states],
  );

  const cited = useMemo(
    () =>
      snapshot ? citedHunkHashes(snapshot.files, snapshot.pages, snapshot.annotations) : new Set<string>(),
    [snapshot],
  );

  const isHidden = useCallback(
    (h: Hunk) =>
      shouldHideHunk(h, {
        hideUninteresting: prefs.hideUninteresting,
        unhidden: !!unhidden[h.contentHash],
        cited: cited.has(h.contentHash),
      }),
    [prefs.hideUninteresting, unhidden, cited],
  );

  const cats = useMemo(() => new Set(prefs.cats), [prefs.cats]);
  const visible = useMemo(
    () =>
      snapshot ? filterFiles(snapshot.files, { query: fq, cats, hideReviewed: prefs.hideReviewed, reviewedCount }) : [],
    [snapshot, fq, cats, prefs.hideReviewed, reviewedCount],
  );

  const progress = useMemo(() => {
    const files = snapshot?.files ?? [];
    const total = files.reduce((s, f) => s + f.hunks.length, 0);
    const rev = files.reduce((s, f) => s + f.hunks.filter((h) => states.get(h.contentHash)?.reviewed).length, 0);
    return { reviewed: rev, total };
  }, [snapshot, states]);

  // Summarize is async (a job on the service, canned text in mock): the
  // button shows progress until the snapshot actually carries a summary.
  // Read the raw rows here, not the #99-filtered `states`: a landed summary
  // that looks like JSON still settles the request — the dots go away and
  // the hunk re-offers Summarize instead of showing the JSON text.
  useEffect(() => {
    setBusy((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const landed = new Set(
        (snapshot?.hunkStates ?? []).filter((s) => s.summary !== undefined).map((s) => s.contentHash),
      );
      let changed = false;
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (landed.has(k)) {
          delete next[k];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [snapshot]);

  const flash = useCallback((hl: Highlight | null, fileKey: string | null) => {
    window.clearTimeout(hlTimer.current);
    setHighlight(hl);
    setFileHighlight(fileKey);
    hlTimer.current = window.setTimeout(() => {
      setHighlight(null);
      setFileHighlight(null);
    }, 2600);
  }, []);

  const doReveal = useCallback(
    (target: RevealTarget) => {
      const snap = useReview.getState().snapshot;
      if (!snap) return;
      const file = snap.files.find((f) => f.fileKey === target.fileKey);
      if (!file) return;
      const st = new Map(snap.hunkStates.map((s) => [s.contentHash, s]));
      const fullyReviewed = file.hunks.every((h) => st.get(h.contentHash)?.reviewed);
      setPrefs((p) => ({
        ...p,
        cats: p.cats.includes(file.category) ? p.cats : [...p.cats, file.category],
        hideReviewed: p.hideReviewed && fullyReviewed ? false : p.hideReviewed,
      }));
      setFq((prev) => (file.path.toLowerCase().includes(prev.toLowerCase()) ? prev : ""));
      setFileFold((prev) => ({ ...prev, [file.fileKey]: false }));
      setEagerFiles((prev) => new Set(prev).add(file.fileKey));
      if (target.start === undefined) {
        flash(null, file.fileKey);
        return;
      }
      const end = target.end ?? target.start;
      setUnhidden((prev) => {
        const next = { ...prev };
        for (const h of file.hunks) if (hunkOverlaps(h, target.start as number, end)) next[h.contentHash] = true;
        return next;
      });
      // Unfold the overlapping hunks so the lines are visible (persisted,
      // like clicking "show" — the prototype has no persistence to keep).
      for (const h of file.hunks) {
        if (hunkOverlaps(h, target.start, end) && st.get(h.contentHash)?.folded) {
          api.updateHunk(reviewId, h.contentHash, { folded: false }).catch(() => {});
        }
      }
      flash({ fileKey: file.fileKey, start: target.start, end, nonce: Date.now() }, null);
    },
    [reviewId, flash],
  );

  useEffect(() => {
    if (!snapshot) return;
    const ref = takePendingReveal();
    if (ref) {
      const t = parseDiffRef(ref);
      if (t) doReveal(t);
    }
  }, [snapshot, doReveal]);

  useEffect(() => onRevealSource((_ref, target) => doReveal(target)), [doReveal]);

  // Mock-mode hook for Playwright: `window.__revealSource("diff:conn:82")`.
  useEffect(() => {
    if (import.meta.env.VITE_MOCK === "1") {
      (window as unknown as { __revealSource?: (ref: string) => boolean }).__revealSource = revealSource;
    }
  }, []);

  useEffect(() => {
    if (!highlight && !fileHighlight) return;
    const key = highlight?.fileKey ?? fileHighlight;
    if (!key) return;
    let el: HTMLElement | null = null;
    if (highlight) {
      for (let l = highlight.start; l <= highlight.end; l++) {
        el = document.getElementById(`L-${key}-${l}`);
        if (el) break;
      }
    }
    el ??= document.getElementById(`F-${key}`);
    // jsdom (unit tests) has no scrollIntoView; guard it.
    el?.scrollIntoView?.({ block: "center" });
  }, [highlight, fileHighlight]);

  useEffect(() => () => window.clearTimeout(hlTimer.current), []);

  // Older versions are view-only for user data (reviewed, notes,
  // summaries): those writes are refused with a pointer back. Folding only
  // hides code, so it stays allowed while browsing history.
  const readOnly =
    versionParam !== undefined && snapshot !== null && versionParam !== snapshot.review.currentVersion;

  const patchHunk = useCallback(
    async (hash: string, body: UpdateHunkRequest) => {
      if (readOnly && (body.reviewed !== undefined || body.note !== undefined || body.summary !== undefined)) {
        toast("Viewing an older version · read-only");
        return;
      }
      try {
        await api.updateHunk(reviewId, hash, body);
      } catch {
        toast("Couldn't save hunk state");
      }
    },
    [reviewId, readOnly],
  );

  const actions: HunkActions = useMemo(
    () => ({
      toggleFold: (hash, folded) => void patchHunk(hash, { folded: !folded }),
      summarize: (hash) => {
        if (readOnly) {
          toast("Viewing an older version · read-only");
          return;
        }
        setBusy((prev) => ({ ...prev, [hash]: true }));
        api.summarizeHunk(reviewId, hash).catch(() => {
          toast("Couldn't summarize the hunk");
          setBusy((prev) => {
            const next = { ...prev };
            delete next[hash];
            return next;
          });
        });
      },
      deleteSummary: (hash) => void patchHunk(hash, { summary: null }),
      beginNote: (hash, current) => {
        setEditingNote((prev) => ({ ...prev, [hash]: current ?? "" }));
        setTimeout(() => document.getElementById(`hn-${hash}`)?.focus(), 0);
      },
      changeNote: (hash, draft) => setEditingNote((prev) => ({ ...prev, [hash]: draft })),
      saveNote: (hash) => {
        const draft = (editingNote[hash] ?? "").trim();
        setEditingNote((prev) => {
          const next = { ...prev };
          delete next[hash];
          return next;
        });
        // Empty draft clears (service: explicit null deletes the note).
        void patchHunk(hash, { note: draft === "" ? null : draft });
      },
      discardNote: (hash) =>
        setEditingNote((prev) => {
          const next = { ...prev };
          delete next[hash];
          return next;
        }),
      deleteNote: (hash) => void patchHunk(hash, { note: null }),
      toggleReviewed: (hash, reviewed) => void patchHunk(hash, { reviewed: !reviewed, folded: !reviewed }),
    }),
    [patchHunk, reviewId, editingNote],
  );

  const setView = useCallback(
    (view: DiffViewMode) => {
      if (view === "split") window.dispatchEvent(new CustomEvent(WIDEN_EVENT));
      setPrefs((p) => ({ ...p, view }));
    },
    [],
  );

  const foldAll = useCallback(async () => {
    if (readOnly) {
      toast("Viewing an older version · read-only");
      return;
    }
    const snap = useReview.getState().snapshot;
    if (!snap) return;
    const st = new Map(snap.hunkStates.map((s) => [s.contentHash, s]));
    const targets: { file: ReviewFile; hunk: Hunk }[] = [];
    for (const f of filterFiles(snap.files, {
      query: fq,
      cats: new Set(prefs.cats),
      hideReviewed: prefs.hideReviewed,
      reviewedCount,
    })) {
      f.hunks.forEach((h) => {
        if (
          shouldHideHunk(h, {
            hideUninteresting: prefs.hideUninteresting,
            unhidden: !!unhidden[h.contentHash],
            cited: cited.has(h.contentHash),
          })
        ) {
          return;
        }
        targets.push({ file: f, hunk: h });
      });
    }
    // Fold first so the UI settles, then summarize hunks lacking one.
    await Promise.all(targets.map(({ hunk }) => api.updateHunk(reviewId, hunk.contentHash, { folded: true }).catch(() => {})));
    for (const { hunk } of targets) {
      if (!st.get(hunk.contentHash)?.summary) actions.summarize(hunk.contentHash);
    }
    toast(`Folded ${targets.length} ${targets.length === 1 ? "hunk" : "hunks"}. Summaries appear as they are written.`);
  }, [reviewId, readOnly, fq, prefs, reviewedCount, unhidden, cited, actions]);

  const unfoldAll = useCallback(async () => {
    if (readOnly) {
      toast("Viewing an older version · read-only");
      return;
    }
    const snap = useReview.getState().snapshot;
    if (!snap) return;
    setFileFold({});
    await Promise.all(
        snap.files.flatMap((f) => f.hunks.map((h) => api.updateHunk(reviewId, h.contentHash, { folded: false }).catch(() => {}))),
      );
    }, [reviewId, readOnly]);

  const markFileReviewed = useCallback(
    (file: ReviewFile, allReviewed: boolean) => {
      if (readOnly) {
        toast("Viewing an older version · read-only");
        return;
      }
      void Promise.all(
        file.hunks.map((h) =>
          api.updateHunk(reviewId, h.contentHash, { reviewed: !allReviewed, folded: !allReviewed }).catch(() => {}),
        ),
      ).catch(() => toast("Couldn't save that change"));
    },
    [reviewId, readOnly],
  );

  if (!snapshot) {
    return (
      <div>
        <div className="dtool">
          <span className="hint">Loading diff…</span>
        </div>
      </div>
    );
  }

  const tree: TreeRow[] = prefs.filesOpen ? buildFileTree(visible) : [];
  const catCount = (k: string): number => snapshot.files.filter((f) => f.category === k).length;

  // Update banner: the local refresh result wins; otherwise the snapshot's
  // own `versionStatus` (set when a refresh created a newer version).
  // Hidden while viewing an older version.
  const bannerCounts: BannerCounts | null = readOnly
    ? null
    : (banner ?? (snapshot.versionStatus ? statusToBanner(snapshot.versionStatus) : null));

  return (
    <div>
      <div className="dtool">
        <button
          className="tbtn"
          type="button"
          aria-expanded={prefs.filesOpen}
          data-tip={prefs.filesOpen ? "Hide file list" : "Show file list"}
          aria-label={prefs.filesOpen ? "Hide file list" : "Show file list"}
          onClick={() => setPrefs((p) => ({ ...p, filesOpen: !p.filesOpen }))}
        >
          <Icon name={prefs.filesOpen ? "down" : "right"} />
          Files <span className="hint">{visible.length}/{snapshot.files.length}</span>
        </button>
        <span className="seg" role="group" aria-label="Diff view">
          <button type="button" aria-pressed={prefs.view === "unified"} onClick={() => setView("unified")}>
            Unified
          </button>
          <button type="button" aria-pressed={prefs.view === "split"} onClick={() => setView("split")}>
            Split
          </button>
        </span>
        <button
          className="x"
          type="button"
          aria-pressed={prefs.hideUninteresting}
          data-tip="Collapse generated, import-only, docs and config hunks to one line"
          aria-label="Hide uninteresting"
          onClick={() =>
            setPrefs((p) => {
              if (!p.hideUninteresting) setUnhidden({});
              return { ...p, hideUninteresting: !p.hideUninteresting };
            })
          }
        >
          {prefs.hideUninteresting ? "✓ " : ""}Hide uninteresting
        </button>
        <button
          className="x"
          type="button"
          data-tip="Summarize every hunk with the agent, then fold the code"
          aria-label="Fold all"
          onClick={() => void foldAll()}
        >
          <Icon name="spark" />
          Fold all
        </button>
        <button
          className="x"
          type="button"
          data-tip="Show code for every folded hunk; summaries stay"
          aria-label="Unfold all"
          onClick={() => void unfoldAll()}
        >
          Unfold all
        </button>
        <button
          className="x"
          type="button"
          data-tip="Check the branch for new commits. Doesn't use the agent."
          aria-label="Refresh"
          disabled={refreshing || readOnly}
          onClick={() => void doRefresh()}
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {readOnly ? (
        <div className="dbar" role="status">
          <span className="hint">Viewing v{versionParam} · read-only</span>
        </div>
      ) : null}
      {bannerCounts ? (
        <VersionBanner reviewId={reviewId} counts={bannerCounts} onUpdated={() => void onUpdated()} />
      ) : null}
      {prefs.filesOpen ? (
        <div className="files">
          <div className="frow">
            <input
              type="search"
              id="fq"
              placeholder="Filter files by name"
              aria-label="Filter files by name"
              value={fq}
              onChange={(e) => setFq(e.target.value)}
            />
            <FilterDropdown
              cats={cats}
              hideReviewed={prefs.hideReviewed}
              catCount={catCount}
              reviewedFiles={snapshot.files.filter((f) => reviewedCount(f) === f.hunks.length).length}
              onToggleCat={(k) =>
                setPrefs((p) => ({
                  ...p,
                  cats: p.cats.includes(k) ? p.cats.filter((x) => x !== k) : [...p.cats, k],
                }))
              }
              onToggleReviewed={() => setPrefs((p) => ({ ...p, hideReviewed: !p.hideReviewed }))}
            />
          </div>
          <div className="prog">
            <span>
              {progress.reviewed}/{progress.total} hunks reviewed
            </span>
            <span className="bar">
              <i style={{ width: `${progress.total === 0 ? 0 : Math.round((100 * progress.reviewed) / progress.total)}%` }} />
            </span>
          </div>
          <div className="flist">
            {tree.length > 0 ? (
              tree.map((row) =>
                row.type === "dir" ? (
                  <button
                    key={`dir-${row.path}`}
                    className="fr dir"
                    type="button"
                    style={{ paddingLeft: 10 + row.depth * 14 }}
                    aria-expanded={dirOpen[row.path] ?? true}
                    onClick={() => setDirOpen((prev) => ({ ...prev, [row.path]: !(prev[row.path] ?? true) }))}
                  >
                    <Icon name={dirOpen[row.path] ?? true ? "down" : "right"} />
                    <span className="nm" title={row.path}>
                      {row.label}
                    </span>
                  </button>
                ) : (
                  <FileTreeRow
                    key={`file-${row.file.fileKey}`}
                    file={row.file}
                    depth={row.depth}
                    reviewed={reviewedCount(row.file)}
                    onJump={(key) => {
                      setFileFold((prev) => ({ ...prev, [key]: false }));
                      setEagerFiles((prev) => new Set(prev).add(key));
                      setTimeout(() => {
                        const el = document.getElementById(`F-${key}`);
                        const stick = document.querySelector("#right .rstick");
                        if (!el) return;
                        // Scroll within the pane, keeping the sticky toolbar visible.
                        const pane = document.getElementById("right");
                        if (pane && stick) {
                          pane.scrollTop += el.getBoundingClientRect().top - stick.getBoundingClientRect().bottom;
                        } else {
                          el.scrollIntoView({ block: "start" });
                        }
                      }, 0);
                    }}
                  />
                ),
              )
            ) : (
              <p className="hint" style={{ padding: "4px 10px", margin: 0 }}>
                No files match the filters.
              </p>
            )}
          </div>
        </div>
      ) : null}
      {visible.length > 0 ? (
        visible.map((f, vi) => (
          // One boundary per file section: a file that fails to render
          // shows a file-shaped notice instead of blanking the whole pane.
          <ErrorBoundary
            key={f.fileKey}
            name="diff-file"
            resetKey={`${reviewId}:${f.fileKey}`}
            fallback={({ reset }) => (
              <div className="dfile" id={`F-${f.fileKey}`}>
                <InlineFallback message="Couldn't show this file: something went wrong" onRetry={reset} />
              </div>
            )}
          >
            <FileSection
              file={f}
              view={prefs.view}
              reviewed={reviewedCount(f)}
              folded={!!fileFold[f.fileKey]}
              eager={vi < 3 || eagerFiles.has(f.fileKey)}
              busy={busy}
              editingNote={editingNote}
              slots={slots}
              commentedLines={commentedLines ?? new Set()}
              highlight={highlight?.fileKey === f.fileKey ? { start: highlight.start, end: highlight.end } : null}
              fileHighlighted={fileHighlight === f.fileKey}
              briefs={briefs}
              states={states}
              isHidden={isHidden}
              actions={actions}
              onLineClick={onLineClick}
              onToggleFileFold={(key) => setFileFold((prev) => ({ ...prev, [key]: !prev[key] }))}
              onMarkFileReviewed={markFileReviewed}
              onUnhide={(hashes) => setUnhidden((prev) => ({ ...prev, ...Object.fromEntries(hashes.map((h) => [h, true])) }))}
            />
          </ErrorBoundary>
        ))
      ) : (
        <p className="hint" style={{ padding: 16 }}>
          No files match the filters.
        </p>
      )}
    </div>
  );
}

function FilterDropdown({
  cats,
  hideReviewed,
  catCount,
  reviewedFiles,
  onToggleCat,
  onToggleReviewed,
}: {
  cats: ReadonlySet<string>;
  hideReviewed: boolean;
  catCount: (k: string) => number;
  reviewedFiles: number;
  onToggleCat: (k: string) => void;
  onToggleReviewed: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const ctlRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Checked = shown. Default: every category + Reviewed shown.
  const rows: { key: string; label: string; checked: boolean; count: number; toggle: () => void }[] = [
    ...CATS.map((c) => ({
      key: c.k,
      label: c.l,
      checked: cats.has(c.k),
      count: catCount(c.k),
      toggle: () => onToggleCat(c.k),
    })),
    {
      key: "__reviewed",
      label: "Reviewed",
      checked: !hideReviewed,
      count: reviewedFiles,
      toggle: onToggleReviewed,
    },
  ];
  const activeCount = CATS.length - cats.size + (hideReviewed ? 1 : 0);
  const active = activeCount > 0;

  // Close on outside press or Escape, like the other dropdowns
  // (SecondOpinionControl, Tips, CommentsMenu).
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent): void => {
      if (!ctlRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  // Focus the first row on open so Arrow keys work immediately; Esc
  // returns focus to the button above.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open ]);

  const move = (dir: 1 | -1): void => {
    const el = document.activeElement as HTMLElement | null;
    const at = itemRefs.current.findIndex((b) => b === el);
    const next = at < 0 ? (dir === 1 ? 0 : rows.length - 1) : (at + dir + rows.length) % rows.length;
    itemRefs.current[next]?.focus();
  };

  return (
    <span className="fctl" ref={ctlRef}>
      <button
        ref={btnRef}
        className="tbtn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active}
        aria-label="File filters"
        title="Filter files by type"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        Filter
        {active ? <span className="count">{activeCount}</span> : null}
      </button>
      {open ? (
        <div
          className="fmenu"
          role="menu"
          aria-label="File filters"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Home") {
              e.preventDefault();
              itemRefs.current[0]?.focus();
            } else if (e.key === "End") {
              e.preventDefault();
              itemRefs.current[rows.length - 1]?.focus();
            }
          }}
        >
          {rows.map((r, i) => (
            <button
              key={r.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitemcheckbox"
              aria-checked={r.checked}
              onClick={r.toggle}
            >
              <span className="tick" aria-hidden="true">
                {r.checked ? "✓" : ""}
              </span>
              <span className="lbl">{r.label}</span>
              <span className="cnt">{r.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function FileTreeRow({
  file,
  depth,
  reviewed,
  onJump,
}: {
  file: ReviewFile;
  depth: number;
  reviewed: number;
  onJump: (fileKey: string) => void;
}): ReactNode {
  const total = file.hunks.length;
  const added = file.hunks.reduce((s, h) => s + h.added, 0);
  const removed = file.hunks.reduce((s, h) => s + h.removed, 0);
  return (
    <button
      className="fr"
      type="button"
      style={{ paddingLeft: 10 + depth * 14 + 20 }}
      title={file.path}
      onClick={() => onJump(file.fileKey)}
    >
      <span className="nm">{file.path.split("/").pop()}</span>
      {file.category === "generated" ? <span className="gtag">gen</span> : null}
      <span className="st">
        <span className="a">+{added}</span> <span className="d">−{removed}</span>
      </span>
      <span className={`rv${reviewed === total ? " done" : ""}`}>{reviewed === total ? "✓" : `${reviewed}/${total}`}</span>
    </button>
  );
}
