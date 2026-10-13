/**
 * Shared pan/zoom gesture hook for diagrams (issues #47, #16 round two).
 *
 * Used by the expanded overlay and the inline in-place zoom alike:
 * - `view` + CSS `translate(x y) scale(s)` with origin `0 0`;
 * - wheel zoom: always, or only with Ctrl/Cmd (inline leaves plain wheel
 *   to the page);
 * - drag to pan (one pointer) and pinch to zoom (two pointers); a drag
 *   past the threshold suppresses the click that ends it, so a drag is
 *   never a click on a cited shape;
 * - pointer capture only once a press becomes a drag (capturing on
 *   pointerdown would retarget mouseup and break click-to-reveal) and
 *   immediately for two-pointer pinches (never a tap).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAG_THRESHOLD_PX,
  IDENTITY_VIEW,
  zoomAround,
  type ViewTransform,
} from "./panZoom.js";

export interface PanZoomPolicy {
  /** Overlay zooms on every wheel; inline only with Ctrl/Cmd held. */
  wheel: "always" | "modifier";
  /** Overlay pans freely; inline only pans once zoomed past fit. */
  pan: "always" | "zoomed";
}

export function usePanZoom(policy: PanZoomPolicy): {
  view: ViewTransform;
  viewRef: React.MutableRefObject<ViewTransform>;
  viewportRef: React.RefObject<HTMLDivElement>;
  docRef: React.RefObject<HTMLDivElement>;
  applyView: (next: ViewTransform | ((v: ViewTransform) => ViewTransform)) => void;
  zoomBy: (factor: number) => void;
  panning: boolean;
  gestureProps: {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
} {
  const [view, setView] = useState<ViewTransform>(IDENTITY_VIEW);
  const viewRef = useRef<ViewTransform>(IDENTITY_VIEW);
  const viewportRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const moved = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const captured = useRef(new Set<number>());
  const [panning, setPanning] = useState(false);
  const policyRef = useRef(policy);
  policyRef.current = policy;

  /** setView that also mirrors into viewRef (fit preservation checks). */
  const applyView = useCallback(
    (next: ViewTransform | ((v: ViewTransform) => ViewTransform)): void => {
      setView((v) => {
        const n = typeof next === "function" ? (next as (v: ViewTransform) => ViewTransform)(v) : next;
        viewRef.current = n;
        return n;
      });
    },
    [],
  );

  // Wheel zoom (non-passive so zooming can hold the page still). Trackpad
  // pinches arrive as wheel with Ctrl held and work the same way.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (policyRef.current.wheel === "modifier" && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const factor = Math.exp(-e.deltaY * unit * 0.0015);
      applyView((v) => zoomAround(v, e.clientX - rect.left, e.clientY - rect.top, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyView]);

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
    const mayPan =
      pointers.current.size === 1 &&
      (e.buttons & 1) !== 0 &&
      (policyRef.current.pan === "always" || viewRef.current.s > 1);
    if (mayPan) {
      setPanning(true);
      // The press is a drag now: capture so panning survives the pointer
      // leaving the viewport. (Capturing earlier would retarget mouseup
      // and break click-to-reveal on cited shapes.)
      if (moved.current > DRAG_THRESHOLD_PX) capture(e.pointerId);
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
    if (moved.current > DRAG_THRESHOLD_PX) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = 0;
    }
  };

  const zoomBy = useCallback(
    (factor: number): void => {
      const el = viewportRef.current;
      const rect = el?.getBoundingClientRect();
      const cx = rect ? rect.width / 2 : 0;
      const cy = rect ? rect.height / 2 : 0;
      applyView((v) => zoomAround(v, cx, cy, factor));
    },
    [applyView],
  );

  return {
    view,
    viewRef,
    viewportRef,
    docRef,
    applyView,
    zoomBy,
    panning,
    gestureProps: { onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onClickCapture },
  };
}
