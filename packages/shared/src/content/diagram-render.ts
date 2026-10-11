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
 */
import { validateDiagram, type DiagramSpec } from "./diagram-spec.js";

const SANS_PX = 7.0;
const MONO_PX = 6.6;
const NODE_H = 52;
const NODE_H_NOSUB = 40;
const PAD_X = 16;
const MIN_W = 110;
const MAX_W = 210;
const COL_GAP = 56;
const ROW_GAP = 64;

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

function textW(s: string, px: number): number {
  return [...s].length * px;
}

/** Greedy word wrap to ≤2 lines; second line ellipsized. Full text in <title>. */
function wrap2(text: string, maxChars: number): { lines: string[]; truncated: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [text], truncated: false };
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (cand.length <= maxChars) {
      cur = cand;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= 1) break;
    }
  }
  if (cur) {
    if (lines.length >= 2) {
      // unreachable (we break after 1), kept for clarity
    }
    lines.push(cur);
  }
  // Remainder beyond 2 lines (or a single over-long word) → ellipsize.
  const used = lines.join(" ").length;
  const fullLen = text.length;
  let truncated = used < fullLen;
  // Single word longer than 2×max → hard cut both lines.
  const out = lines.slice(0, 2).map((l, i) => {
    if (l.length > maxChars) {
      truncated = true;
      return i === 1 || lines.length === 1 ? `${l.slice(0, Math.max(0, maxChars - 1))}…` : l.slice(0, maxChars);
    }
    return l;
  });
  if (lines.length > 2) {
    truncated = true;
    out[1] = `${out[1].slice(0, Math.max(0, maxChars - 1))}…`;
  } else if (truncated && out.length === 2 && !out[1].endsWith("…") && used < fullLen) {
    out[1] = `${out[1].slice(0, Math.max(0, maxChars - 1))}…`;
  } else if (truncated && out.length === 1 && out[0].length > maxChars) {
    out[0] = `${out[0].slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return { lines: out.slice(0, 2), truncated };
}

function stateClass(state?: string): string {
  return state === "ok" || state === "bad" ? ` ${state}` : "";
}

function boxClass(state?: string): string {
  return `dg-box${stateClass(state)}`;
}

/** Auto column assignment by topological depth (Kahn), capped at 6 cols. Deterministic. */
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
  // Class on <g> is not styled by prototype.css; the hook matters for tests.
  // Hover preview works via data-refs; keyboard via tabindex/role.
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

function nodeTitleLines(n: FlowNode): { lines: string[]; full: string; truncated: boolean } {
  const { lines, truncated } = wrap2(n.title, 20);
  return { lines, full: n.title, truncated };
}

function nodeWidth(n: FlowNode): number {
  const t = nodeTitleLines(n);
  const wTitle = Math.max(...t.lines.map((l) => textW(l, SANS_PX)));
  const wSub = n.sub ? textW(n.sub.slice(0, 30), MONO_PX) : 0;
  return Math.min(MAX_W, Math.max(MIN_W, Math.ceil(Math.max(wTitle, wSub) + PAD_X * 2)));
}

function boxSvg(x: number, y: number, w: number, h: number, n: FlowNode): string {
  const cls = boxClass(n.state);
  const t = nodeTitleLines(n);
  const sub = n.sub && n.sub.length > 30 ? `${n.sub.slice(0, 29)}…` : n.sub;
  const subTruncated = !!n.sub && n.sub.length > 30;
  let s = `<rect class="${cls}" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="6"/>`;
  if (t.truncated) s += `<title>${esc(t.full)}</title>`;
  if (t.lines.length === 1) {
    const ty = y + (sub ? h / 2 - 3 : h / 2 + 4);
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty)}" text-anchor="middle">${esc(t.lines[0])}</text>`;
  } else {
    const ty1 = y + (sub ? h / 2 - 10 : h / 2 - 2);
    const ty2 = ty1 + 14;
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty1)}" text-anchor="middle">${esc(t.lines[0])}</text>`;
    s += `<text class="dg-t" x="${r(x + w / 2)}" y="${r(ty2)}" text-anchor="middle">${esc(t.lines[1])}</text>`;
  }
  if (sub) {
    s += `<text class="dg-s" x="${r(x + w / 2)}" y="${r(y + h / 2 + 15)}" text-anchor="middle">${esc(sub)}</text>`;
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

/**
 * Edge label position: midpoint pushed perpendicular to the edge so the
 * label sits beside the arrow, never on it — and clear of the boxes the
 * arrow connects (the spike put it on the line, where it touched boxes
 * on diagonal edges). Long labels wrap to two lines.
 */
function edgeLabel(label: string, x1: number, y1: number, x2: number, y2: number): string {
  const { lines, truncated } = wrap2(label, 22);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // Perpendicular unit, biased upward so horizontal edges label above.
  let px = -dy / len;
  let py = dx / len;
  if (py > 0) {
    px = -px;
    py = -py;
  }
  if (Math.abs(dx) > Math.abs(dy) * 2) {
    px = 0;
    py = -1;
  }
  const OFF = 14;
  const lx = mx + px * OFF;
  const ly = my + py * OFF - 2;
  let s = "";
  if (lines.length === 1) {
    s += `<text class="dg-l" x="${r(lx)}" y="${r(ly)}" text-anchor="middle">${esc(lines[0])}</text>`;
  } else {
    s += `<text class="dg-l" x="${r(lx)}" y="${r(ly - 7)}" text-anchor="middle">${esc(lines[0])}</text>`;
    s += `<text class="dg-l" x="${r(lx)}" y="${r(ly + 7)}" text-anchor="middle">${esc(lines[1])}</text>`;
  }
  if (truncated) s += `<title>${esc(label)}</title>`;
  return s;
}

function renderFlow(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const nodes = (d.nodes ?? []) as FlowNode[];
  const edges = (d.edges ?? []) as FlowEdge[];
  const tb = d.direction === "TB";
  const auto = autoCols(nodes, edges);

  // Primary axis: col for LR (x), row-depth for TB (y). Honour explicit hints.
  const colOf = (n: FlowNode): number => n.col ?? auto.get(n.id) ?? 0;
  // Within-column order: explicit row, else document order (deterministic).
  const order = new Map(nodes.map((n, i) => [n.id, n.row ?? i]));

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

  if (!tb) {
    const widths = new Map(colIdx.map((c) => [c, Math.max(...byCol.get(c)!.map(nodeWidth))]));
    const xs = new Map<number, number>();
    let x = 10;
    for (const c of colIdx) {
      xs.set(c, x);
      x += (widths.get(c) ?? MIN_W) + COL_GAP;
    }
    const pos = new Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>();
    const colHeights: number[] = [];
    for (const c of colIdx) {
      let y = 14;
      for (const n of byCol.get(c)!) {
        const w = widths.get(c) ?? MIN_W;
        const h = n.sub ? NODE_H : NODE_H_NOSUB;
        pos.set(n.id, { x: xs.get(c)!, y, w, h, cx: xs.get(c)! + w / 2, cy: y + h / 2 });
        y += h + ROW_GAP;
      }
      colHeights.push(y - ROW_GAP + 10);
    }
    const W = x - COL_GAP + 10;
    const H = Math.max(...colHeights, 80);
    let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
    s += `<defs><marker id="${esc(mid)}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const [x1, y1] = anchor(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
      const [x2, y2] = anchor(b.cx, b.cy, b.w, b.h, a.cx, a.cy);
      const gOpen = e.cite ? `<g${citeGroupAttrs(e.cite, unverified)}>` : `<g>`;
      s += `${gOpen}<path class="dg-a" d="M${r(x1)},${r(y1)} L${r(x2)},${r(y2)}" marker-end="url(#${esc(mid)}-ah)"/>`;
      if (e.label) {
        s += edgeLabel(e.label, x1, y1, x2, y2);
        if (e.cite) s += citeBadge((x1 + x2) / 2 + Math.abs(x2 - x1) / 2 + 8, (y1 + y2) / 2 - 14, e.cite, unverified);
      } else if (e.cite) {
        s += citeBadge((x1 + x2) / 2 + 10, (y1 + y2) / 2 - 8, e.cite, unverified);
      }
      s += `</g>`;
    }
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      const citeAttr = n.cite ? citeGroupAttrs(n.cite, unverified) : "";
      s += `<g${citeAttr}>${boxSvg(p.x, p.y, p.w, p.h, n)}`;
      if (n.cite) s += citeBadge(p.x + p.w - 6, p.y + 14, n.cite, unverified);
      s += `</g>`;
    }
    s += `</svg>`;
    return s;
  }

  // TB: rows top→bottom by depth/col, columns left→right by row hint/order.
  const byRow = new Map<number, FlowNode[]>();
  for (const n of nodes) {
    const r0 = n.col ?? auto.get(n.id) ?? 0;
    if (!byRow.has(r0)) byRow.set(r0, []);
    byRow.get(r0)!.push(n);
  }
  for (const list of byRow.values()) {
    list.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1));
  }
  const rowIdx = [...byRow.keys()].sort((a, b) => a - b);
  const rowWidths = rowIdx.map((rw) => byRow.get(rw)!.length);
  const maxCols = Math.max(...rowWidths, 1);
  const cellW = MAX_W + COL_GAP;
  const W = 20 + maxCols * cellW;
  const pos = new Map<string, { x: number; y: number; w: number; h: number; cx: number; cy: number }>();
  let y = 14;
  for (const rw of rowIdx) {
    const list = byRow.get(rw)!;
    const totalW = list.length * cellW - COL_GAP;
    let x = (W - totalW) / 2;
    let maxH = NODE_H_NOSUB;
    for (const n of list) {
      const w = nodeWidth(n);
      const h = n.sub ? NODE_H : NODE_H_NOSUB;
      maxH = Math.max(maxH, h);
      pos.set(n.id, { x, y, w, h, cx: x + w / 2, cy: y + h / 2 });
      x += cellW;
    }
    y += maxH + ROW_GAP;
  }
  const H = y - ROW_GAP + 24;
  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${esc(mid)}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const [x1, y1] = anchor(a.cx, a.cy, a.w, a.h, b.cx, b.cy);
    const [x2, y2] = anchor(b.cx, b.cy, b.w, b.h, a.cx, a.cy);
    const gOpen = e.cite ? `<g${citeGroupAttrs(e.cite, unverified)}>` : `<g>`;
    s += `${gOpen}<path class="dg-a" d="M${r(x1)},${r(y1)} L${r(x2)},${r(y2)}" marker-end="url(#${esc(mid)}-ah)"/>`;
    if (e.label) {
      s += edgeLabel(e.label, x1, y1, x2, y2);
      if (e.cite) s += citeBadge((x1 + x2) / 2 + Math.abs(x2 - x1) / 2 + 8, (y1 + y2) / 2 - 14, e.cite, unverified);
    } else if (e.cite) {
      s += citeBadge((x1 + x2) / 2 + 10, (y1 + y2) / 2 - 8, e.cite, unverified);
    }
    s += `</g>`;
  }
  for (const n of nodes) {
    const p = pos.get(n.id)!;
    const citeAttr = n.cite ? citeGroupAttrs(n.cite, unverified) : "";
    s += `<g${citeAttr}>${boxSvg(p.x, p.y, p.w, p.h, n)}`;
    if (n.cite) s += citeBadge(p.x + p.w - 6, p.y + 14, n.cite, unverified);
    s += `</g>`;
  }
  s += `</svg>`;
  return s;
}

function renderPanels(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const [a, b] = (d.panels ?? []) as unknown as Record<string, unknown>[];
  const lineW = (p: Record<string, unknown>): number =>
    Math.max(
      ...((p["lines"] as string[]) ?? [""]).map((l) => textW(l, MONO_PX)),
      textW(String(p["title"] ?? ""), SANS_PX),
    );
  const wa = Math.ceil(lineW(a) + 24);
  const wb = Math.ceil(lineW(b) + 24);
  const h = 34 + Math.max((a["lines"] as string[]).length, (b["lines"] as string[]).length) * 22 + 12;
  const gap = 58;
  const W = 10 + wa + gap + wb + 10;
  const H = h + 56;
  const cls = (p: Record<string, unknown>): string => boxClass(p["state"] as string | undefined);
  const panel = (p: Record<string, unknown>, px: number, pw: number): string => {
    let s = `<rect class="${cls(p)}" x="${r(px)}" y="14" width="${r(pw)}" height="${r(h)}" rx="6"/>`;
    s += `<text class="dg-l" x="${r(px + 12)}" y="34" text-anchor="start">${esc(String(p["title"] ?? ""))}</text>`;
    ((p["lines"] as string[]) ?? []).forEach((ln, i) => {
      s += `<text class="dg-s" x="${r(px + 12)}" y="${r(60 + i * 22)}" text-anchor="start">${esc(ln)}</text>`;
    });
    return s;
  };
  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${esc(mid)}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  const gOpen = (p: Record<string, unknown>): string => {
    const c = p["cite"] as string | undefined;
    return c ? `<g${citeGroupAttrs(c, unverified)}>` : `<g>`;
  };
  s += gOpen(a) + panel(a, 10, wa);
  if (a["cite"]) s += citeBadge(10 + wa - 6, 28, String(a["cite"]), unverified);
  s += `</g>`;
  const ax1 = 10 + wa + 5;
  const ax2 = ax1 + gap - 10;
  const ay = 14 + h / 2;
  s += `<path class="dg-a" d="M${r(ax1)},${r(ay)} L${r(ax2)},${r(ay)}" marker-end="url(#${esc(mid)}-ah)"/>`;
  s += gOpen(b) + panel(b, 10 + wa + gap, wb);
  if (b["cite"]) s += citeBadge(10 + wa + gap + wb - 6, 28, String(b["cite"]), unverified);
  s += `</g>`;
  const note = (p: Record<string, unknown>, px: number, pw: number): string => {
    if (!p["note"]) return "";
    const st = p["state"] as string | undefined;
    const ncls = `dg-l${st === "ok" || st === "bad" ? ` ${st}` : ""}`;
    const { lines } = wrap2(String(p["note"]), 40);
    return lines
      .map((ln, i) => `<text class="${ncls}" x="${r(px + pw / 2)}" y="${r(14 + h + 24 + i * 15)}" text-anchor="middle">${esc(ln)}</text>`)
      .join("");
  };
  s += note(a, 10, wa) + note(b, 10 + wa + gap, wb);
  s += `</svg>`;
  return s;
}

function renderSequence(d: DiagramSpec, mid: string, unverified?: Set<string>): string {
  const actors = (d.actors ?? []) as string[];
  const msgs = (d.messages ?? []) as { from: number; to: number; label: string; cite?: string }[];
  const n = actors.length;
  const laneW = 170;
  const topY = 14;
  const headH = 48;
  const stepY = 52;
  const W = 20 + n * laneW;
  const H = topY + headH + msgs.length * stepY + 30;
  const centers = actors.map((_, i) => 20 + i * laneW + laneW / 2);
  let s = `<svg viewBox="0 0 ${r(W)} ${r(H)}" role="img" aria-label="${esc(d.title)}">`;
  s += `<defs><marker id="${esc(mid)}-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>`;
  actors.forEach((a, i) => {
    const cx = centers[i];
    const { lines } = wrap2(a, 18);
    s += `<rect class="dg-box" x="${r(cx - 70)}" y="${r(topY)}" width="140" height="${r(headH)}" rx="6"/>`;
    if (lines.length === 1) {
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 29)}" text-anchor="middle">${esc(lines[0])}</text>`;
    } else {
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 21)}" text-anchor="middle">${esc(lines[0])}</text>`;
      s += `<text class="dg-t" x="${r(cx)}" y="${r(topY + 36)}" text-anchor="middle">${esc(lines[1])}</text>`;
    }
    if (lines.join(" ").length < a.length) s += `<title>${esc(a)}</title>`;
    s += `<path class="dg-a" d="M${r(cx)},${r(topY + headH)} L${r(cx)},${r(H - 12)}"/>`;
  });
  msgs.forEach((m, i) => {
    const y = topY + headH + 30 + i * stepY;
    const x1 = centers[m.from];
    const x2 = centers[m.to];
    if (x1 === undefined || x2 === undefined) return;
    const dir = x2 > x1 ? 1 : -1;
    s += `<g${m.cite ? citeGroupAttrs(m.cite, unverified) : ""}>`;
    s += `<path class="dg-a" d="M${r(x1)},${r(y)} L${r(x2 - dir * 8)},${r(y)}" marker-end="url(#${esc(mid)}-ah)"/>`;
    const { lines, truncated } = wrap2(m.label, 26);
    const lx = (x1 + x2) / 2;
    if (lines.length === 1) {
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 8)}" text-anchor="middle">${esc(lines[0])}</text>`;
    } else {
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 14)}" text-anchor="middle">${esc(lines[0])}</text>`;
      s += `<text class="dg-l" x="${r(lx)}" y="${r(y - 1)}" text-anchor="middle">${esc(lines[1])}</text>`;
    }
    if (truncated) s += `<title>${esc(m.label)}</title>`;
    if (m.cite) s += citeBadge(lx + Math.abs(x2 - x1) / 2 - 2, y - 8, m.cite, unverified);
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
