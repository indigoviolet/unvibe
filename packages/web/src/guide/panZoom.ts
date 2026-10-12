/**
 * Shared pan/zoom maths for diagrams (issues #47, #16 round two).
 *
 * One implementation drives both the expanded overlay (`DiagramOverlay`)
 * and the inline in-place zoom (`DiagramView`): zoom-around-cursor,
 * fit-to-measured-content, and the union-box measurement behind the fit.
 * The two uses differ only in policy (wheel capture, when panning
 * applies, how Reset computes its target), which lives in `usePanZoom`.
 */

/** Zoom limits (×1 is the diagram's natural size). */
export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
/** Button zoom step. */
export const ZOOM_STEP = 1.25;
/** Pointer travel that turns a press into a drag (and suppresses click). */
export const DRAG_THRESHOLD_PX = 5;

export interface ViewTransform {
  s: number;
  x: number;
  y: number;
}

export const IDENTITY_VIEW: ViewTransform = { s: 1, x: 0, y: 0 };

/**
 * Zoom around a viewport point (pure, unit-tested): the point under the
 * cursor stays under it, the scale clamps to the limits. Assumes a
 * `translate(x y) scale(s)` transform with origin `0 0`.
 */
export function zoomAround(t: ViewTransform, cx: number, cy: number, factor: number): ViewTransform {
  if (!(factor > 0) || !Number.isFinite(factor)) return t;
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.s * factor));
  const r = s / t.s;
  return { s, x: cx - (cx - t.x) * r, y: cy - (cy - t.y) * r };
}

/**
 * Fit-to-view transform (pure, unit-tested): scale the measured content
 * box so the whole of it sits inside the viewport's usable area,
 * centered with equal margins. The box is the *rendered* content
 * (viewport-content-origin frame, may start negative when badges or
 * strokes draw outside the SVG viewBox) — never the viewBox itself.
 * Scale caps at 1: small diagrams center at natural size, never upscale.
 * Null when either box is degenerate (e.g. jsdom's zero rects — the
 * caller keeps identity).
 */
export function fitContentBox(
  viewportW: number,
  viewportH: number,
  boxX: number,
  boxY: number,
  boxW: number,
  boxH: number,
): ViewTransform | null {
  if (!(viewportW > 0) || !(viewportH > 0) || !(boxW > 0) || !(boxH > 0)) return null;
  const fit = Math.min(viewportW / boxW, viewportH / boxH);
  const s = Math.min(1, MAX_SCALE, Math.max(MIN_SCALE, fit));
  return { s, x: (viewportW - s * boxW) / 2 - s * boxX, y: (viewportH - s * boxH) / 2 - s * boxY };
}

/**
 * Measured union box of an SVG's rendered children, in client px. Skips
 * non-rendered children (`defs`, `style`). The caller measures at the
 * identity transform, so this covers everything the SVG paints —
 * including citation badges and strokes that draw outside the viewBox —
 * in the same frame the fit maths uses.
 */
export function measureDiagramContent(svg: SVGSVGElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let found = false;
  for (const child of [...svg.children]) {
    const tag = child.tagName.toLowerCase();
    if (tag === "defs" || tag === "style" || tag === "title" || tag === "desc") continue;
    const r = (child as SVGGraphicsElement).getBoundingClientRect?.();
    if (!r || (r.width === 0 && r.height === 0)) continue;
    found = true;
    x0 = Math.min(x0, r.left);
    y0 = Math.min(y0, r.top);
    x1 = Math.max(x1, r.right);
    y1 = Math.max(y1, r.bottom);
  }
  if (!found) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
