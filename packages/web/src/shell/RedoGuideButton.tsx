/**
 * Re-do guide (#345, moved from the Debug page where it lived as
 * `RedoGuideSection`, issue #115): delete + create in one step from an
 * icon button in the review top bar.
 *
 * Reuses the existing delete and create paths through one service call,
 * so "same as delete + create" stays true by construction: the review
 * gets a new id and the page navigates to its loading state (the same
 * page a fresh open lands on). Never offered for the demo review;
 * hidden when ingest failed or is empty; disabled with a reason while
 * the review is still opening.
 *
 * Issue #393: next to Re-do guide, a Re-do with <persona> choice for
 * each enabled guide-capable persona (from `GET /api/prompt-forks`).
 * Choosing one confirms first (the same copy naming the persona, the
 * same inline refusal handling) and re-does through the same call with
 * the persona id; the new review records it. With no guide-capable
 * persona the button confirms the plain re-do directly, exactly as
 * before.
 *
 * The confirm is #346's shared inline confirm with a toolbar icon
 * button as its idle control: clicking it drops a "Confirm re-do
 * guide" pill with ✓ and ✕ below the button (menu-style, so the
 * pill never covers the review identity). The what-is-lost copy lives in
 * the pill's accessible name; a rejection stays inline in the pill
 * (retry or cancel), so nothing is squeezed into the bar's row.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { PromptForkStatus } from "@unvibe/shared";
import { api, friendlyError } from "../api/client.js";
import { Icon } from "../components/Icon.js";
import { STATIC_DEMO } from "../demo.js";
import { useReview } from "../state/store.js";
import { InlineConfirm } from "../ui/index.js";

const CONFIRM_COPY =
  "Remove the guide, comments, notes and jobs, and open this change again as a new review? " +
  "Anything already on GitHub stays there.";

function confirmCopy(name: string | null): string {
  if (name === null) return CONFIRM_COPY;
  return (
    `Remove the guide, comments, notes and jobs, and open this change again with ${name} as the guide? ` +
    "Anything already on GitHub stays there."
  );
}

export function RedoGuideButton({ reviewId }: { reviewId: string }): React.JSX.Element | null {
  const navigate = useNavigate();
  const snapshot = useReview((s) => s.snapshot);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [forks, setForks] = useState<PromptForkStatus[] | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMenuOpen(false);
    setConfirming(null);
  }, [reviewId]);

  // The Re-do with choices behind the menu (issue #393). Failure keeps
  // the plain re-do, exactly as before — never a broken menu.
  useEffect(() => {
    let cancelled = false;
    api
      .promptForks()
      .then((r) => {
        if (!cancelled) setForks(r.forks);
      })
      .catch(() => {
        if (!cancelled) setForks([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (snapshot === null || STATIC_DEMO) return null;
  if (snapshot.review.repoId === "demo") return null;
  const ingestStatus = snapshot.ingest?.status ?? "ready";
  // The review page's Retry owns reviews that failed to open.
  if (ingestStatus === "failed" || ingestStatus === "empty") return null;

  const choices = (forks ?? []).filter((f) => f.enabled && f.guideCapable);
  const confirmingName =
    confirming === null || confirming === "guide"
      ? null
      : (choices.find((c) => c.personaId === confirming)?.name ?? confirming);

  const redo = async (choice: string): Promise<void> => {
    const snap = await api.redoReview(reviewId, choice === "guide" ? undefined : choice);
    navigate(`/review/${encodeURIComponent(snap.review.id)}`);
  };

  if (ingestStatus === "loading") {
    return (
      <button
        className="ib bd"
        type="button"
        data-tip="The review is still opening."
        aria-label="Re-do guide"
        title="The review is still opening."
        disabled
      >
        <Icon name="redo" />
      </button>
    );
  }

  // No guide-capable persona: the plain confirm, exactly as before.
  if (choices.length === 0) {
    return (
      <InlineConfirm
        action="Re-do guide"
        confirmAction="re-do guide"
        runningLabel="Re-doing…"
        danger
        size="sm"
        placement="below"
        open={confirming !== null}
        onOpenChange={(v) => {
          if (!v) setConfirming(null);
          else setConfirming("guide");
        }}
        onConfirm={() => redo("guide")}
        formatError={(err) => `Couldn't re-do the guide: ${friendlyError(err)}`}
        announce={`${CONFIRM_COPY} Confirm re-do guide, or cancel.`}
        idleRender={({ ref, expanded, disabled, onOpen }) => (
          <button
            ref={ref}
            className="ib bd"
            type="button"
            data-tip="Re-do guide"
            aria-label="Re-do guide"
            aria-expanded={expanded}
            title="Re-do guide"
            disabled={disabled}
            onClick={onOpen}
          >
            <Icon name="redo" />
          </button>
        )}
      />
    );
  }

  const copy = confirmCopy(confirmingName);
  return (
    <>
      <InlineConfirm
        action={confirmingName === null ? "Re-do guide" : `Re-do with ${confirmingName}`}
        confirmAction={confirmingName === null ? "re-do guide" : `re-do with ${confirmingName}`}
        runningLabel="Re-doing…"
        danger
        size="sm"
        placement="below"
        open={confirming !== null}
        onOpenChange={(v) => {
          if (!v) setConfirming(null);
        }}
        onConfirm={() => redo(confirming ?? "guide")}
        formatError={(err) => `Couldn't re-do the guide: ${friendlyError(err)}`}
        announce={`${copy} Confirm, or cancel.`}
        idleRender={({ ref, expanded, disabled }) => (
          <button
            ref={(el) => {
              btnRef.current = el;
              // The confirm's own ref (a useRef object: mutable at run
              // time, readonly in the React 19 types) keeps pill focus.
              if (typeof ref === "function") ref(el);
              else if (ref !== null && typeof ref === "object") {
                (ref as { current: HTMLButtonElement | null }).current = el;
              }
            }}
            className="ib bd"
            type="button"
            data-tip="Re-do guide"
            aria-label="Re-do guide"
            aria-haspopup="menu"
            aria-expanded={menuOpen || expanded}
            title="Re-do guide"
            disabled={disabled}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <Icon name="redo" />
          </button>
        )}
      />
      {menuOpen
        ? createPortal(
            <div className="fmenu" role="menu" ref={menuRef} data-testid="redo-menu" style={menuStyle(btnRef.current)}>
              <button
                key="guide"
                type="button"
                role="menuitem"
                data-testid="redo-guide"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirming("guide");
                }}
              >
                <span className="lbl">Re-do guide</span>
              </button>
              {choices.map((c) => (
                <button
                  key={c.personaId}
                  type="button"
                  role="menuitem"
                  data-testid={`redo-with-${c.personaId}`}
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirming(c.personaId);
                  }}
                >
                  <span className="lbl">Re-do with {c.name}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Menu position under the button (the card persona menu's placement). */
function menuStyle(btn: HTMLButtonElement | null): CSSProperties {
  const rect = btn?.getBoundingClientRect();
  const width = 240;
  if (!rect) return { position: "fixed", top: 0, left: 0, width };
  return {
    position: "fixed",
    top: Math.min(rect.bottom + 4, window.innerHeight - 8),
    left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    width,
  };
}
