// Candidate 1a: @ast-grep/napi (native addon, prebuilt per platform). JS/TS/TSX are built
// in; the other languages come from @ast-grep/lang-* packages (prebuilt parser.so files).
import { createRequire } from "node:module";
import { LANGS, chainFrom } from "./units.mjs";
const require = createRequire(import.meta.url);
let napi = null;
const BUILTIN = { javascript: "JavaScript", typescript: "TypeScript", tsx: "Tsx" };
const DYNAMIC = ["python", "go", "rust", "java", "ruby"];

export const name = "ast-grep napi";
export async function init() {
  napi = require("@ast-grep/napi");
  const langs = {};
  for (const l of DYNAMIC) langs[l] = require(`@ast-grep/lang-${l}`);
  napi.registerDynamicLanguage(langs);
}
export function parse(lang, source) {
  return napi.parse(BUILTIN[lang] ?? lang, source).root();
}
const adapter = {
  kind: (n) => String(n.kind()),
  parent: (n) => n.parent(),
  prev: (n) => n.prev(),
  next: (n) => n.next(),
  text: (n) => n.text(),
  children: (n) => n.children().filter((c) => c.isNamed()),
  rows: (n) => {
    const r = n.range();
    return [r.start.line, r.end.column === 0 && r.end.line > r.start.line ? r.end.line - 1 : r.end.line];
  },
  name: (n) => n.field("name")?.text() ?? n.text().split("\n")[0].slice(0, 60),
};
export async function chain(lang, _path, source, a, b) {
  if (!LANGS[lang]) return null;
  const root = parse(lang, source);
  const lines = source.split("\n");
  const first = lines[a - 1] ?? "", last = lines[b - 1] ?? "";
  const s = { line: a - 1, column: first.length - first.trimStart().length };
  const e = { line: b - 1, column: last.trimEnd().length };
  const covers = (n) => {
    const r = n.range();
    const startsBefore = r.start.line < s.line || (r.start.line === s.line && r.start.column <= s.column);
    const endsAfter = r.end.line > e.line || (r.end.line === e.line && r.end.column >= e.column);
    return startsBefore && endsAfter;
  };
  // ast-grep has no "node at position": walk down from the root.
  let node = root;
  for (;;) {
    const child = node.children().find(covers);
    if (!child) break;
    node = child;
  }
  return chainFrom(LANGS[lang], adapter, node, a - 1, b - 1);
}
