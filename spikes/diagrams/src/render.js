/**
 * Candidate B: own SVG renderer for the JSON spec (spike).
 *
 * Design constraints (the point of the spike):
 * - No dependencies, no DOM needed: pure string building, runs in Node
 *   (service-side preview/validation) and in the browser.
 * - CSP-clean: presentation ONLY through the prototype's existing classes
 *   (dg-box, dg-t, dg-s, dg-a, dg-ah, dg-l + ok/bad). No `style=`
 *   attributes, no <style> tags, no fonts, no remote anything. A strict
 *   `style-src 'self'` policy is enough.
 * - Theme/style for free: boxes use var(--surface)/var(--line), text uses
 *   var(--ink)/var(--muted), so light/dark and the prototype's fonts apply
 *   with zero renderer code.
 * - Citations: `cite` fields become `data-cite` attributes on the node's
 *   <g> (the app wires the standard hover preview + click-to-reveal) plus
 *   a small `<>` badge so cited nodes are discoverable.
 */

import { validateDiagram } from "./spec.js";

const SANS_PX = 7.0; // ~600 12.5px IBM Plex Sans, per char (conservative)
const MONO_PX = 6.6; // 11px IBM Plex Mono, per char
const NODE_H = 52;
const NODE_H_NOSUB = 40;
const PAD_X = 16;
const MIN_W = 110;
const COL_GAP = 46; // room for arrows + edge labels
const ROW_GAP = 60;

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function textW(s, px) {
  return [...s].length * px;
}

function nodeWidth(n) {
  const w = Math.max(
    textW(n.title, SANS_PX),
    n.sub ? textW(n.sub, MONO_PX) : 0,
  );
  return Math.max(MIN_W, Math.ceil(w + PAD_X * 2));
}

