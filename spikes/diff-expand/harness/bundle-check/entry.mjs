// Bundling check: can the service's esbuild bundle carry web-tree-sitter, with the
// runtime .wasm and the grammar .wasm files as plain files next to the bundle?
import { Parser, Language } from "web-tree-sitter";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
await Parser.init({ locateFile: (name) => join(here, "grammars", name) });
const lang = await Language.load(join(here, "grammars", "tree-sitter-python.wasm"));
const parser = new Parser();
parser.setLanguage(lang);
const tree = parser.parse("class A:\n    def f(self):\n        return 1\n");
const fn = tree.rootNode.descendantForPosition({ row: 2, column: 8 });
let n = fn;
while (n && n.type !== "function_definition") n = n.parent;
console.log("bundled ok:", n.type, n.startPosition.row + 1, n.endPosition.row + 1);
