/**
 * Pure SVG renderer for the JSON diagram spec (no DOM, no deps).
 *
 * Presentation ONLY through the prototype's existing classes
 * (`dg-box`, `dg-t`, `dg-s`, `dg-a`, `dg-ah`, `dg-l` + `ok`/`bad`).
 * No `style=` attributes, no `<style>` tags — a strict
 * `style-src 'self'` policy is enough. Theme (light/dark) and fonts come
 * from the CSS variables the classes already use.
 *
 * All agent-controlled strings are escaped by construction (`esc`);
 * see the injection tests. Tooltips for wrapped/truncated text use SVG
 * `<title>` (no JS, no interactivity beyond the app's `[data-cite]`
 * delegation).
 *
 * Text widths are a deterministic model calibrated against real Chromium
 * measurements with the prototype's fonts (IBM Plex Sans 600 12.5px for
 * titles, IBM Plex Sans 11.5px for labels, IBM Plex Mono 11px for subs):
 * mono is exactly 7px per code point; sans uses per-character tables
 * (space 3px) with a conservative fallback. Boxes grow to fit content up
 * to the available column width before any wrapping; wrapping (≤2 lines)
 * comes before truncation, which is a last resort.
 *
 * Flow layout honours an explicit `direction` (`LR` default, `TB`); with
 * no explicit direction it prefers left-to-right when the longest layer
 * chain fits the 760px column and falls back to a wrapped-row flow (fan-
 * out targets in a row below, centred under their source, like the
 * prototype's hand-drawn flow) or top-to-bottom when it does not.
 */
import { validateDiagram, type DiagramSpec } from "./diagram-spec.js";

const MONO_PX = 7;
const SANS_T_FALLBACK = 8;
const SANS_L_FALLBACK = 7;
const SANS_T: Record<string, number> = {
  " ": 3, "(": 5, ")": 4, ",": 4, "-": 6, ".": 4,
  "0": 8, "1": 8, "2": 8, "3": 8, "4": 8, "5": 8, "6": 8, "7": 8, "8": 8, "9": 8,
  ":": 4, ";": 4, "<": 7, ">": 7,
  A: 8, B: 8, C: 8, D: 9, E: 8, F: 7, G: 10, H: 9, I: 6, J: 7, K: 8, L: 7, M: 10,
  N: 9, O: 9, P: 8, Q: 9, R: 8, S: 8, T: 9, U: 9, V: 8, W: 12, X: 8, Y: 8, Z: 9,
  _: 8, a: 8, b: 8, c: 7, d: 8, e: 8, f: 6, g: 8, h: 8, i: 3, j: 4, k: 7, l: 4,
  m: 12, n: 8, o: 8, p: 8, q: 8, r: 5, s: 7, t: 6, u: 8, v: 7, w: 10, x: 7, y: 7, z: 7,
  "→": 12.5, "#": 10, $: 8, "&": 9, "'": 4, "*": 8, "+": 8, "/": 5, "=": 8, "?": 6,
  "\\": 5, "^": 8, "|": 5, '"': 6, "`": 8, "!": 4, "%": 12, "@": 12, "~": 8,
  "…": 12, "’": 3, "“": 7, "”": 6,
};
const SANS_L: Record<string, number> = {
  " ": 3, "(": 4, ")": 4, ",": 3, "-": 5, ".": 3,
  "0": 7, "1": 7, "2": 7, "3": 7, "4": 7, "5": 7, "6": 7, "7": 7, "8": 7, "9": 7,
  ":": 3, ";": 3, "<": 7, ">": 7,
  A: 7, B: 8, C: 7, D: 8, E: 7, F: 6, G: 9, H: 8, I: 5, J: 6, K: 7, L: 6, M: 9,
  N: 8, O: 9, P: 6, Q: 9, R: 7, S: 7, T: 7, U: 8, V: 7, W: 10, X: 7, Y: 7, Z: 7,
  _: 7, a: 6, b: 7, c: 6, d: 7, e: 7, f: 4, g: 6, h: 7, i: 3, j: 3, k: 6, l: 3,
  m: 11, n: 7, o: 7, p: 7, q: 7, r: 4, s: 6, t: 4, u: 7, v: 6, w: 9, x: 6, y: 6, z: 6,
  "→": 11.5, "#": 8, $: 7, "&": 8, "'": 3, "*": 5, "+": 7, "/": 4, "=": 7, "?": 5,
  "\\": 4, "^": 7, "|": 3, '"': 5, "`": 7, "!": 3, "%": 11, "@": 11, "~": 7,
  "…": 9, "’": 3, "“": 6, "”": 6,
};

function monoW(s: string): number {
  return [...s].length * MONO_PX;
}
function sansTW(s: string): number {
  let w = 0;
  for (const ch of s) w += SANS_T[ch] ?? SANS_T_FALLBACK;
  return w;
}
function sansLW(s: string): number {
  let w = 0;
  for (const ch of s) w += SANS_L[ch] ?? SANS_L_FALLBACK;
  return w;
}

/** Deterministic width estimate for tests and layout (same model). */
export function estimateTextWidth(text: string, kind: "title" | "sub" | "label"): number {
  if (kind === "sub") return monoW(text);
  if (kind === "title") return sansTW(text);
  return sansLW(text);
}

const PAD_X = 12;
const BADGE_RESERVE = 22;
const MIN_W = 96;
const MAX_W = 230;
const COL_GAP = 28;
const ROW_GAP = 64;
const AVAILABLE_W = 760;
const MARGIN_X = 10;
const MARGIN_TOP = 14;
const MARGIN_BOT = 14;
const NODE_H_SUB = 52;
const NODE_H_SUB2 = 66;
const NODE_H_NOSUB = 40;
const NODE_H_NOSUB2 = 54;

