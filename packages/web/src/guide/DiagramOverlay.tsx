/**
 * Expanded diagram overlay (issue #47).
 *
 * Each diagram block carries an Expand control (see `DiagramView`) that
 * opens the diagram out of the card column in a full-window overlay:
 * - opened via a portal on `document.body`, `role="dialog"` + `aria-modal`;
 * - focus moves into the overlay on open and returns to the previously
 *   focused element (the Expand control) on close;
 * - Esc and the close control shut it; the page behind does not scroll;
 * - zoom with wheel / pinch, pan by dragging, plus +/− buttons and a
 *   reset-to-fit control, all on a CSS transform (no new dependency);
 * - the overlay renders a second `D2Diagram` for the same block, so
 *   citation hover previews (document-level delegation in `HoverPopover`)
 *   and click-to-reveal keep working; a drag never counts as a click.
 *
 * The content security policy does not change: no new scripts, styles or
 * remote loads — only a CSS transform on the inlined SVG.
 */
import { useEffect, useRef, useState } from "react";
import type { DiagramBlock } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { D2Diagram, type FetchDiagramSvg } from "./D2Diagram.js";
import { naturalSize } from "./d2sanitize.js";

/** Zoom limits for the overlay (×1 is the diagram's natural size). */
export const OVERLAY_MIN_SCALE = 0.25;
export const OVERLAY_MAX_SCALE = 8;
/** Button zoom step. */
export const OVERLAY_ZOOM_STEP = 1.25;
/** Pointer travel that turns a press into a drag (and suppresses click). */
export const OVERLAY_DRAG_THRESHOLD_PX = 5;

