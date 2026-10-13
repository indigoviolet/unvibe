/*global console process */
// Copy tree-sitter `.wasm` grammars (issue #133) into the service bundle
// output: `packages/service/dist/grammars/`.
//
// The `.wasm` files ship as plain files — no native code, no install
// script, no new runtime dependency: `web-tree-sitter` and
// `@vscode/tree-sitter-wasm` are devDependencies whose files are copied
// here at build time. The release script ships `dist/grammars/` verbatim,
// so `npm install -g` behaves the same on every platform. Runs on macOS
// and Linux (node only, no shell tricks).
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "packages/service/dist/grammars");

/** `.wasm` files the outline parser loads (the eight spike-tested grammars + the runtime). */
export const GRAMMAR_FILES = [
  "web-tree-sitter.wasm",
  "tree-sitter-python.wasm",
  "tree-sitter-go.wasm",
  "tree-sitter-rust.wasm",
  "tree-sitter-java.wasm",
  "tree-sitter-ruby.wasm",
  "tree-sitter-javascript.wasm",
  "tree-sitter-typescript.wasm",
  "tree-sitter-tsx.wasm",
];

function sourceDirs() {
  return [
    path.join(ROOT, "node_modules/web-tree-sitter"),
    path.join(ROOT, "node_modules/@vscode/tree-sitter-wasm/wasm"),
  ];
}

export function copyGrammars() {
  const [runtimeDir, grammarDir] = sourceDirs();
  const missing = [];
  for (const name of GRAMMAR_FILES) {
    const from = existsSync(path.join(runtimeDir, name))
      ? path.join(runtimeDir, name)
      : path.join(grammarDir, name);
    if (!existsSync(from)) {
      missing.push(name);
      continue;
    }
    mkdirSync(DEST, { recursive: true });
    cpSync(from, path.join(DEST, name));
  }
  if (missing.length > 0) {
    console.error(`copy-grammars: missing ${missing.join(", ")} — run \`npm install\` first`);
    process.exit(1);
  }
  const shipped = readdirSync(DEST).filter((f) => f.endsWith(".wasm")).sort();
  console.log(`copy-grammars: ${shipped.length} files in packages/service/dist/grammars/`);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) copyGrammars();