function esc(s: string): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function r(v: number): number {
  return Math.round(v * 10) / 10;
}

function ellipsisW(measure: (s: string) => number): number {
  return measure("…");
}

/** Truncate `s` so `measure(prefix) + ellipsis` fits `maxW` (deterministic). */
function truncateToWidth(s: string, maxW: number, measure: (s: string) => number): string {
  if (measure(s) <= maxW) return s;
  const ew = ellipsisW(measure);
  if (maxW <= ew) return "…";
  const chars = [...s];
  // Binary search longest fitting prefix (deterministic, O(log n) measures).
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    const cand = chars.slice(0, mid).join("");
    if (measure(cand) + ew <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${chars.slice(0, lo).join("")}…`;
}

/**
 * Greedy word wrap to ≤2 lines within `maxW` (measured, not chars).
 * Single over-long words are hard-truncated; overflow beyond two lines
 * truncates the second line. Full text goes in `<title>` when truncated.
 */
function wrapByWidth(
  text: string,
  maxW: number,
  measure: (s: string) => number,
): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [text], truncated: false };
  if (measure(text) <= maxW) return { lines: [text], truncated: false };
  // Single word too long → hard truncate to one line.
  if (words.length === 1) {
    return { lines: [truncateToWidth(text, maxW, measure)], truncated: true };
  }
  const lines: string[] = [];
  let cur = "";
  let idx = 0;
  for (; idx < words.length; idx++) {
    const w = words[idx];
    const cand = cur ? `${cur} ${w}` : w;
    if (measure(cand) <= maxW) {
      cur = cand;
    } else {
      if (cur) {
        lines.push(cur);
        cur = "";
        if (lines.length >= 1) break;
        // First word alone exceeds (should not happen after single check,
        // but guard for very narrow maxW): truncate it.
        if (measure(w) > maxW) {
          lines.push(truncateToWidth(w, maxW, measure));
          idx++;
          cur = "";
          break;
        }
        cur = w;
      } else {
        // First word exceeds maxW.
        lines.push(truncateToWidth(w, maxW, measure));
        idx++;
        break;
      }
    }
  }
  // Remainder from idx onward (cur + rest) goes to second line, truncated.
  const rest = [cur, ...words.slice(idx)].filter(Boolean).join(" ");
  if (lines.length === 0) {
    // Everything fit in cur (unreachable after early return, kept safe).
    return { lines: [cur || text], truncated: false };
  }
  if (!rest) return { lines: lines.slice(0, 2), truncated: false };
  if (measure(rest) <= maxW && lines.length === 1) {
    return { lines: [lines[0], rest], truncated: false };
  }
  // Overflow → truncate second line; anything beyond is dropped (last resort).
  const second = truncateToWidth(rest, maxW, measure);
  return { lines: [lines[0], second], truncated: true };
}

function stateClass(state?: string): string {
  return state === "ok" || state === "bad" ? ` ${state}` : "";
}

function boxClass(state?: string): string {
  return `dg-box${stateClass(state)}`;
}

/** Auto column assignment by topological depth, capped at 6 cols. Deterministic. */
function autoCols(nodes: { id: string }[], edges: { from: string; to: string }[]): Map<string, number> {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const incoming = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    if (incoming.has(e.to)) incoming.get(e.to)!.push(e.from);
  }
  let changed = true;
  for (let i = 0; i < nodes.length && changed; i++) {
    changed = false;
    for (const n of nodes) {
      for (const p of incoming.get(n.id) ?? []) {
        const d = (depth.get(p) ?? 0) + 1;
        if (d > (depth.get(n.id) ?? 0) && d <= 5) {
          depth.set(n.id, d);
          changed = true;
        }
      }
    }
  }
  return depth;
}

function citeBadge(x: number, y: number, cite: string, unverified?: Set<string>): string {
  const uv = unverified?.has(cite) ? ` unverified` : "";
  const tip = unverified?.has(cite) ? `<title>Unverified citation</title>` : "";
  // data-refs/data-src wire the standard hover preview + click reveal;
  // data-cite(-badge) keeps a stable hook for tests and styling.
  return `<text class="dg-l${uv}" x="${r(x)}" y="${r(y)}" text-anchor="end" data-cite-badge="${esc(cite)}" data-refs="${esc(cite)}" data-src="${esc(cite)}" tabindex="0" role="button" aria-label="Show source">${tip}&lt;&gt;</text>`;
}

function citeGroupAttrs(cite: string | undefined, unverified?: Set<string>): string {
  if (!cite) return "";
  const uv = unverified?.has(cite) ? ` class="unverified"` : "";
  // The whole cited box is the hover/click target (not only the badge):
  // the <g> carries data-refs/data-src so hovering anywhere on the box
  // previews, clicking reveals, and keyboard focus shows a ring via CSS.
  return ` data-cite="${esc(cite)}" data-refs="${esc(cite)}" data-src="${esc(cite)}" tabindex="0" role="button" aria-label="Show source"${uv}`;
}

interface FlowNode extends Record<string, unknown> {
  id: string;
  title: string;
  sub?: string;
  state?: string;
  cite?: string;
  col?: number;
  row?: number;
}

interface FlowEdge extends Record<string, unknown> {
  from: string;
  to: string;
  label?: string;
  cite?: string;
}

interface FittedBox {
  titleLines: string[];
  titleTruncated: boolean;
  titleFull: string;
  sub?: string;
  subTruncated: boolean;
  w: number;
  h: number;
}

/** Fit a node within `maxBoxW`: grow to content, wrap to 2 lines, truncate last. */
function fitNode(n: FlowNode, maxBoxW: number): FittedBox {
  const reserve = n.cite ? BADGE_RESERVE : 0;
  const titleAvail = Math.max(40, maxBoxW - PAD_X * 2 - reserve);
  const subAvail = Math.max(40, maxBoxW - PAD_X * 2);
  const { lines, truncated } = wrapByWidth(n.title, titleAvail, sansTW);
  let sub: string | undefined;
  let subTruncated = false;
  if (n.sub) {
    if (monoW(n.sub) <= subAvail) sub = n.sub;
    else {
      sub = truncateToWidth(n.sub, subAvail, monoW);
      subTruncated = true;
    }
  }
  const titleW = Math.max(...lines.map((l) => sansTW(l)), 0);
  const subW = sub ? monoW(sub) : 0;
  const need = Math.max(titleW + PAD_X * 2 + reserve, subW + PAD_X * 2);
  const w = Math.min(maxBoxW, Math.max(MIN_W, Math.ceil(need)));
  const h = sub
    ? lines.length === 1
      ? NODE_H_SUB
      : NODE_H_SUB2
    : lines.length === 1
      ? NODE_H_NOSUB
      : NODE_H_NOSUB2;
  return { titleLines: lines, titleTruncated: truncated, titleFull: n.title, sub, subTruncated, w, h };
}

function boxSvg(x: number, y: number, fitted: FittedBox, n: FlowNode): string {
  const cls = boxClass(n.state);
  const { titleLines, titleTruncated, titleFull, sub, subTruncated } = fitted;
  const w = fitted.w;
  const h = fitted.h;
  let s = `<rect class="${cls}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="6"/>`;
  if (titleTruncated) s += `<title>${esc(titleFull)}</title>`;
  if (titleLines.length === 1) {
    const ty = y + (sub ? h / 2 - 3 : h / 2 + 4);
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty)}" text-anchor="middle">${esc(titleLines[0])}</text>`;
  } else {
    // Two title lines: 14px leading, centred as a block above the sub.
    // With a sub the block sits higher (gap to sub ≥12px); without, centred.
    const ty1 = y + (sub ? h / 2 - 12 : h / 2 - 7);
    const ty2 = ty1 + 14;
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty1)}" text-anchor="middle">${esc(titleLines[0])}</text>`;
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty2)}" text-anchor="middle">${esc(titleLines[1])}</text>`;
  }
  if (sub) {
    s += `<text class="dg-s" x="${r(x + w / 2)}" y="${r(y + h - 12)}" text-anchor="middle">${esc(sub)}</text>`;
    if (subTruncated) s += `<title>${esc(n.sub!)}</title>`;
  }
  return s;
}

