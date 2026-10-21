/**
 * D2 diagram rendering (web-guide owner; D2 decision addendum).
 *
 * Every diagram block renders through `D2Diagram`: the service runs the
 * `d2` binary and caches light + dark SVGs, the web app inlines the one
 * matching the current theme. Mermaid is gone (no compatibility path).
 *
 * Issue #47: each diagram carries an Expand control opening a
 * full-window overlay (`DiagramOverlay`) with wheel/pinch zoom, drag pan
 * and reset-to-fit — the escape hatch for diagrams too wide to read inline.
 *
 * Round two: the inline block zooms in place too, on the same `usePanZoom`
 * gestures and maths. By default the diagram fits the block (whole
 * diagram visible, no scrollbars, never above natural size); +/−/Reset
 * sit next to Expand, trackpad pinch and Ctrl/Cmd+wheel zoom, a plain
 * wheel keeps scrolling the page, and dragging pans once zoomed. When
 * the guide pane has spare room the block breaks out beyond the text
 * column (caption and citations row stay aligned with the column).
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DiagramBlock } from "@unvibe/shared";
import { Icon } from "../components/Icon.js";
import { D2Diagram, type FetchDiagramSvg } from "./D2Diagram.js";
import { DiagramOverlay } from "./DiagramOverlay.js";
import { naturalSize } from "./d2sanitize.js";
import { IDENTITY_VIEW, ZOOM_STEP } from "./panZoom.js";
import { usePanZoom } from "./usePanZoom.js";
import { ZoomControls } from "./ZoomControls.js";
import { Button } from "../ui/index.js";
import { RichText } from "./RichText.js";

interface Props {
  reviewId: string;
  block: DiagramBlock;
  /** Open a guide page in-app. */
  onOpenPage: (pageId: string) => void;
  /** Override the SVG fetch (unit tests); defaults to the API client. */
  fetchSvg?: FetchDiagramSvg;
}

/**
 * Let the diagram block use the guide pane's spare width (round two,
 * item 3): when the diagram's natural width exceeds the text column and
 * the pane has room (source pane closed), the block grows beyond the
 * column — centered on it, up to the pane's usable width — without
 * shifting the text and without scrolling the pane. Otherwise (source
 * open, narrow window) it stays within the column and fits (item 2).
 * Reacts to resizes and pane toggles via ResizeObserver; the SVG's
 * arrival via MutationObserver. Caption and citations row are siblings
 * of the widened box, so they stay column-aligned. Applies everywhere a
 * DiagramView renders (cards and Explain expansions share the column).
 */
function useDiagramBreakout(dgRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const dg = dgRef.current;
    if (!dg) return;
    const compute = (): void => {
      const clear = (): void => {
        dg.style.width = "";
        dg.style.marginLeft = "";
        dg.style.marginRight = "";
      };
      const blk = dg.parentElement;
      const pane = dg.closest("#page");
      const svg = dg.querySelector(".dg-svg > svg");
      const natural = svg ? naturalSize(svg) : null;
      if (!blk || !pane || !natural) {
        clear();
        return;
      }
      const column = blk.clientWidth;
      const pcs = getComputedStyle(pane);
      const usable =
        pane.clientWidth - (Number.parseFloat(pcs.paddingLeft) || 0) - (Number.parseFloat(pcs.paddingRight) || 0);
      const width = Math.min(natural.w, usable - 1);
      if (width > column + 1) {
        const margin = `${(column - width) / 2}px`;
        dg.style.width = `${width}px`;
        dg.style.marginLeft = margin;
        dg.style.marginRight = margin;
      } else {
        clear();
      }
    };
    compute();
    const pane = dg.closest("#page");
    // jsdom has no ResizeObserver (component tests): the one-shot compute
    // above is enough there (zero rects clear any breakout).
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(compute);
    if (pane) ro.observe(pane);
    if (dg.parentElement) ro.observe(dg.parentElement);
    const mo = new MutationObserver(compute);
    mo.observe(dg, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [dgRef]);
}

export function DiagramView({ reviewId, block, onOpenPage, fetchSvg }: Props) {
  const [expanded, setExpanded] = useState(false);
  const pan = usePanZoom({ wheel: "modifier", pan: "zoomed" });
  const dgRef = useRef<HTMLDivElement | null>(null);
  useDiagramBreakout(dgRef);
  const zoomed = pan.view.s > 1;
  // Zoom and Expand act on the rendered SVG: a diagram that did not
  // render carries neither, only the fallback's own retry (#130).
  const [rendered, setRendered] = useState(block.render?.status === "ok");
  return (
    <>
      <div ref={dgRef} className="dg dg-d2">
        <div
          ref={pan.viewportRef}
          className={zoomed ? "dg-view zoomed" : "dg-view"}
          onPointerDown={pan.gestureProps.onPointerDown}
          onPointerMove={pan.gestureProps.onPointerMove}
          onPointerUp={pan.gestureProps.onPointerUp}
          onPointerCancel={pan.gestureProps.onPointerCancel}
          onClickCapture={pan.gestureProps.onClickCapture}
        >
          <div
            ref={pan.docRef}
            className="dg-doc"
            style={{ transform: `translate(${pan.view.x}px, ${pan.view.y}px) scale(${pan.view.s})` }}
          >
            <D2Diagram
              reviewId={reviewId}
              block={block}
              fetchSvg={fetchSvg}
              capNaturalWidth
              onStateChange={(s) => setRendered(s === "ready")}
            />
          </div>
        </div>
        {rendered ? (
          <div className="dg-bar">
            <ZoomControls
              scale={pan.view.s}
              onZoomIn={() => pan.zoomBy(ZOOM_STEP)}
              onZoomOut={() => pan.zoomBy(1 / ZOOM_STEP)}
              onReset={() => pan.applyView(IDENTITY_VIEW)}
            />
            <Button
              variant="secondary"
              size="sm"
              type="button"
              className="dg-expand"
              aria-label="Expand diagram"
              aria-haspopup="dialog"
              onClick={() => setExpanded(true)}
            >
              <Icon name="open" /> Expand
            </Button>
          </div>
        ) : null}
      </div>
      {expanded
        ? createPortal(
            <DiagramOverlay
              reviewId={reviewId}
              block={block}
              fetchSvg={fetchSvg}
              onClose={() => setExpanded(false)}
            />,
            document.body,
          )
        : null}
      {block.caption ? (
        <p className="dg-cap">
          <RichText html={block.caption} className="rt" onOpenPage={onOpenPage} />
        </p>
      ) : null}
    </>
  );
}
