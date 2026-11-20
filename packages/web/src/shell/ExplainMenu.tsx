/**
 * Explain menu (issues #421, #427): the review bar's entry point for
 * Explain-since-X. An icon-only borderless `button.ib` (Tabler
 * `history`) right after the Pull button. It opens the same `.fmenu`
 * portal menu PersonaButton uses — no hand-rolled popover:
 *
 * - **Dot:** when the PR has commits newer than the commit the current
 *   guide was written at (`guideHead`), the button carries the diff
 *   filter chip's dot (`.fdot`) and the tooltip/aria-label read "N new
 *   commit(s) since the guide was written"; otherwise "Explain changes
 *   since…".
 * - **First item,** only with new commits: "Explain changes since the
 *   guide" — runs Explain from the guide's commit.
 * - **Commits group,** newest first. Each row shows the sha (the
 *   hunk-header `.revc`: mono, muted, slightly smaller), the subject
 *   (ellipsising, with the full subject as a tooltip only while
 *   truncated, like #406's PlotName), the hints that apply (`guide`,
 *   `new`, `your last review`, `latest` — a commit can carry several,
 *   rendered as the existing `cnt` hint spans), and a right-aligned
 *   muted relative time (`shortAge`, exact timestamp on hover).
 *   The head is the first commit row, disabled (`latest` — explaining
 *   from it is an empty range the route refuses). Picking any enabled
 *   commit runs Explain from it.
 *   Newest first (issue #431) puts the latest, new and guide rows at
 *   the top, in view on open without scrolling; the menu is 400px
 *   (clamped to the viewport) so typical subjects fit.
 * - **Your last GitHub review** stays a separate row only when its
 *   commit isn't in the list (already there via `priorInList`).
 *
 * No versions anywhere. Picking an item runs Explain at once through
 * the existing explain route (one agent call); the button shows the
 * busy state while it runs. Failures and the empty result toast — the
 * toolbar sits above both panes, so a toast reaches the reader
 * wherever they are.
 *
 * Hidden wherever the Pull button hides (document reviews, the static
 * demo) and when nothing is pickable (one commit, no earlier review).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { exactTime, isDocumentReview, newerCommitsSince, shortAge } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { STATIC_DEMO } from "../demo.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { priorReviewDate, usePriorGithubReview } from "../guide/usePriorGithubReview.js";
import { useExplainPass } from "../guide/useExplainPass.js";

/** True when a sha names the head (exact or unambiguous prefix). Pure. */
function isHeadSha(head: string, sha: string): boolean {
  const h = head.toLowerCase();
  const s = sha.toLowerCase();
  return s === h || h.startsWith(s) || s.startsWith(h);
}