export interface ViewTransform {
  s: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ViewTransform = { s: 1, x: 0, y: 0 };

/**
 * Zoom around a viewport point (pure, unit-tested): the point under the
 * cursor stays under it, the scale clamps to the overlay limits.
 */
export function zoomAround(t: ViewTransform, cx: number, cy: number, factor: number): ViewTransform {
  if (!(factor > 0) || !Number.isFinite(factor)) return t;
  const s = Math.min(OVERLAY_MAX_SCALE, Math.max(OVERLAY_MIN_SCALE, t.s * factor));
  const r = s / t.s;
  return { s, x: cx - (cx - t.x) * r, y: cy - (cy - t.y) * r };
}

/**
 * Fit-to-view transform (pure, unit-tested): scale the natural diagram so
 * the whole of it is visible, centered in the viewport. Null when either
 * box is degenerate (e.g. jsdom's zero rects — the caller keeps identity).
 */
export function fitView(
  viewportW: number,
  viewportH: number,
  naturalW: number,
  naturalH: number,
): ViewTransform | null {
  if (viewportW <= 0 || viewportH <= 0 || naturalW <= 0 || naturalH <= 0) return null;
  const s = Math.min(OVERLAY_MAX_SCALE, Math.max(OVERLAY_MIN_SCALE, Math.min(viewportW / naturalW, viewportH / naturalH)));
  return { s, x: (viewportW - naturalW * s) / 2, y: (viewportH - naturalH * s) / 2 };
}

interface Props {
  reviewId: string;
  block: DiagramBlock;
  /** Override the SVG fetch (unit tests); defaults to the API client. */
  fetchSvg?: FetchDiagramSvg;
  onClose: () => void;
}

export function DiagramOverlay({ reviewId, block, fetchSvg, onClose }: Props): React.JSX.Element {
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  /** setView that also mirrors into viewRef (theme-swap preservation). */
  const applyView = (next: ViewTransform | ((v: ViewTransform) => ViewTransform)): void => {
    setView((v) => {
      const n = typeof next === "function" ? (next as (v: ViewTransform) => ViewTransform)(v) : next;
      viewRef.current = n;
      return n;
    });
  };  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  /** The fitted view (whole diagram visible): initial view + Reset target. */
  const fitRef = useRef<ViewTransform>(IDENTITY_VIEW);
  const viewRef = useRef<ViewTransform>(IDENTITY_VIEW);
  /** The SVG node already sized (theme swaps adopt a fresh node). */
  const sizedSvg = useRef<Element | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const moved = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const captured = useRef(new Set<number>());
  const [panning, setPanning] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus into the overlay on open, back to the opener on close; Esc
  // closes; the page behind stays put while the overlay is open.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    rootRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, []);

  // Fit-to-view on arrival (pure, unit-tested core in `fitView`): the
  // adopted SVG carries only a viewBox (no width/height), so without an
  // explicit size it would measure 0×0 inside the max-content wrapper.
  // Every fresh node gets its natural size stamped; the view only moves
  // when the user has not diverged from the fit (so a theme swap while
  // expanded keeps the user's zoom). Reset returns to the fit.
  useEffect(() => {
    const viewport = viewportRef.current;
    const doc = docRef.current;
    if (!viewport || !doc) return;
    const sameView = (a: ViewTransform, b: ViewTransform): boolean =>
      a.s === b.s && a.x === b.x && a.y === b.y;
    const fitIfReady = (): void => {
      const svg = doc.querySelector(".dg-svg > svg");
      if (!svg || sizedSvg.current === svg) return;
      const natural = naturalSize(svg);
      if (!natural) return;
      sizedSvg.current = svg;
      svg.setAttribute("width", String(natural.w));
      svg.setAttribute("height", String(natural.h));
      if (!sameView(viewRef.current, fitRef.current)) return;
      // Content box (clientWidth/Height): the 24px padding is not usable.
      const fit = fitView(viewport.clientWidth, viewport.clientHeight, natural.w, natural.h);
      if (!fit) return;
      fitRef.current = fit;
      applyView(fit);
    };
    fitIfReady();
    const observer = new MutationObserver(fitIfReady);
    observer.observe(doc, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [block.id]);

  // Wheel zoom (non-passive: the viewport must not scroll). Pinch gestures
  // on trackpads arrive as wheel events with small deltas and work the
  // same way.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const factor = Math.exp(-e.deltaY * unit * 0.0015);
      applyView((v) => zoomAround(v, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number): void => {
    const el = viewportRef.current;
    const rect = el?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    applyView((v) => zoomAround(v, cx, cy, factor));
  };

  /** Capture a pointer to the viewport (best-effort: absent in jsdom). */
  const capture = (pointerId: number): void => {
    if (captured.current.has(pointerId)) return;
    try {
      viewportRef.current?.setPointerCapture(pointerId);
      captured.current.add(pointerId);
    } catch {
      // jsdom and some older engines have no pointer capture.
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    downAt.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 2) {
      // A two-pointer gesture is never a tap: capture both so the pinch
      // keeps tracking when a finger leaves the viewport.
      for (const id of pointers.current.keys()) capture(id);
      const [a, b] = [...pointers.current.values()];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      pinch.current = { d: Math.hypot(dx, dy), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
    // No capture for a single press: capturing on pointerdown would
    // retarget mouseup and break the click that reveals cited shapes.
    // Capture happens lazily once the press becomes a drag (below).
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (downAt.current) {
      moved.current = Math.max(
        moved.current,
        Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y),
      );
    }
    const el = viewportRef.current;
    if (pointers.current.size === 2 && pinch.current && el) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const rect = el.getBoundingClientRect();
      const base = pinch.current;
      if (base.d > 0 && dist > 0) {
        const anchorX = base.cx - rect.left;
        const anchorY = base.cy - rect.top;
        applyView((v) => {
          const zoomed = zoomAround(v, anchorX, anchorY, dist / base.d);
          return { ...zoomed, x: zoomed.x + (cx - base.cx), y: zoomed.y + (cy - base.cy) };
        });
      }
      pinch.current = { d: dist, cx, cy };
      return;
    }
    if (pointers.current.size === 1 && (e.buttons & 1) !== 0) {
      setPanning(true);
      // The press is a drag now: capture so panning survives the pointer
      // leaving the viewport. (Capturing earlier would retarget mouseup
      // and break click-to-reveal on cited shapes.)
      if (moved.current > OVERLAY_DRAG_THRESHOLD_PX) capture(e.pointerId);
      const ox = dx;
      const oy = dy;
      applyView((v) => ({ ...v, x: v.x + ox, y: v.y + oy }));
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(e.pointerId);
    captured.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      setPanning(false);
      downAt.current = null;
    }
  };

  // A drag must not count as a click on a cited shape: swallow the click
  // that ends a drag before it reaches the diagram's reveal handler.
  const onClickCapture = (e: React.MouseEvent): void => {
    if (moved.current > OVERLAY_DRAG_THRESHOLD_PX) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = 0;
    }
  };

  const percent = Math.round(view.s * 100);

  return (
    <div ref={rootRef} className="dg-overlay" role="dialog" aria-modal="true" aria-label="Expanded diagram" tabIndex={-1}>
      <div className="dg-ov-head">
        <span className="dg-ov-title">Diagram</span>
        <div className="dg-ov-tools">
          <button type="button" className="ib" aria-label="Zoom out" onClick={() => zoomBy(1 / OVERLAY_ZOOM_STEP)}>
            <span aria-hidden="true">−</span>
          </button>
          <span className="dg-ov-zoom" aria-live="polite" aria-label={`Zoom ${percent} percent`}>
            {percent}%
          </span>
          <button type="button" className="ib" aria-label="Zoom in" onClick={() => zoomBy(OVERLAY_ZOOM_STEP)}>
            <span aria-hidden="true">+</span>
          </button>
          <button type="button" className="tbtn" aria-label="Reset view" onClick={() => applyView(fitRef.current)}>
            Reset
          </button>
          <button type="button" className="ib" aria-label="Close diagram" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`dg-ov-view${panning ? " panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onClickCapture={onClickCapture}
      >
        <div
          ref={docRef}
          className="dg-ov-doc"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        >
          <D2Diagram reviewId={reviewId} block={block} fetchSvg={fetchSvg} />
        </div>
      </div>
    </div>
  );
}
