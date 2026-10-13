// Parses every .ts/.tsx file of a repo at HEAD with the tree-sitter wasm grammars and
// lists the files where the tree contains an ERROR or MISSING node (grammar older than
// the syntax, or a real mis-parse). usage: node parse-errors.mjs <repoDir>
import { execFileSync } from "node:child_process";
import * as wts from "./cand-wts.mjs";
await wts.init();
const repo = process.argv[2];
const files = execFileSync("git", ["-C", repo, "ls-files", "*.ts", "*.tsx"], { encoding: "utf8" }).trim().split("\n").filter((f) => f.includes("/src/"));
let bad = 0;
for (const f of files) {
  const src = execFileSync("git", ["-C", repo, "show", `HEAD:${f}`], { encoding: "utf8", maxBuffer: 1 << 28 });
  const parser = await wts.parserFor(f.endsWith("x") ? "tsx" : "typescript");
  const tree = parser.parse(src);
  if (tree.rootNode.hasError) {
    bad++;
    const q = [tree.rootNode]; let e = null;
    while (q.length && !e) { const n = q.shift(); if (n.type === "ERROR" || n.isMissing) e = n; else for (const c of n.children) if (c.hasError || c.isMissing) q.push(c); }
    console.log(f, e ? `${e.isMissing ? "MISSING " : ""}${e.type} at line ${e.startPosition.row + 1}: ${src.split("\n")[e.startPosition.row].trim().slice(0, 80)}` : "?");
  }
  tree.delete();
}
console.log(`files with parse errors: ${bad}/${files.length}`);
