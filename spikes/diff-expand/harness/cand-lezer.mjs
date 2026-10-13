// Extra candidate: Lezer parsers (pure JavaScript, no wasm, no native code).
// Published grammars cover JS/TS/TSX, Python, Go, Rust, Java. No Ruby.
import { createRequire } from "node:module";
import { LEZER, chainFrom } from "./units.mjs";
const require = createRequire(import.meta.url);
const parsers = {};
export const name = "lezer";
export async function init() {
  const js = require("@lezer/javascript").parser;
  parsers.javascript = js.configure({ dialect: "jsx" });
  parsers.typescript = js.configure({ dialect: "ts" });
  parsers.tsx = js.configure({ dialect: "ts jsx" });
  parsers.python = require("@lezer/python").parser;
  parsers.go = require("@lezer/go").parser;
  parsers.rust = require("@lezer/rust").parser;
  parsers.java = require("@lezer/java").parser;
}
export function parse(lang, source) { return parsers[lang].parse(source); }
export async function chain(lang, _path, source, a, b) {
  if (!parsers[lang]) return null;
  const tree = parse(lang, source);
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  const rowOf = (off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; } return lo; };
  const adapter = {
    kind: (n) => n.name,
    parent: (n) => n.parent,
    prev: (n) => n.prevSibling,
    next: (n) => n.nextSibling,
    text: (n) => source.slice(n.from, n.to),
    children: (n) => { const out = []; for (let c = n.firstChild; c; c = c.nextSibling) out.push(c); return out; },
    rows: (n) => {
      let end = n.to;
      while (end > n.from && /\s/.test(source[end - 1])) end--;
      return [rowOf(n.from), rowOf(Math.max(n.from, end - 1))];
    },
    name: (n) => source.slice(n.from, Math.min(n.to, n.from + 200)).split("\n")[0].slice(0, 60),
  };
  const lines = source.split("\n");
  const first = lines[a - 1] ?? "", last = lines[b - 1] ?? "";
  const from = starts[a - 1] + (first.length - first.trimStart().length);
  const to = starts[b - 1] + last.trimEnd().length;
  let node = tree.resolveInner(from, 1);
  while (node.parent && (node.from > from || node.to < to)) node = node.parent;
  return chainFrom(LEZER[lang], adapter, node, a - 1, b - 1);
}
