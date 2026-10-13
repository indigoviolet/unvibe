#!/bin/sh
# usage: sh run.sh   (from spikes/diff-expand/harness/bundle-check, after npm install in spikes/diff-expand)
set -e
OUT=$(mktemp -d)
../../../../node_modules/.bin/esbuild entry.mjs --bundle --platform=node --format=esm --target=node24 --outfile="$OUT/index.js" --log-level=warning
mkdir "$OUT/grammars"
cp ../../node_modules/web-tree-sitter/web-tree-sitter.wasm "$OUT/grammars/"
cp ../../node_modules/@vscode/tree-sitter-wasm/wasm/tree-sitter-python.wasm "$OUT/grammars/"
ls -l "$OUT" "$OUT/grammars" | awk '{print $5, $9}'
(cd / && node "$OUT/index.js")
rm -rf "$OUT"