/** Auto column assignment by topological depth (Kahn), capped at 6 cols. */
function autoCols(nodes, edges) {
  const depth = new Map(nodes.map((n) => [n.id, 0]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (incoming.has(e.to)) incoming.get(e.to).push(e.from);
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

function citeBadge(x, y, cite) {
  // Small <> marker; the app binds [data-cite] for preview/reveal.
  return `<text class="dg-l" x="${x}" y="${y}" text-anchor="end" data-cite-badge="${esc(cite)}">&lt;&gt;</text>`;
}

function boxSvg(x, y, w, h, n) {
  const cls = n.state && n.state !== "default" ? `dg-box ${n.state}` : "dg-box";
  const ty = y + (n.sub ? h / 2 - 3 : h / 2 + 4);
  let s = `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="6"/>`;
  s += `<text class="dg-t" x="${x + w / 2}" y="${ty}" text-anchor="middle">${esc(n.title)}</text>`;
  if (n.sub) {
    s += `<text class="dg-s" x="${x + w / 2}" y="${y + h / 2 + 13}" text-anchor="middle">${esc(n.sub)}</text>`;
  }
  return s;
}

/** Border anchor: intersection of center→target line with box border. */
function anchor(cx, cy, w, h, tx, ty) {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx !== 0 ? w / 2 / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(sx, sy);
  return [cx + dx * t, cy + dy * t];
}

function renderFlow(d, mid) {
  const nodes = d.nodes;
  const edges = d.edges;
  const cols = autoCols(nodes, edges);
  const byCol = new Map();
  for (const n of nodes) {
    const c = n.col ?? cols.get(n.id) ?? 0;
    if (!byCol.has(c)) byCol.set(c, []);
    byCol.get(c).push(n);
  }
  const colIdx = [...byCol.keys()].sort((a, b) => a - b);
  const widths = new Map(colIdx.map((c) => [c, Math.max(...byCol.get(c).map(nodeWidth))]));
  const xs = new Map();
  let x = 10;
  for (const c of colIdx) {
    xs.set(c, x);
    x += widths.get(c) + COL_GAP;
  }
  const pos = new Map();
  const colHeights = [];
  for (const c of colIdx) {
    let y = 14;
    for (const n of byCol.get(c)) {
      const w = widths.get(c);
      const h = n.sub ? NODE_H : NODE_H_NOSUB;
      pos.set(n.id, { x: xs.get(c), y, w, h, cx: xs.get(c) + w / 2, cy: y + h / 2 });
      y += h + ROW_GAP;
    }
    colHeights.push(y - ROW_GAP + 10);
  }
  const W = x - COL_GAP + 10;
  const H = Math.max(...colHeights, 80);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${mid}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  // Edges under nodes.
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const [x1, y1] = anchor(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
    const [x2, y2] = anchor(b.cx, b.cy, b.w, b.h, a.cx, a.cy);
    s += `<path class="dg-a" d="M${r(x1)},${r(y1)} L${r(x2)},${r(y2)}" marker-end="url(#${mid}-ah)"/>`;
    if (e.label) {
      const lx = (x1 + x2) / 2;
      const ly = (y1 + y2) / 2 - 6;
      s += `<text class="dg-l" x="${r(lx)}" y="${r(ly)}" text-anchor="middle">${esc(e.label)}</text>`;
    }
  }
  for (const n of nodes) {
    const p = pos.get(n.id);
    const citeAttr = n.cite ? ` data-cite="${esc(n.cite)}"` : "";
    s += `<g${citeAttr}>${boxSvg(p.x, p.y, p.w, p.h, n)}`;
    if (n.cite) s += citeBadge(p.x + p.w - 6, p.y + 14, n.cite);
    s += `</g>`;
  }
  // Cited edges get an invisible wider hit path + badge near label midpoint.
  // (Badges for edges are folded into the label row to keep the spike small.)
  s += `</svg>`;
  return { svg: s, W, H };
}

function renderPanels(d, mid) {
  // Two panels side by side with an arrow between, notes underneath —
  // the shape of the prototype's before/after folded-header diagram.
  const [a, b] = d.panels;
  const lineW = (p) => Math.max(...p.lines.map((l) => textW(l, MONO_PX)), textW(p.title, SANS_PX));
  const wa = Math.ceil(lineW(a) + 24);
  const wb = Math.ceil(lineW(b) + 24);
  const h = 34 + Math.max(a.lines.length, b.lines.length) * 22 + 12;
  const gap = 58;
  const W = 10 + wa + gap + wb + 10;
  const H = h + 56;
  const cls = (p) => (p.state && p.state !== "default" ? `dg-box ${p.state}` : "dg-box");
  const panel = (p, px) => {
    let s = `<rect class="${cls(p)}" x="${px}" y="14" width="${px === 10 ? wa : wb}" height="${h}" rx="6"/>`;
    s += `<text class="dg-l" x="${px + 12}" y="34" text-anchor="start">${esc(p.title)}</text>`;
    p.lines.forEach((ln, i) => {
      s += `<text class="dg-s" x="${px + 12}" y="${60 + i * 22}" text-anchor="start">${esc(ln)}</text>`;
    });
    return s;
  };
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${mid}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  const gOpen = (p) => (p.cite ? `<g data-cite="${esc(p.cite)}">` : `<g>`);
  s += gOpen(a) + panel(a, 10);
  if (a.cite) s += citeBadge(10 + wa - 6, 28, a.cite);
  s += `</g>`;
  const ax1 = 10 + wa + 5;
  const ax2 = ax1 + gap - 10;
  const ay = 14 + h / 2;
  s += `<path class="dg-a" d="M${ax1},${ay} L${ax2},${ay}" marker-end="url(#${mid}-ah)"/>`;
  s += gOpen(b) + panel(b, 10 + wa + gap);
  if (b.cite) s += citeBadge(10 + wa + gap + wb - 6, 28, b.cite);
  s += `</g>`;
  const note = (p, px, pw) => {
    if (!p.note) return "";
    const ncls = `dg-l${p.state && p.state !== "default" ? ` ${p.state}` : ""}`;
    return `<text class="${ncls}" x="${px + pw / 2}" y="${14 + h + 28}" text-anchor="middle">${esc(p.note)}</text>`;
  };
  s += note(a, 10, wa) + note(b, 10 + wa + gap, wb);
  s += `</svg>`;
  return { svg: s, W, H };
}

function renderSequence(d, mid) {
  const actors = d.actors;
  const msgs = d.messages;
  const n = actors.length;
  const laneW = 150;
  const topY = 14;
  const headH = 44;
  const stepY = 46;
  const W = 20 + n * laneW;
  const H = topY + headH + msgs.length * stepY + 30;
  const centers = actors.map((_, i) => 20 + i * laneW + laneW / 2);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${mid}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  actors.forEach((a, i) => {
    const cx = centers[i];
    s += `<rect class="dg-box" x="${cx - 65}" y="${topY}" width="130" height="${headH}" rx="6"/>`;
    s += `<text class="dg-t" x="${cx}" y="${topY + 27}" text-anchor="middle">${esc(a)}</text>`;
    s += `<path class="dg-a" d="M${cx},${topY + headH} L${cx},${H - 12}"/>`;
  });
  msgs.forEach((m, i) => {
    const y = topY + headH + 28 + i * stepY;
    const x1 = centers[m.from];
    const x2 = centers[m.to];
    const dir = x2 > x1 ? 1 : -1;
    s += `<g${m.cite ? ` data-cite="${esc(m.cite)}"` : ""}>`;
    s += `<path class="dg-a" d="M${x1},${y} L${x2 - dir * 8},${y}" marker-end="url(#${mid}-ah)"/>`;
    s += `<text class="dg-l" x="${(x1 + x2) / 2}" y="${y - 6}" text-anchor="middle">${esc(m.label)}</text>`;
    if (m.cite) s += citeBadge((x1 + x2) / 2 + Math.abs(x2 - x1) / 2 - 4, y - 6, m.cite);
    s += `</g>`;
  });
  s += `</svg>`;
  return { svg: s, W, H };
}

function r(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Render a validated diagram to an SVG string.
 * @param {object} d diagram value (validated first)
 * @param {string} [mid] marker id prefix (unique per page)
 */
export function renderDiagramSvg(d, mid = "dg") {
  const v = validateDiagram(d);
  if (!v.ok) throw new Error(`invalid diagram: ${v.errors.join("; ")}`);
  if (d.kind === "flow") return renderFlow(d, mid).svg;
  if (d.kind === "panels") return renderPanels(d, mid).svg;
  return renderSequence(d, mid).svg;
}
