// Candidate 2: web-tree-sitter (WebAssembly runtime) + prebuilt .wasm grammars
// from @vscode/tree-sitter-wasm. No native code.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { LANGS, chainFrom } from "./units.mjs";

const require = createRequire(import.meta.url);
const GRAMMAR_DIR = join(dirname(require.resolve("@vscode/tree-sitter-wasm/package.json")), "wasm");
let TS = null;
const parsers = new Map();

export const name = "tree-sitter-wasm";
export async function init() {
  TS = await import("web-tree-sitter");
  await TS.Parser.init();
}
export async function parserFor(lang) {
  if (!LANGS[lang]) return null;
  if (!parsers.has(lang)) {
    const language = await TS.Language.load(join(GRAMMAR_DIR, `tree-sitter-${lang}.wasm`));
    const parser = new TS.Parser();
    parser.setLanguage(language);
    parsers.set(lang, parser);
  }
  return parsers.get(lang);
}

const adapter = {
  kind: (n) => n.type,
  parent: (n) => n.parent,
  prev: (n) => n.previousSibling,
  next: (n) => n.nextSibling,
  text: (n) => n.text,
  children: (n) => n.namedChildren,
  rows: (n) => {
    const e = n.endPosition;
    return [n.startPosition.row, e.column === 0 && e.row > n.startPosition.row ? e.row - 1 : e.row];
  },
  name: (n) => {
    const id = n.childForFieldName?.("name");
    if (id) return id.text;
    return n.text.split("\n")[0].slice(0, 60);
  },
};

export async function chain(lang, _path, source, a, b) {
  const parser = await parserFor(lang);
  if (!parser) return null;
  const tree = parser.parse(source);
  try {
    const lines = source.split("\n");
    const first = lines[a - 1] ?? "", last = lines[b - 1] ?? "";
    const node = tree.rootNode.descendantForPosition(
      { row: a - 1, column: first.length - first.trimStart().length },
      { row: b - 1, column: Math.max(0, last.trimEnd().length) },
    );
    const out = chainFrom(LANGS[lang], adapter, node, a - 1, b - 1);
    out.hasError = tree.rootNode.hasError;
    return out;
  } finally {
    tree.delete();
  }
}
