/**
 * App shell: guide column (left) + source pane (right) with a drag handle.
 *
 * Mirrors the prototype's layout rules:
 * - docked at window widths >= 900px, overlay below that;
 * - handle: pointer drag + ArrowLeft/ArrowRight (±40px),
 *   clamped to [320, innerWidth - 420];
 * - default width max(400, min(820, w * 0.42)) until the user changes it.
 *
 * The review bar's `[ Guide | Source ]` selector toggles each pane
 * (issue #83): both on is the two-pane layout; either pane alone fills
 * the window. At least one pane stays visible: turning off the only
 * visible pane switches to the other. The split width (`unvibe.paneWidth`)
 * is never overwritten by a full-width state, so restoring two panes
 * restores it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GuidePage } from "../guide/GuidePage.js";
import { useReview } from "../state/store.js";
import { REVEAL_EVENT } from "../source/diff/revealSource.js";
import { SourcePane } from "../source/SourcePane.js";
import { WIDEN_EVENT } from "../source/diff/DiffView.js";
import { SHOW_GUIDE_EVENT } from "./panes.js";
import { TopBar } from "./TopBar.js";

const DOCK_WIDTH = 900;
const PANE_WIDTH_KEY = "unvibe.paneWidth";

function clampWidth(v: number): number {
  return Math.max(320, Math.min(window.innerWidth - 420, v));
}

function defaultWidth(): number {
  try {
    const saved = Number(localStorage.getItem(PANE_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= 320) return clampWidth(saved);
  } catch {
    // Private mode: fall through to the default.
  }
  const w = window.innerWidth;
  return Math.max(400, Math.min(820, Math.round(w * 0.42)));
}

export function AppShell({ reviewId }: { reviewId: string }) {
  // Issue #222: document reviews have no source pane in phase 1 (the code
  // browser is phase 2) — the document fills the window.
  const isDocument = useReview((s) => s.snapshot?.review.kind === "document");
  const [guideOpen, setGuideOpen] = useState(true);
  const [sourceOpen, setSourceOpen] = useState<boolean | null>(null); // null = follow width
  const [paneWidth, setPaneWidth] = useState<number>(() => defaultWidth());
  const [tab, setTab] = useState<"desc" | "diff">("diff");
  const drag = useRef<{ x0: number; w0: number } | null>(null);

  const sourceVisible = !isDocument && (sourceOpen ?? window.innerWidth >= DOCK_WIDTH);
  const docked = window.innerWidth >= DOCK_WIDTH && guideOpen && sourceVisible;

  // Pane toggles (issue #83): each segment toggles its pane, and turning
  // off the only visible pane switches to the other one instead.
  const toggleSource = useCallback(() => {
    if (sourceVisible && !guideOpen) {
      setGuideOpen(true);
      setSourceOpen(false);
    } else {
      setSourceOpen(!sourceVisible);
    }
  }, [sourceVisible, guideOpen]);
  const toggleGuide = useCallback(() => {
    if (guideOpen && !sourceVisible) {
      setSourceOpen(true);
      setGuideOpen(false);
    } else {
      setGuideOpen(!guideOpen);
    }
  }, [guideOpen, sourceVisible]);

  // Re-render on resize so dock/overlay follows the window.
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = (): void => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // `revealSource` (guide citations): open the pane. Tab switching lives
  // in `SourcePane` (it inspects the ref); the diff pane scrolls and
  // highlights once mounted. The guide stays as it is, so revealing from
  // a guide-only layout restores the two-pane layout.
  useEffect(() => {
    const onReveal = (): void => {
      setSourceOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);

  // Navigation to guide content from the source pane ("Open as page",
  // "Restated →", the comments menu jumping to a guide thread) while only
  // the source pane is showing: bring the guide back without hiding the
  // source pane.
  useEffect(() => {
    const onShowGuide = (): void => {
      setGuideOpen(true);
    };
    window.addEventListener(SHOW_GUIDE_EVENT, onShowGuide);
    return () => window.removeEventListener(SHOW_GUIDE_EVENT, onShowGuide);
  }, []);

  // Persist the pane width (a diff view preference, PRD §4.13).
  useEffect(() => {
    try {
      localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth));
    } catch {
      // Private mode: ignore.
    }
  }, [paneWidth]);

  // Choosing Split in a narrow pane widens it (prototype rule). A no-op
  // while the source pane is full width (guide closed).
  useEffect(() => {
    const onWiden = (): void => {
      if (!guideOpen) return;
      setPaneWidth((w) =>
        w < window.innerWidth * 0.48 ? clampWidth(Math.round(window.innerWidth * 0.52)) : w,
      );
    };
    window.addEventListener(WIDEN_EVENT, onWiden);
    return () => window.removeEventListener(WIDEN_EVENT, onWiden);
  }, [guideOpen]);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      drag.current = { x0: e.clientX, w0: paneWidth };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [paneWidth],
  );
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setPaneWidth(clampWidth(d.w0 + (d.x0 - e.clientX)));
  }, []);
  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);
  const onHandleKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") setPaneWidth((w) => clampWidth(w + 40));
      else if (e.key === "ArrowRight") setPaneWidth((w) => clampWidth(w - 40));
    },
    [],
  );

  // Source-only is a plain full-width section at any window width; the
  // overlay only covers the guide when both panes are on in a narrow
  // window.
  const rightClass = "col" + (!sourceVisible ? " hide" : docked || !guideOpen ? "" : " overlay");
  const guideClass = "col" + (guideOpen ? "" : " hide");

  return (
    <div className="app with-reviewbar">
      <TopBar
        reviewId={reviewId}
        guideOpen={guideOpen}
        sourceOpen={sourceVisible}
        onToggleGuide={toggleGuide}
        onToggleSource={toggleSource}
      />
      <div
        className="cols"
        style={{ gridTemplateColumns: docked ? `minmax(0, 1fr) 6px ${paneWidth}px` : "minmax(0, 1fr)" }}
      >
        <main className={guideClass} id="page">
          <GuidePage reviewId={reviewId} />
        </main>
        <div
          id="handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize source pane"
          tabIndex={0}
          hidden={!docked}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onHandleKey}
        />
        <section className={rightClass} id="right" aria-label="Description, files and diff">
          <SourcePane reviewId={reviewId} tab={tab} onTab={setTab} />
        </section>
      </div>
    </div>
  );
}
