// Generates the PWA icons (packages/web/public/*.png) with zero
// dependencies: raw RGBA -> zlib -> PNG. Run: node scripts/gen-icons.mjs
// Design: teal rounded square with a white "U" (block letter, drawn with
// rects). The maskable variant is full-bleed (no transparency, padded U)
// per the maskable safe-zone rule; the any-purpose variants keep rounded
// corners on transparency.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEAL = [13, 148, 136, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

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

function writePng(file, size, paint) {
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, col) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const o = (y * size + x) * 4;
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = col[3];
  };
  paint(set, size);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}

// Block-letter U: two vertical bars + bottom bar, in unit coordinates.
function paintU(set, size, x0, y0, w, bar) {
  const X = (u) => Math.round(x0 + u * w);
  const Y = (u) => Math.round(y0 + u * w);
  for (let y = Y(0); y < Y(0.78); y++)
    for (let x = X(0); x < X(bar); x++) set(x, y, WHITE);
  for (let y = Y(0); y < Y(0.78); y++)
    for (let x = X(1 - bar); x < X(1); x++) set(x, y, WHITE);
  for (let y = Y(0.62); y < Y(1); y++)
    for (let x = X(0); x < X(1); x++) set(x, y, WHITE);
}

function roundedBg(maskable) {
  return (set, size) => {
    const r = maskable ? 0 : size * 0.22;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let inside = true;
        if (!maskable) {
          const cx = Math.min(x, size - 1 - x);
          const cy = Math.min(y, size - 1 - y);
          if (cx < r && cy < r) {
            const dx = r - cx, dy = r - cy;
            inside = dx * dx + dy * dy <= r * r;
          }
        }
        set(x, y, inside ? TEAL : CLEAR);
      }
    }
    if (maskable) paintU(set, size, size * 0.28, size * 0.24, size * 0.44, 0.24);
    else paintU(set, size, size * 0.3, size * 0.26, size * 0.4, 0.24);
  };
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "web", "public");
writePng(join(dir, "icon-192.png"), 192, roundedBg(false));
writePng(join(dir, "icon-512.png"), 512, roundedBg(false));
writePng(join(dir, "icon-512-maskable.png"), 512, roundedBg(true));
