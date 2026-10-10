/**
 * App shell: guide column (left) + source pane (right) with a drag handle.
 *
 * Mirrors the prototype's layout rules:
 * - docked at window widths >= 900px, overlay below that;
 * - handle: pointer drag + ArrowLeft/ArrowRight (±40px),
 *   clamped to [320, innerWidth - 420];
 * - default width max(400, min(820, w * 0.42)) until the user changes it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { pendingCount } from "../comments/threads.js";
import { GuidePage } from "../guide/GuidePage.js";
import { REVEAL_EVENT } from "../source/diff/revealSource.js";
import { SourcePane } from "../source/SourcePane.js";
import { WIDEN_EVENT } from "../source/diff/DiffView.js";
import { useReview } from "../state/store.js";
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
  const [sourceOpen, setSourceOpen] = useState<boolean | null>(null); // null = follow width
  const [paneWidth, setPaneWidth] = useState<number>(() => defaultWidth());
  const [tab, setTab] = useState<"desc" | "diff">("diff");
  const drag = useRef<{ x0: number; w0: number } | null>(null);

  const open = sourceOpen ?? window.innerWidth >= DOCK_WIDTH;
  const docked = window.innerWidth >= DOCK_WIDTH && open;
  const pending = pendingCount(useReview((s) => s.snapshot));

  // Re-render on resize so dock/overlay follows the window.
  const [, setTick] = useState(0);
  useEffect(() => {
    const onResize = (): void => setTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // `revealSource` (guide citations): open the pane. Tab switching lives
  // in `SourcePane` (it inspects the ref); the diff pane scrolls and
  // highlights once mounted.
  useEffect(() => {
    const onReveal = (): void => {
      setSourceOpen(true);
    };
    window.addEventListener(REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(REVEAL_EVENT, onReveal);
  }, []);

  // Persist the pane width (a diff view preference, PRD §4.13).
  useEffect(() => {
    try {
      localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth));
    } catch {
      // Private mode: ignore.
    }
  }, [paneWidth]);

  // Choosing Split in a narrow pane widens it (prototype rule).
  useEffect(() => {
    const onWiden = (): void =>
      setPaneWidth((w) =>
        w < window.innerWidth * 0.48 ? clampWidth(Math.round(window.innerWidth * 0.52)) : w,
      );
    window.addEventListener(WIDEN_EVENT, onWiden);
    return () => window.removeEventListener(WIDEN_EVENT, onWiden);
  }, []);
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

  const rightClass = "col" + (docked ? "" : open ? " overlay" : " hide");

  return (
    <div className="app">
      <TopBar
        reviewId={reviewId}
        pendingCount={pending}
        sourceOpen={open}
        onToggleSource={() => setSourceOpen(!open)}
      />
      <div
        className="cols"
        style={{ gridTemplateColumns: docked ? `minmax(0, 1fr) 6px ${paneWidth}px` : "minmax(0, 1fr)" }}
      >
        <main className="col" id="page">
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