/** Border anchor: intersection of center→target line with box border. */
function anchor(cx: number, cy: number, w: number, h: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx !== 0 ? w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return [cx + dx * t, cy + dy * t];
}

interface LabelBox {
  x: number;
  y: number;
  w: number;
  anchor: "start" | "middle" | "end";
  lines: string[];
}

function labelBBox(l: LabelBox): { x0: number; x1: number; y0: number; y1: number } {
  const h = l.lines.length === 1 ? 15 : 29;
  const y0 = l.lines.length === 1 ? l.y - 11 : l.y - 18;
  if (l.anchor === "middle") return { x0: l.x - l.w / 2, x1: l.x + l.w / 2, y0, y1: y0 + h };
  if (l.anchor === "start") return { x0: l.x, x1: l.x + l.w, y0, y1: y0 + h };
  return { x0: l.x - l.w, x1: l.x, y0, y1: y0 + h };
}

function boxesOverlap(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number },
): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

interface PlacedEdge {
  e: FlowEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Place an edge label beside the midpoint with a clear gap, on the outer
 * side for diverging fan-out edges (prototype: `new dict` end-anchored
 * left of its arrow, `rebuilt in place` start-anchored right of its
 * arrow), never over a box or another label (deterministic resolution).
 */
function placeEdgeLabels(
  placed: PlacedEdge[],
  boxes: Map<string, { x: number; y: number; w: number; h: number }>,
  fanOut: Map<string, number>,
): Map<FlowEdge, LabelBox | null> {
  const out = new Map<FlowEdge, LabelBox | null>();
  const boxList = [...boxes.values()].map((b) => ({ x0: b.x, x1: b.x + b.w, y0: b.y, y1: b.y + b.h }));
  const done: { x0: number; x1: number; y0: number; y1: number }[] = [];
  // Deterministic order: document order of edges.
  for (const p of placed) {
    const label = p.e.label;
    if (!label) {
      out.set(p.e, null);
      continue;
    }
    const dx = p.x2 - p.x1;
    const dy = p.y2 - p.y1;
    const mx = (p.x1 + p.x2) / 2;
    const my = (p.y1 + p.y2) / 2;
    const horizontal = Math.abs(dy) < 5 && Math.abs(dx) > 20;
    const vertical = Math.abs(dx) < 5 && Math.abs(dy) > 20;
    let cand: LabelBox | null = null;
    const side = fanOut.get(p.e as unknown as string);
    if (side !== undefined && !horizontal && !vertical) {
      // Fan-out diagonal: outer side, anchored away from the sibling edge.
      const avail = 120;
      const { lines, truncated } = wrapByWidth(label, avail, sansLW);
      void truncated;
      const w = Math.max(...lines.map((l) => sansLW(l)), 0);
      if (side < 0) {
        cand = { x: mx - 10, y: my - 2, w, anchor: "end", lines };
      } else {
        cand = { x: mx + 10, y: my - 2, w, anchor: "start", lines };
      }
      // Nudge outward until clear of boxes/siblings (deterministic, ≤4 tries).
      for (let t = 0; t < 4 && cand; t++) {
        const bb = labelBBox(cand);
        const hitBox = boxList.some((b) => boxesOverlap(bb, { x0: b.x0 - 4, x1: b.x1 + 4, y0: b.y0 - 4, y1: b.y1 + 4 }));
        const hitLabel = done.some((d) => boxesOverlap(bb, d));
        if (!hitBox && !hitLabel) break;
        cand = side < 0 ? { ...cand, x: cand.x - 10 } : { ...cand, x: cand.x + 10 };
      }
    } else if (horizontal) {
      // Above the line, clear of the boxes (gap ≥4px).
      const avail = Math.max(60, Math.abs(dx) - 8);
      const wrapped = wrapByWidth(label, Math.min(160, avail), sansLW);
      const w = Math.max(...wrapped.lines.map((l) => sansLW(l)), 0);
      cand = { x: mx, y: Math.min(p.y1, p.y2) - 30, w, anchor: "middle", lines: wrapped.lines };
      if (wrapped.truncated) {
        // Keep full text accessible; visual shows ellipsis.
      }
    } else if (vertical) {
      const { lines } = wrapByWidth(label, 120, sansLW);
      const w = Math.max(...lines.map((l) => sansLW(l)), 0);
      cand = { x: mx + 14, y: my - 2, w, anchor: "start", lines };
      for (let t = 0; t < 4 && cand; t++) {
        const bb = labelBBox(cand);
        if (!boxList.some((b) => boxesOverlap(bb, b)) && !done.some((d) => boxesOverlap(bb, d))) break;
        cand = { ...cand, x: cand.x + 8 };
      }
    } else {
      // General diagonal: perpendicular offset, biased upward, then resolve.
      const len = Math.hypot(dx, dy) || 1;
      let px = -dy / len;
      let py = dx / len;
      if (py > 0) {
        px = -px;
        py = -py;
      }
      const { lines } = wrapByWidth(label, 140, sansLW);
      const w = Math.max(...lines.map((l) => sansLW(l)), 0);
      let lx = mx + px * 14;
      let ly = my + py * 14 - 2;
      cand = { x: lx, y: ly, w, anchor: "middle", lines };
      for (let t = 0; t < 5 && cand; t++) {
        const bb = labelBBox(cand);
        if (!boxList.some((b) => boxesOverlap(bb, { x0: b.x0 - 3, x1: b.x1 + 3, y0: b.y0 - 3, y1: b.y1 + 3 })) && !done.some((d) => boxesOverlap(bb, d))) break;
        lx += px * 8;
        ly += py * 8;
        cand = { x: lx, y: ly, w, anchor: "middle", lines };
      }
    }
    if (cand) {
      const bb = labelBBox(cand);
      done.push(bb);
      out.set(p.e, cand);
    } else {
      out.set(p.e, null);
    }
  }
  return out;
}

function edgeLabelSvg(label: string, placed: LabelBox): string {
  // Re-derive truncation for the tooltip: full text when visual differs.
  const full = label;
  const visual = placed.lines.join(" ");
  const truncated = visual !== full && !full.startsWith(visual);
  // Simpler deterministic check: compare without ellipsis.
  const needsTip = placed.lines.some((l) => l.endsWith("…")) || visual.length < full.length;
  let s = "";
  if (placed.lines.length === 1) {
    s += `<text class="dg-l" x="${r(placed.x)}" y="${r(placed.y)}" text-anchor="${placed.anchor}">${esc(placed.lines[0])}</text>`;
  } else {
    s += `<text class="dg-l" x="${r(placed.x)}" y="${r(placed.y - 7)}" text-anchor="${placed.anchor}">${esc(placed.lines[0])}</text>`;
    s += `<text class="dg-l" x="${r(placed.x)}" y="${r(placed.y + 7)}" text-anchor="${placed.anchor}">${esc(placed.lines[1])}</text>`;
  }
  if (needsTip) s += `<title>${esc(full)}</title>`;
  void truncated;
  return s;
}

type Pos = { x: number; y: number; w: number; h: number; cx: number; cy: number };

function markerDef(mid: string): string {
  return `<defs><marker id="${esc(mid)}-ah" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
}

/** Shorten the path end by ~1px so the marker tip touches (no gap/overlap). */
function shortenEnd(x1: number, y1: number, x2: number, y2: number, d = 1): [number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  if (len <= d) return [x1, y1];
  return [x2 - (dx / len) * d, y2 - (dy / len) * d];
}

function renderFlow(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const nodes = (d.nodes ?? []) as FlowNode[];
  const edges = (d.edges ?? []) as FlowEdge[];
  const explicitTB = d.direction === "TB";
  const explicitLR = d.direction === "LR";
  const auto = autoCols(nodes, edges);
  const colOf = (n: FlowNode): number => n.col ?? auto.get(n.id) ?? 0;
  const order = new Map(nodes.map((n, i) => [n.id, n.row ?? i]));
  const fitted = new Map<string, FittedBox>();
  for (const n of nodes) fitted.set(n.id, fitNode(n, MAX_W));

  // Outgoing map for fan-out detection (deterministic order).
  const outgoing = new Map<string, FlowEdge[]>();
  for (const n of nodes) outgoing.set(n.id, []);
  for (const e of edges) {
    if (outgoing.has(e.from)) outgoing.get(e.from)!.push(e);
  }

  const useTB = explicitTB || (!explicitLR && shouldUseTB(nodes, edges, fitted, colOf));
  if (useTB) return renderFlowTB(d, mid, unverified, nodes, edges, fitted, colOf, order);

  // LR with fan-out rows (prototype: main chain top, fan-out below).
  return renderFlowLR(d, mid, unverified, nodes, edges, fitted, colOf, order, outgoing);
}

/** Auto-TB only when an LR fan-out layout would exceed the column. */
function shouldUseTB(
  nodes: FlowNode[],
  edges: FlowEdge[],
  fitted: Map<string, FittedBox>,
  colOf: (n: FlowNode) => number,
): boolean {
  if (nodes.length === 0) return false;
  // Estimate single-row LR width with desired boxes.
  const byCol = new Map<number, number>();
  for (const n of nodes) {
    const c = colOf(n);
    byCol.set(c, Math.max(byCol.get(c) ?? 0, fitted.get(n.id)!.w));
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const total = cols.reduce((s, c) => s + (byCol.get(c) ?? MIN_W), 0) + Math.max(0, cols.length - 1) * COL_GAP + MARGIN_X * 2;
  if (total <= AVAILABLE_W) return false;
  // Fan-out two-row width: main chain + widest fan-out row.
  // If even that exceeds, TB (narrow) wins over a cramped LR.
  const outgoing = new Map<string, number>();
  for (const e of edges) outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + 1);
  const hasFanOut = [...outgoing.values()].some((v) => v >= 2);
  if (!hasFanOut) {
    // Linear long chain: wrapped rows still LR (handled in LR renderer),
    // so only TB when the chain is very long (height cheaper than width).
    return cols.length >= 6;
  }
  // Estimate two-row fan-out width (conservative: single-row minus the
  // narrowest column — the branch row moves at least one column below).
  const twoRow = total - Math.min(...[...byCol.values()]) - COL_GAP;
  return twoRow > AVAILABLE_W;
}

function renderFlowLR(
  d: DiagramSpec,
  mid: string,
  unverified: Set<string> | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
  fitted: Map<string, FittedBox>,
  colOf: (n: FlowNode) => number,
  order: Map<string, number>,
  outgoing: Map<string, FlowEdge[]>,
): string {
  // Partition: main-chain row vs fan-out branch rows.
  const fanTargetOf = new Map<string, string>();
  const fanSources: string[] = [];
  for (const [from, list] of outgoing) {
    if (list.length >= 2) {
      fanSources.push(from);
      for (const e of list) {
        if (!fanTargetOf.has(e.to)) fanTargetOf.set(e.to, from);
      }
    }
  }
  fanSources.sort();
  const mainNodes = nodes.filter((n) => !fanTargetOf.has(n.id));
  const branchNodes = nodes.filter((n) => fanTargetOf.has(n.id));
  mainNodes.sort((a, b) => colOf(a) - colOf(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
  branchNodes.sort((a, b) => colOf(a) - colOf(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));

  // If no fan-out, single row (or wrapped rows when too wide).
  if (fanSources.length === 0) {
    return renderFlowLRSingle(d, mid, unverified, nodes, edges, fitted, colOf, order);
  }

  const pos = new Map<string, Pos>();
  const topY = 30;
  let x = MARGIN_X;
  for (const n of mainNodes) {
    const f = fitted.get(n.id)!;
    pos.set(n.id, { x, y: topY, w: f.w, h: f.h, cx: x + f.w / 2, cy: topY + f.h / 2 });
    x += f.w + COL_GAP;
  }
  const mainW = x - COL_GAP - MARGIN_X;
  const mainH = Math.max(...mainNodes.map((n) => fitted.get(n.id)!.h), NODE_H_SUB);
  const mainCx = MARGIN_X + mainW / 2;

  // Branch row below, centred under its source (single fan-out) or the
  // main row centre (multiple). Prototype centres under `_normalize…`.
  let branchW = 0;
  for (const n of branchNodes) branchW += fitted.get(n.id)!.w;
  branchW += Math.max(0, branchNodes.length - 1) * COL_GAP;
  let branchX: number;
  if (fanSources.length === 1) {
    const src = pos.get(fanSources[0])!;
    branchX = src.cx - branchW / 2;
  } else {
    branchX = mainCx - branchW / 2;
  }
  branchX = Math.max(MARGIN_X, Math.min(branchX, AVAILABLE_W - branchW - MARGIN_X));
  // When the rows + margins exceed the column, grow the viewBox (scrolls;
  // text never shrinks below its drawn size).
  const branchY = topY + mainH + ROW_GAP;
  let bx = branchX;
  for (const n of branchNodes) {
    const f = fitted.get(n.id)!;
    pos.set(n.id, { x: bx, y: branchY, w: f.w, h: f.h, cx: bx + f.w / 2, cy: branchY + f.h / 2 });
    bx += f.w + COL_GAP;
  }
  const contentRight = Math.max(MARGIN_X + mainW, branchX + branchW);
  const W = Math.max(AVAILABLE_W, contentRight + MARGIN_X);
  // Centre narrow content in a full-width viewBox (prototype leaves the
  // right margin wider than the left on the flow diagram).
  const shift = W > contentRight + MARGIN_X ? 0 : 0;
  void shift;
  const H = branchY + Math.max(...branchNodes.map((n) => fitted.get(n.id)!.h), NODE_H_SUB) + 28;

  return renderFlowSvg(d, mid, unverified, nodes, edges, fitted, pos, W, H, fanSources);
}

function renderFlowLRSingle(
  d: DiagramSpec,
  mid: string,
  unverified: Set<string> | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
  fitted: Map<string, FittedBox>,
  colOf: (n: FlowNode) => number,
  order: Map<string, number>,
): string {
  const byCol = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const c = colOf(n);
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c)!.push(n);
  }
  for (const list of byCol.values()) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
  }
  const colIdx = [...byCol.keys()].sort((a, b) => a - b);
  // Column widths from fitted boxes (tight, already wrapped to MAX_W).
  const widths = new Map<number, number>();
  for (const c of colIdx) widths.set(c, Math.max(...byCol.get(c)!.map((n) => fitted.get(n.id)!.w)));
  const totalW = [...widths.values()].reduce((s, w) => s + w, 0) + Math.max(0, colIdx.length - 1) * COL_GAP + MARGIN_X * 2;
  if (totalW <= AVAILABLE_W) {
    // Single row, multi-node columns stacked vertically.
    const pos = new Map<string, Pos>();
    let x = MARGIN_X;
    const xs = new Map<number, number>();
    for (const c of colIdx) {
      xs.set(c, x);
      x += (widths.get(c) ?? MIN_W) + COL_GAP;
    }
    let H = 80;
    for (const c of colIdx) {
      let y = MARGIN_TOP;
      for (const n of byCol.get(c)!) {
        const f = fitted.get(n.id)!;
        pos.set(n.id, { x: xs.get(c)!, y, w: f.w, h: f.h, cx: xs.get(c)! + f.w / 2, cy: y + f.h / 2 });
        y += f.h + ROW_GAP;
      }
      H = Math.max(H, y - ROW_GAP + MARGIN_BOT);
    }
    const W = totalW;
    return renderFlowSvg(d, mid, unverified, nodes, edges, fitted, pos, W, H, []);
  }
  // Too wide with no fan-out: wrap the chain into rows that fit (like text).
  const seq = [...nodes].sort((a, b) => colOf(a) - colOf(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const rows: FlowNode[][] = [];
  let cur: FlowNode[] = [];
  let curW = 0;
  for (const n of seq) {
    const w = fitted.get(n.id)!.w;
    const add = (cur.length === 0 ? w : COL_GAP + w);
    if (cur.length > 0 && curW + add + MARGIN_X * 2 > AVAILABLE_W) {
      rows.push(cur);
      cur = [n];
      curW = w;
    } else {
      cur.push(n);
      curW += add;
    }
  }
  if (cur.length) rows.push(cur);
  const pos = new Map<string, Pos>();
  let y = MARGIN_TOP;
  let W = MARGIN_X * 2;
  for (const row of rows) {
    const rowW = row.reduce((s, n) => s + fitted.get(n.id)!.w, 0) + Math.max(0, row.length - 1) * COL_GAP;
    W = Math.max(W, rowW + MARGIN_X * 2);
    let rx = MARGIN_X;
    let maxH = NODE_H_NOSUB;
    for (const n of row) {
      const f = fitted.get(n.id)!;
      maxH = Math.max(maxH, f.h);
      pos.set(n.id, { x: rx, y, w: f.w, h: f.h, cx: rx + f.w / 2, cy: y + f.h / 2 });
      rx += f.w + COL_GAP;
    }
    y += maxH + ROW_GAP;
  }
  const H = y - ROW_GAP + MARGIN_BOT + 14;
  return renderFlowSvg(d, mid, unverified, nodes, edges, fitted, pos, W, H, []);
}

function renderFlowSvg(
  d: DiagramSpec,
  mid: string,
  unverified: Set<string> | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
  fitted: Map<string, FittedBox>,
  pos: Map<string, Pos>,
  W: number,
  H: number,
  fanSources: string[],
): string {
  void fanSources;
  // Parallel-edge offsets (deterministic): group by unordered pair.
  const pairCount = new Map<string, number>();
  const pairIndex = new Map<FlowEdge, number>();
  for (const e of edges) {
    const key = [e.from, e.to].sort().join("→");
    pairIndex.set(e, pairCount.get(key) ?? 0);
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  const placed: PlacedEdge[] = [];
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    let [x1, y1] = anchor(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
    let [x2, y2] = anchor(b.cx, b.cy, b.w, b.h, a.cx, a.cy);
    const n = pairCount.get([e.from, e.to].sort().join("→")) ?? 1;
    if (n > 1) {
      const idx = pairIndex.get(e) ?? 0;
      const off = (idx - (n - 1) / 2) * 6;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      x1 += px * off;
      y1 += py * off;
      x2 += px * off;
      y2 += py * off;
    }
    // Tip touches the target border exactly (marker refX=10, no overlap).
    [x2, y2] = shortenEnd(x1, y1, x2, y2, 0.5);
    placed.push({ e, x1, y1, x2, y2 });
  }
  // Fan-out side map for outer-side labels: left target → -1, right → +1.
  const fanSide = new Map<string, number>();
  {
    const byFrom = new Map<string, PlacedEdge[]>();
    for (const p of placed) {
      if (!byFrom.has(p.e.from)) byFrom.set(p.e.from, []);
      byFrom.get(p.e.from)!.push(p);
    }
    for (const list of byFrom.values()) {
      if (list.length === 2 && list.every((p) => p.e.label)) {
        const [p1, p2] = [...list].sort((a, b) => {
          const ax = pos.get(a.e.to)!.cx;
          const bx = pos.get(b.e.to)!.cx;
          return ax - bx;
        });
        fanSide.set(p1.e as unknown as string, -1);
        fanSide.set(p2.e as unknown as string, 1);
      }
    }
  }
  const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const [id, p] of pos) boxes.set(id, { x: p.x, y: p.y, w: p.w, h: p.h });
  const labels = placeEdgeLabels(placed, boxes, fanSide);

  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += markerDef(mid);
  for (const p of placed) {
    const gOpen = p.e.cite ? `<g${citeGroupAttrs(p.e.cite, unverified)}>` : `<g>`;
    s += `${gOpen}<path class="dg-a" d="M${r(p.x1)},${r(p.y1)} L${r(p.x2)},${r(p.y2)}" marker-end="url(#${esc(mid)}-ah)"/>`;
    const lb = labels.get(p.e);
    if (lb) s += edgeLabelSvg(p.e.label!, lb);
    if (p.e.cite) {
      // Edge cite badge beside the label (or midpoint), 8px clear (badge is
      // 14px wide, end-anchored, so right edge = label edge + 22).
      const lb2 = lb;
      const bx = lb2
        ? lb2.anchor === "middle"
          ? lb2.x + lb2.w / 2 + 22
          : lb2.anchor === "start"
            ? lb2.x + lb2.w + 22
            : lb2.x + 22
        : (p.x1 + p.x2) / 2 + 10;
      const by = lb2 ? lb2.y - 6 : (p.y1 + p.y2) / 2 - 8;
      s += citeBadge(bx, by, p.e.cite, unverified);
    }
    s += `</g>`;
  }
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const f = fitted.get(n.id)!;
    const citeAttr = n.cite ? citeGroupAttrs(n.cite, unverified) : "";
    s += `<g${citeAttr}>${boxSvg(p.x, p.y, f, n)}`;
    if (n.cite) s += citeBadge(p.x + p.w - 6, p.y + 14, n.cite, unverified);
    s += `</g>`;
  }
  s += `</svg>`;
  return s;
}

function renderFlowTB(
  d: DiagramSpec,
  mid: string,
  unverified: Set<string> | undefined,
  nodes: FlowNode[],
  edges: FlowEdge[],
  fitted: Map<string, FittedBox>,
  colOf: (n: FlowNode) => number,
  order: Map<string, number>,
): string {
  const byRow = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const row0 = colOf(n);
    if (!byRow.has(row0)) byRow.set(row0, []);
    byRow.get(row0)!.push(n);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
  }
  const rowIdx = [...byRow.keys()].sort((a, b) => a - b);
  const maxCols = Math.max(...[...byRow.values()].map((l) => l.length), 1);
  const cellW = MAX_W + COL_GAP;
  const W = Math.max(AVAILABLE_W, 20 + maxCols * cellW - COL_GAP);
  const pos = new Map<string, Pos>();
  let y = MARGIN_TOP;
  for (const rw of rowIdx) {
    const list = byRow.get(rw)!;
    const totalW = list.reduce((s, n) => s + fitted.get(n.id)!.w, 0) + Math.max(0, list.length - 1) * COL_GAP;
    let x = (W - totalW) / 2;
    let maxH = NODE_H_NOSUB;
    for (const n of list) {
      const f = fitted.get(n.id)!;
      maxH = Math.max(maxH, f.h);
      pos.set(n.id, { x, y, w: f.w, h: f.h, cx: x + f.w / 2, cy: y + f.h / 2 });
      x += f.w + COL_GAP;
    }
    y += maxH + ROW_GAP;
  }
  const H = y - ROW_GAP + MARGIN_BOT + 10;
  return renderFlowSvg(d, mid, unverified, nodes, edges, fitted, pos, W, H, []);
}

function renderPanels(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const [a, b] = (d.panels ?? []) as unknown as Record<string, unknown>[];
  const gap = 58;
  const measTitle = (p: Record<string, unknown>): number => sansLW(String(p["title"] ?? ""));
  const measLines = (p: Record<string, unknown>): number =>
    Math.max(...((p["lines"] as string[]) ?? [""]).map((l) => monoW(l)), 0);
  const needW = (p: Record<string, unknown>): number => {
    const cite = p["cite"] ? BADGE_RESERVE : 0;
    return Math.max(measTitle(p) + PAD_X * 2 + cite, measLines(p) + PAD_X * 2);
  };
  let wa = Math.ceil(needW(a));
  let wb = Math.ceil(needW(b));
  // Fill the 760px column like the prototype (330/340 + 70 gap): expand
  // tight boxes equally; when content overflows, grow the viewBox (scroll).
  const totalNeed = wa + wb + gap + MARGIN_X * 2;
  if (totalNeed < AVAILABLE_W) {
    const extra = AVAILABLE_W - totalNeed;
    wa += Math.floor(extra / 2);
    wb += extra - Math.floor(extra / 2);
  }
  const linesA = (a["lines"] as string[]) ?? [];
  const linesB = (b["lines"] as string[]) ?? [];
  const h = 34 + Math.max(linesA.length, linesB.length) * 22 + 12;
  const W = MARGIN_X + wa + gap + wb + MARGIN_X;
  // Notes below the panels (up to two lines each, centred).
  const noteLines = (p: Record<string, unknown>): string[] => {
    if (!p["note"]) return [];
    return wrapByWidth(String(p["note"]), Math.max(120, (p === a ? wa : wb) - 24), sansLW).lines;
  };
  const nA = noteLines(a);
  const nB = noteLines(b);
  const noteH = Math.max(nA.length, nB.length) * 15;
  const H = h + 28 + noteH + 14;
  const cls = (p: Record<string, unknown>): string => boxClass(p["state"] as string | undefined);
  const panel = (p: Record<string, unknown>, px: number, pw: number): string => {
    let s = `<rect class="${cls(p)}" x="${r(px)}" y="${r(MARGIN_TOP)}" width="${r(pw)}" height="${r(h)}" rx="6"/>`;
    s += `<text class="dg-l" x="${r(px + 12)}" y="${r(MARGIN_TOP + 20)}" text-anchor="start">${esc(String(p["title"] ?? ""))}</text>`;
    ((p["lines"] as string[]) ?? []).forEach((ln, i) => {
      s += `<text class="dg-s" x="${r(px + 12)}" y="${r(MARGIN_TOP + 46 + i * 22)}" text-anchor="start">${esc(ln)}</text>`;
    });
    return s;
  };
  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += markerDef(mid);
  const gOpen = (p: Record<string, unknown>): string => {
    const c = p["cite"] as string | undefined;
    return c ? `<g${citeGroupAttrs(c, unverified)}>` : `<g>`;
  };
  s += gOpen(a) + panel(a, MARGIN_X, wa);
  if (a["cite"]) s += citeBadge(MARGIN_X + wa - 6, MARGIN_TOP + 14, String(a["cite"]), unverified);
  s += `</g>`;
  // Arrow between panels touches both borders exactly (no gap/overlap).
  const ax1 = MARGIN_X + wa;
  const ax2 = MARGIN_X + wa + gap;
  const ay = MARGIN_TOP + h / 2;
  const [sx, sy] = [ax1, ay];
  const [ex, ey] = shortenEnd(ax1, ay, ax2, ay, 0.5);
  s += `<path class="dg-a" d="M${r(sx)},${r(sy)} L${r(ex)},${r(ey)}" marker-end="url(#${esc(mid)}-ah)"/>`;
  s += gOpen(b) + panel(b, MARGIN_X + wa + gap, wb);
  if (b["cite"]) s += citeBadge(MARGIN_X + wa + gap + wb - 6, MARGIN_TOP + 14, String(b["cite"]), unverified);
  s += `</g>`;
  const note = (p: Record<string, unknown>, px: number, pw: number, lines: string[]): string => {
    if (!lines.length) return "";
    const st = p["state"] as string | undefined;
    const ncls = `dg-l${st === "ok" || st === "bad" ? ` ${st}` : ""}`;
    return lines
      .map((ln, i) => `<text class="${ncls}" x="${r(px + pw / 2)}" y="${r(MARGIN_TOP + h + 24 + i * 15)}" text-anchor="middle">${esc(ln)}</text>`)
      .join("");
  };
  s += note(a, MARGIN_X, wa, nA) + note(b, MARGIN_X + wa + gap, wb, nB);
  s += `</svg>`;
  return s;
}

function renderSequence(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const actors = (d.actors ?? []) as string[];
  const msgs = (d.messages ?? []) as { from: number; to: number; label: string; cite?: string }[];
  const n = actors.length;
  const topY = 14;
  // Actor boxes fit their titles (≤2 lines), lanes grow to fit.
  const actorFits = actors.map((a) => {
    const avail = 200;
    const { lines, truncated } = wrapByWidth(a, avail, sansTW);
    const w = Math.min(200, Math.max(96, Math.ceil(Math.max(...lines.map((l) => sansTW(l)), 0) + PAD_X * 2)));
    return { lines, truncated, full: a, w };
  });
  const laneW = Math.max(170, Math.max(...actorFits.map((f) => f.w)) + 30);
  const headH = 48;
  const stepY = 52;
  const W = 20 + n * laneW;
  const H = topY + headH + msgs.length * stepY + 30;
  const centers = actors.map((_, i) => 20 + i * laneW + laneW / 2);
  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += markerDef(mid);
  actors.forEach((a, i) => {
    const cx = centers[i];
    const f = actorFits[i];
    const bw = f.w;
    s += `<rect class="dg-box" x="${r(cx - bw / 2)}" y="${r(topY)}" width="${r(bw)}" height="${r(headH)}" rx="6"/>`;
    if (f.lines.length === 1) {
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 29)}" text-anchor="middle">${esc(f.lines[0])}</text>`;
    } else {
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 21)}" text-anchor="middle">${esc(f.lines[0])}</text>`;
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 36)}" text-anchor="middle">${esc(f.lines[1])}</text>`;
    }
    if (f.truncated) s += `<title>${esc(f.full)}</title>`;
    // Lifeline from the head to the bottom (no arrowhead).
    s += `<path class="dg-a" d="M${r(cx)},${r(topY + headH)} L${r(cx)},${r(H - 12)}"/>`;
  });
  msgs.forEach((m, mi) => {
    const y = topY + headH + 30 + mi * stepY;
    const x1 = centers[m.from];
    const x2 = centers[m.to];
    if (x1 === undefined || x2 === undefined) return;
    const dir = x2 > x1 ? 1 : -1;
    s += `<g${m.cite ? citeGroupAttrs(m.cite, unverified) : ""}>`;
    // Tip touches the lifeline exactly (1px shorten for the marker).
    const [ex, ey] = shortenEnd(x1, y, x2, y, 1);
    s += `<path class="dg-a" d="M${r(x1)},${r(y)} L${r(ex)},${r(ey)}" marker-end="url(#${esc(mid)}-ah)"/>`;
    const gapW = Math.max(60, Math.abs(x2 - x1) - 16);
    const { lines, truncated } = wrapByWidth(m.label, Math.min(220, gapW), sansLW);
    const lx = (x1 + x2) / 2;
    if (lines.length === 1) {
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 8)}" text-anchor="middle">${esc(lines[0])}</text>`;
    } else {
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 15)}" text-anchor="middle">${esc(lines[0])}</text>`;
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 1)}" text-anchor="middle">${esc(lines[1])}</text>`;
    }
    if (truncated) s += `<title>${esc(m.label)}</title>`;
    if (m.cite) {
      // Badge on the outer side of the target lifeline (8px clear, end-
      // anchored so it never overlaps the line or the centred label).
      // Clamped deterministically inside the viewBox.
      const rawX = dir > 0 ? x2 + 22 : x2 - 8;
      const bx = Math.max(20, Math.min(W - 4, rawX));
      s += citeBadge(bx, y - 8, m.cite, unverified);
    }
    s += `</g>`;
  });
  s += `</svg>`;
  return s;
}

/**
 * Render a validated diagram to an SVG string. Throws when invalid
 * (use {@link validateDiagram} for the repair-turn messages).
 * `unverified` lists cite targets the citation validator could not check;
 * those badges render dimmed with an explanatory tooltip.
 */
export function renderDiagramSvg(d: DiagramSpec, mid = "dg", unverified?: Set<string>): string {
  const v = validateDiagram(d);
  if (!v.ok) throw new Error(`invalid diagram: ${v.errors.join("; ")}`);
  if (d.kind === "flow") return renderFlow(d, mid, unverified);
  if (d.kind === "panels") return renderPanels(d, mid, unverified);
  return renderSequence(d, mid, unverified);
}
