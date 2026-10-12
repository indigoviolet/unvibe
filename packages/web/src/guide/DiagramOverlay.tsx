/**
 * Expanded diagram overlay (issue #47).
 *
 * Each diagram block carries an Expand control (see `DiagramView`) that
 * opens the diagram out of the card column in a full-window overlay:
 * - opened via a portal on `document.body`, `role="dialog"` + `aria-modal`;
 * - focus moves into the overlay on open and returns to the previously
 *   focused element (the Expand control) on close;
 * - Esc and the close control shut it; the page behind does not scroll;
 * - pan/zoom runs on the shared `usePanZoom` hook (same gestures and
 *   maths as the inline zoom): wheel / pinch zoom, drag pan, plus +/−
 *   buttons and a reset-to-fit control opening on the measured fit;
 * - the overlay renders a second `D2Diagram` for the same block, so
 *   citation hover previews (document-level delegation in `HoverPopover`)
 *   and click-to-reveal keep working; a drag never counts as a click.
 *
 * The content security policy does not change: no new scripts, styles or
 * remote loads — only a CSS transform on the inlined SVG.
 */
import { useCallback, useEffect, useRef } from "react";
import type { DiagramBlock } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { D2Diagram, type FetchDiagramSvg } from "./D2Diagram.js";
import { fitContentBox, measureDiagramContent, IDENTITY_VIEW, ZOOM_STEP, type ViewTransform } from "./panZoom.js";
import { usePanZoom } from "./usePanZoom.js";
import { ZoomControls } from "./ZoomControls.js";
import { naturalSize } from "./d2sanitize.js";

interface Props {
  reviewId: string;
  block: DiagramBlock;
  /** Override the SVG fetch (unit tests); defaults to the API client. */
  fetchSvg?: FetchDiagramSvg;
  onClose: () => void;
}

export function DiagramOverlay({ reviewId, block, fetchSvg, onClose }: Props): React.JSX.Element {
  const pan = usePanZoom({ wheel: "always", pan: "always" });
  const { view, viewRef, viewportRef, docRef, applyView } = pan;
  const rootRef = useRef<HTMLDivElement>(null);
  /** The fitted view (whole diagram visible): initial view + Reset target. */
  const fitRef = useRef<ViewTransform>(IDENTITY_VIEW);
  /** The SVG node already sized (theme swaps adopt a fresh node). */
  const sizedSvg = useRef<Element | null>(null);
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

  // Fit-to-view, computed from the *measured* rendered content — never
  // the viewBox. D2 draws outside its own viewBox (link badges, the
  // padded canvas), so fitting the viewBox centers the wrong box and
  // clips the overflow. Measures at the identity transform (a zoomed view
  // would corrupt the boxes); the temporary clear is restored
  // synchronously, so no intermediate state ever paints.
  const computeFit = useCallback((): ViewTransform | null => {
    const viewport = viewportRef.current;
    const doc = docRef.current;
    const svg = doc?.querySelector(".dg-svg > svg");
    if (!viewport || !doc || !svg || svg.tagName.toLowerCase() !== "svg") return null;
    const prev = doc.style.transform;
    doc.style.transform = "none";
    try {
      const union = measureDiagramContent(svg as SVGSVGElement);
      if (!union) return null;
      const cs = getComputedStyle(viewport);
      const padL = Number.parseFloat(cs.paddingLeft) || 0;
      const padR = Number.parseFloat(cs.paddingRight) || 0;
      const padT = Number.parseFloat(cs.paddingTop) || 0;
      const padB = Number.parseFloat(cs.paddingBottom) || 0;
      const vw = viewport.clientWidth - padL - padR;
      const vh = viewport.clientHeight - padT - padB;
      const v = viewport.getBoundingClientRect();
      // Usable-area origin, then the content box in that frame.
      const ox = v.left + viewport.clientLeft + padL;
      const oy = v.top + viewport.clientTop + padT;
      const frame = fitContentBox(vw, vh, union.x - ox, union.y - oy, union.w, union.h);
      if (!frame) return null;
      // The CSS transform is relative to the doc origin, not the content origin.
      const d = doc.getBoundingClientRect();
      return { s: frame.s, x: ox - d.left + frame.x, y: oy - d.top + frame.y };
    } finally {
      doc.style.transform = prev;
    }
  }, [viewportRef, docRef]);

  const resetView = useCallback((): void => {
    // Recomputed live when measurable (a resize may have moved things);
    // otherwise back to the last good fit.
    const fit = computeFit() ?? fitRef.current;
    fitRef.current = fit;
    applyView(fit);
  }, [computeFit, applyView]);

  // Fit-to-view on arrival: the adopted SVG carries only a viewBox (no
  // width/height), so without an explicit size it would measure 0×0 inside
  // the max-content wrapper. Every fresh node gets its natural size stamped
  // from the viewBox; the view only moves when the user has not diverged
  // from the fit (so a theme swap while expanded keeps the user's zoom).
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const sameView = (a: ViewTransform, b: ViewTransform): boolean =>
      a.s === b.s && a.x === b.x && a.y === b.y;
    const fitIfReady = (): void => {
      const svg = doc.querySelector(".dg-svg > svg");
      if (!svg) return;
      if (sizedSvg.current !== svg) {
        const natural = naturalSize(svg);
        if (!natural) return;
        sizedSvg.current = svg;
        svg.setAttribute("width", String(natural.w));
        svg.setAttribute("height", String(natural.h));
      }
      if (!sameView(viewRef.current, fitRef.current)) return;
      const fit = computeFit();
      if (!fit) return;
      fitRef.current = fit;
      if (!sameView(viewRef.current, fit)) applyView(fit);
    };
    fitIfReady();
    const observer = new MutationObserver(fitIfReady);
    observer.observe(doc, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [block.id, computeFit, applyView, viewRef, docRef]);

  return (
    <div ref={rootRef} className="dg-overlay" role="dialog" aria-modal="true" aria-label="Expanded diagram" tabIndex={-1}>
      <div className="dg-ov-head">
        <span className="dg-ov-title">Diagram</span>
        <div className="dg-ov-tools">
          <ZoomControls
            scale={view.s}
            onZoomIn={() => pan.zoomBy(ZOOM_STEP)}
            onZoomOut={() => pan.zoomBy(1 / ZOOM_STEP)}
            onReset={resetView}
          />
          <button type="button" className="ib" aria-label="Close diagram" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>
      <div
        ref={viewportRef}
        className={`dg-ov-view${pan.panning ? " panning" : ""}`}
        onPointerDown={pan.gestureProps.onPointerDown}
        onPointerMove={pan.gestureProps.onPointerMove}
        onPointerUp={pan.gestureProps.onPointerUp}
        onPointerCancel={pan.gestureProps.onPointerCancel}
        onClickCapture={pan.gestureProps.onClickCapture}
      >
        <div
          ref={docRef}
          className="dg-ov-doc dg-d2"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        >
          <D2Diagram reviewId={reviewId} block={block} fetchSvg={fetchSvg} />
        </div>
      </div>
    </div>
  );
}
