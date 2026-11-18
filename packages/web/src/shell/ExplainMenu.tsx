/**
 * Explain menu (issue #421): the review bar's entry point for
 * Explain-since-X. An icon-only borderless `button.ib` (Tabler
 * `history`) right after the Pull button, tooltip and aria-label
 * "Explain changes since…". It opens the same `.fmenu` portal menu
 * PersonaButton uses — no hand-rolled popover:
 *
 * - **Commits:** all the PR's commits oldest first as
 *   `<sha8> <subject>`, with the head commit shown disabled ("latest"
 *   hint — explaining from it is an empty range the route refuses).
 * - **Your last GitHub review:** when one exists and isn't the head —
 *   a named row even when its commit is also listed above.
 *
 * No versions anywhere. Picking an item runs Explain at once through
 * the existing explain route (one agent call); the button shows the
 * busy state while it runs. Failures and the empty result toast — the
 * toolbar sits above both panes, so a toast reaches the reader
 * wherever they are (the section/banner inline slots may be on the
 * other pane or off-screen).
 *
 * Hidden wherever the Pull button hides (document reviews, the static
 * demo) plus on old versions (read-only) and when nothing is pickable
 * (one commit, no earlier review).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isDocumentReview } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { STATIC_DEMO } from "../demo.js";
import { toast } from "../floating/Toast.js";
import { useReview } from "../state/store.js";
import { priorReviewDate, usePriorGithubReview } from "../guide/usePriorGithubReview.js";
import { useExplainPass } from "../guide/useExplainPass.js";
import { useReviewVersion } from "../versions/useReviewVersion.js";

/** True when a sha names the head (exact or unambiguous prefix). Pure. */
function isHeadSha(head: string, sha: string): boolean {
  const h = head.toLowerCase();
  const s = sha.toLowerCase();
  return s === h || h.startsWith(s) || s.startsWith(h);
}

export function ExplainMenu({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const snapshot = useReview((s) => s.snapshot);
  const prior = usePriorGithubReview(reviewId);
  const versionParam = useReviewVersion();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The run toasts (failures and the empty result use the existing
  // messages); a stored run toasts like the banner's does. The ref
  // keeps a terminal phase from toasting twice across re-renders.
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
  if (versionParam !== undefined && versionParam !== snapshot.review.currentVersion) return null;
  // The route refuses Explain while the review is still opening.
  if ((snapshot.ingest.status ?? "ready") !== "ready") return null;

  const commits = snapshot.commits ?? [];
  const head = snapshot.version.headSha;
  const earlier = commits.filter((c) => !isHeadSha(head, c.sha));
  const priorPickable =
    prior !== undefined && prior !== null && !isHeadSha(head, prior.sha) ? prior : null;
  if (earlier.length === 0 && !priorPickable) return null;

  const busy = phase.name === "explaining";
  const label = "Explain changes since…";
  return (
    <>
      <button
        className="ib"
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
            const width = 320;
            setPos({
              top: Math.min(rect.bottom + 4, window.innerHeight - 8),
              left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
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
          <Icon name="history" />
        )}
      </button>
      {open
        ? createPortal(
            <div
              className="fmenu"
              role="menu"
              aria-label={label}
              ref={menuRef}
              style={{ position: "fixed", top: pos.top, left: pos.left, width: 320 }}
              data-testid="explain-menu"
            >
              <div className="fgroup" role="presentation">
                Commits
              </div>
              {commits.map((c) => {
                const isHead = isHeadSha(head, c.sha);
                const short = c.sha.slice(0, 8);
                const text = `${short} ${c.subject}`;
                return (
                  <button
                    key={c.sha}
                    type="button"
                    role="menuitem"
                    data-explain-commit={c.sha}
                    disabled={isHead}
                    aria-disabled={isHead || undefined}
                    title={isHead ? `${text} (latest)` : text}
                    onClick={
                      isHead
                        ? undefined
                        : () => {
                            setOpen(false);
                            start({ sha: c.sha });
                          }
                    }
                  >
                    <span className="lbl">{text}</span>
                    {isHead ? <span className="cnt">latest</span> : null}
                  </button>
                );
              })}
              {priorPickable ? (
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