/** True for the same commit (exact, case-insensitive). Pure. */
function isSameSha(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * One commit row's label (issue #431): the sha in the hunk-header
 * treatment (mono, muted, slightly smaller — the existing `.revc`)
 * plus the subject, ellipsising in place. Like #406's PlotName, it
 * carries the full `sha + subject` as a tooltip only while the label
 * is actually truncated (measured, re-checked on resize).
 */
function CommitLabel({ short, subject }: { short: string; subject: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = (): void => setCut(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [short, subject]);
  return (
    <span ref={ref} className="lbl" {...(cut ? { "data-tip": `${short} ${subject}` } : {})}>
      <span className="revc">{short}</span> {subject}
    </span>
  );
}

export function ExplainMenu({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const snapshot = useReview((s) => s.snapshot);
  const prior = usePriorGithubReview(reviewId);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 400 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The run toasts (failures and the empty result use the existing
  // messages). The ref keeps a terminal phase from toasting twice
  // across re-renders.
  const toasted = useRef<string | null>(null);
  const { phase, start } = useExplainPass(reviewId, (stored) => {
    if (stored) toast("Review updated");
  });
  useEffect(() => {
    if (phase.name === "failed" || phase.name === "empty") {
      const key = `${phase.name}:${phase.name === "failed" ? phase.message : phase.label}`;
      if (toasted.current !== key) {
        toasted.current = key;
        toast(
          phase.name === "failed" ? phase.message : `No changes to explain since ${phase.label}`,
        );
      }
    } else if (phase.name === "idle") {
      toasted.current = null;
    }
  }, [phase]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  if (!snapshot || STATIC_DEMO || isDocumentReview(snapshot)) return null;
  // The route refuses Explain while the review is still opening.
  if ((snapshot.ingest.status ?? "ready") !== "ready") return null;

  const commits = snapshot.commits ?? [];
  const head = snapshot.version.headSha;
  // The guide's commit: the range start for the dot, the first item and
  // the hints. Empty before the reader lands (no guide yet).
  const guideSha = snapshot.guideHead.sha;
  const guideIdx = guideSha === "" ? -1 : commits.findIndex((c) => isSameSha(c.sha, guideSha));
  // A rewrite may have moved the guide's commit out of the list — then
  // the whole listed range counts (the old banner's fallback).
  const newer = guideSha === "" ? 0 : (guideIdx >= 0 ? (newerCommitsSince(commits, guideSha) ?? 0) : commits.length);
  const hasNew = newer > 0;
  const earlier = commits.filter((c) => !isHeadSha(head, c.sha));
  const priorPickable =
    prior !== undefined && prior !== null && !isHeadSha(head, prior.sha) ? prior : null;
  if (earlier.length === 0 && !priorPickable) return null;
  // Owner (#421): when the last review's commit is already listed, mark
  // that row instead of adding a second row for the same commit; the
  // separate row stays only when the commit isn't in the list (e.g. it
  // was rebased away).
  const priorInList =
    priorPickable !== null && commits.some((c) => isHeadSha(c.sha, priorPickable.sha));
  // Issue #431: newest first — the latest, new and guide rows sit at
  // the top, in view on open. Each entry carries its oldest-first
  // index so the `new` hint still counts from the guide's commit.
  const orderedCommits = commits.map((c, idx) => ({ c, idx })).reverse();

  const busy = phase.name === "explaining";
  const label = hasNew
    ? `${newer} new commit${newer === 1 ? "" : "s"} since the guide was written`
    : "Explain changes since…";
  return (
    <>
      <button
        className="ib hist"
        type="button"
        ref={btnRef}
        data-testid="explain-menu-button"
        data-tip={busy ? "Working…" : label}
        aria-label={busy ? "Working…" : label}
        title={busy ? "Working…" : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={() => {
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) {
            // The button sits at the bar's left edge, so the wide menu
            // left-aligns to it (right-aligning would clamp it into the
            // viewport corner); otherwise the PersonaButton placement.
            // Issue #431: 400px so typical subjects fit, clamped to the
            // viewport; the hints and the time stay on the row.
            const width = Math.min(400, window.innerWidth - 16);
            setPos({
              top: Math.min(rect.bottom + 4, window.innerHeight - 8),
              left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
              width,
            });
          }
          setOpen((v) => !v);
        }}
      >
        {busy ? (
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            <Icon name="history" />
            {hasNew ? <span className="fdot" data-new-commits="" aria-hidden="true" /> : null}
          </>
        )}
      </button>
      {open
        ? createPortal(
            <div
              className="fmenu"
              role="menu"
              aria-label={label}
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
              data-testid="explain-menu"
            >
              {hasNew ? (
                <button
                  type="button"
                  role="menuitem"
                  data-explain-guide={guideSha}
                  title={`Explain changes since ${guideSha.slice(0, 8)} (the guide's commit)`}
                  onClick={() => {
                    setOpen(false);
                    start({ sha: guideSha });
                  }}
                >
                  <span className="lbl">Explain changes since the guide</span>
                </button>
              ) : null}
              <div className="fgroup" role="presentation">
                Commits
              </div>
              {orderedCommits.map(({ c, idx }) => {
                const isHead = isHeadSha(head, c.sha);
                const isGuide = guideSha !== "" && isSameSha(c.sha, guideSha);
                const isNewCommit = guideIdx >= 0 && idx > guideIdx;
                const isPrior = priorInList && isHeadSha(c.sha, priorPickable.sha);
                const short = c.sha.slice(0, 8);
                const text = `${short} ${c.subject}`;
                const hints = [
                  ...(isGuide ? ["guide"] : []),
                  ...(isNewCommit ? ["new"] : []),
                  ...(isPrior ? ["your last review"] : []),
                  ...(isHead ? ["latest"] : []),
                ];
                return (
                  <button
                    key={c.sha}
                    type="button"
                    role="menuitem"
                    data-explain-commit={c.sha}
                    disabled={isHead}
                    aria-disabled={isHead || undefined}
                    title={hints.length > 0 ? `${text} (${hints.join(", ")})` : text}
                    onClick={
                      isHead
                        ? undefined
                        : () => {
                            setOpen(false);
                            start({ sha: c.sha });
                          }
                    }
                  >
                    <CommitLabel short={short} subject={c.subject} />
                    {isGuide ? <span className="cnt">guide</span> : null}
                    {isNewCommit ? <span className="cnt">new</span> : null}
                    {isPrior ? <span className="cnt">your last review</span> : null}
                    {isHead ? <span className="cnt">latest</span> : null}
                    <span className="cnt" data-tip={exactTime(c.committedAt)}>{shortAge(c.committedAt)}</span>
                  </button>
                );
              })}
              {priorPickable && !priorInList ? (
                <button
                  key={`prior:${priorPickable.sha}`}
                  type="button"
                  role="menuitem"
                  data-explain-prior={priorPickable.sha}
                  title={`Your last GitHub review (${priorPickable.sha.slice(0, 8)}${
                    priorReviewDate(priorPickable.submittedAt)
                      ? `, ${priorReviewDate(priorPickable.submittedAt)}`
                      : ""
                  })`}
                  onClick={() => {
                    setOpen(false);
                    start({ sha: priorPickable.sha });
                  }}
                >
                  <span className="lbl">Your last GitHub review</span>
                  <span className="cnt">
                    {priorPickable.sha.slice(0, 8)}
                    {priorReviewDate(priorPickable.submittedAt)
                      ? ` · ${priorReviewDate(priorPickable.submittedAt)}`
                      : ""}
                  </span>
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
