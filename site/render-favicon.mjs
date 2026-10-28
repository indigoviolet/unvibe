/*global console Buffer process */
// Renders the favicon PNG fallbacks from favicon.svg with zero dependencies
// (same raw-RGBA -> zlib -> PNG approach as scripts/gen-icons.mjs).
// The SVG is a flat stack of <rect> (x/y/width/height/fill) and <path>
// (absolute M/L/H/V/Z only, fill, optional stroke + stroke-width) shapes,
// painted in document order; the parser covers that whole grammar and
// throws on anything else. Edges are antialiased with an adaptive
// supersample grid (~512 subpixels across).
//
// Run (from the repo root):
//   node site/render-favicon.mjs
// regenerates site/favicon-32.png (32x32) and site/apple-touch-icon.png
// (180x180) from site/favicon.svg. One-off renders (e.g. the app icons in
// packages/web/public, issue #299):
//   node site/render-favicon.mjs <svg-in> <size> <png-out>
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function hexRgb(hex) {
  if (hex === null || hex === undefined) throw new Error("missing color");
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) throw new Error(`bad hex color: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Minimal path parser: absolute M/L/H/V/Z (+z) only.
function parsePath(d) {
  const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+/g);
  if (!tokens) throw new Error("empty path data");
  const pts = [];
  let cur = null;
  let start = null;
  let i = 0;
  const num = () => {
    const t = tokens[i++];
    const v = Number(t);
    if (!/^-?\d*\.?\d+$/.test(t) || Number.isNaN(v)) throw new Error(`expected number, got ${t}`);
    return v;
  };
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (!/^[MLHVZmlhvz]$/.test(cmd)) throw new Error(`unsupported path token: ${cmd}`);
    if (/[mlhvz]/.test(cmd)) throw new Error(`relative commands unsupported: ${cmd}`);
    if (cmd === "Z") {
      if (start) {
        pts.push([...start]);
        cur = [...start];
      }
      continue;
    }
    if (cmd === "M") {
      const x = num(), y = num();
      cur = [x, y];
      start = [x, y];
      pts.push([...cur]);
    } else if (cmd === "L") {
      const x = num(), y = num();
      cur = [x, y];
      pts.push([...cur]);
    } else if (cmd === "H") {
      const x = num();
      cur = [x, cur[1]];
      pts.push([...cur]);
    } else if (cmd === "V") {
      const y = num();
      cur = [cur[0], y];
      pts.push([...cur]);
    }
  }
  if (pts.length < 3) throw new Error("path has too few points");
  return pts;
}

function parseSvg(text) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(text);
  if (!vb) throw new Error("no viewBox");
  const [minX, minY, w, h] = vb[1].trim().split(/\s+/).map(Number);
  // Document-order shapes: <rect .../> and <path .../> (self-closed or not).
  const shapes = [];
  const tagRe = /<(rect|path)\b([^>]*?)\/?>/g;
  let m;
  const attr = (s, name, def) => {
    const r = new RegExp(`${name}="([^"]+)"`).exec(s);
    return r ? r[1] : def;
  };
  while ((m = tagRe.exec(text)) !== null) {
    const [, kind, attrs] = m;
    const fill = hexRgb(attr(attrs, "fill", null));
    if (!fill) throw new Error(`${kind} needs fill`);
    const strokeAttr = attr(attrs, "stroke", null);
    const stroke = strokeAttr ? hexRgb(strokeAttr) : null;
    const swAttr = attr(attrs, "stroke-width", null);
    if (stroke && swAttr === null) throw new Error("stroke needs stroke-width");
    if (kind === "rect") {
      const x = Number(attr(attrs, "x", "0"));
      const y = Number(attr(attrs, "y", "0"));
      const rw = Number(attr(attrs, "width", null));
      const rh = Number(attr(attrs, "height", null));
      if (!(rw > 0 && rh > 0)) throw new Error("rect needs width + height");
      shapes.push({
        fill, stroke, strokeWidth: stroke ? Number(swAttr) : 0,
        pts: [[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]],
      });
    } else {
      const d = attr(attrs, "d", null);
      if (!d) throw new Error("path needs d");
      shapes.push({ fill, stroke, strokeWidth: stroke ? Number(swAttr) : 0, pts: parsePath(d) });
    }
  }
  if (shapes.length === 0) throw new Error("no shapes");
  return { minX, minY, w, h, shapes };
}

// Even-odd point-in-polygon over the closed point ring.
function inside(px, py, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], yi = pts[i][1];
    const xj = pts[j][0], yj = pts[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function render(svg, size) {
  const scale = size / svg.w; // square viewBox (64x64)
  const ss = Math.max(2, Math.ceil(512 / size));
  const px = Buffer.alloc(size * size * 4);
  // Topmost covering shape wins (all shapes are opaque).
  const cover = (vx, vy) => {
    for (let s = svg.shapes.length - 1; s >= 0; s--) {
      const shape = svg.shapes[s];
      if (shape.stroke) {
        const half = shape.strokeWidth / 2;
        for (let i = 0; i < shape.pts.length; i++) {
          const p = shape.pts[i], q = shape.pts[(i + 1) % shape.pts.length];
          if (distToSeg(vx, vy, p[0], p[1], q[0], q[1]) <= half) return shape.stroke;
        }
      }
      if (inside(vx, vy, shape.pts)) return shape.fill;
    }
    return null;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const vx = svg.minX + (x + (sx + 0.5) / ss) / scale;
          const vy = svg.minY + (y + (sy + 0.5) / ss) / scale;
          const col = cover(vx, vy);
          if (col) {
            r += col[0]; g += col[1]; b += col[2]; a += 255;
          }
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.from(type, "ascii");
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([td, data])));
  return Buffer.concat([len, td, data, c]);
}

function writePng(file, size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}

const args = process.argv.slice(2);
const jobs =
  args.length === 0
    ? [
        { svg: join(here, "favicon.svg"), size: 32, out: join(here, "favicon-32.png") },
        { svg: join(here, "favicon.svg"), size: 180, out: join(here, "apple-touch-icon.png") },
      ]
    : args.length === 3
      ? [{ svg: resolve(args[0]), size: Number(args[1]), out: resolve(args[2]) }]
      : null;
if (!jobs || !Number.isInteger(jobs[0].size) || jobs[0].size <= 0) {
  console.error("usage: node site/render-favicon.mjs [<svg-in> <size> <png-out>]");
  process.exit(2);
}
for (const j of jobs) {
  const svg = parseSvg(readFileSync(j.svg, "utf8"));
  if (svg.w !== svg.h) throw new Error("square viewBox only");
  writePng(j.out, j.size, render(svg, j.size));
}
