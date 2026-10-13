// Held-out check: hunks that were NOT used while writing the unit rules. There are no
// hand labels here, so this only measures agreement between the tree-sitter rules and two
// independent methods (the Lezer parsers, the indentation heuristic) on the innermost unit,
// and prints the disagreements for reading.
// usage: node heldout.mjs [perLanguage=60]  -> ../results/heldout.txt
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { loadCases } from "./cases.mjs";
import { repoDir } from "./materialize.mjs";
import { languageOf } from "./lang.mjs";
import * as wts from "./cand-wts.mjs";
import * as lezer from "./cand-lezer.mjs";
import * as heur from "./cand-heuristic.mjs";

const PER = +(process.argv[2] ?? 60);
const SOURCES = [
  ["py", "flask", "py", "^src"], ["py", "httpx", "py", "^httpx"],
  ["go", "cobra", "go", "^[a-z_]+\\.go$"], ["go", "gin", "go", "^[a-z_]+\\.go$"],
  ["rs", "ripgrep", "rs", "^crates"], ["rs", "axum", "rs", "^axum/src"],
  ["jv", "gson", "java", "main/java"],
  ["rb", "sinatra", "rb", "^lib|contrib/lib|^test"], ["rb", "rack", "rb", "^lib"],
  ["js", "express", "js", "^(lib|test)/"],
  ["ts", "unvibe", "ts", "^packages/(web|service|shared)/src"],
  ["tsx", "unvibe", "tsx", "^packages/web/src"],
];
await wts.init(); await lezer.init();
const used = new Set(loadCases().map((c) => `${c.repo} ${c.sha} ${c.path} ${c.a}`));
const lister = new URL("./list-hunks.mjs", import.meta.url).pathname;
const byLang = {};
for (const [lang, repo, ext, filter] of SOURCES) {
  const out = execFileSync("node", [lister, repoDir(repo), ext, "240", filter], { encoding: "utf8", maxBuffer: 1 << 30 });
  for (const line of out.split("\n")) {
    const m = /^(\w+) (\S+) -\d+,\d+ \+(\d+),(\d+)/.exec(line);
    if (!m || +m[4] === 0) continue;
    const item = { repo, sha: m[1], path: m[2], a: +m[3], b: +m[3] + +m[4] - 1 };
    if (used.has(`${repo} ${item.sha} ${item.path} ${item.a}`)) continue;
    (byLang[lang] ??= []).push(item);
  }
}
const cache = new Map();
const fileAt = (repo, sha, path) => {
  const k = `${repo}:${sha}:${path}`;
  if (!cache.has(k)) cache.set(k, execFileSync("git", ["-C", repoDir(repo), "show", `${sha}:${path}`], { encoding: "utf8", maxBuffer: 1 << 28 }));
  return cache.get(k);
};
const key = (ch) => (ch && ch[0] ? `${ch[0].start}-${ch[0].end}` : "none");
let report = "";
const say = (s) => { report += s + "\n"; console.log(s); };
say("lang  hunks  ts=lezer  ts=heuristic  ts-has-error-node");
for (const [lang, all] of Object.entries(byLang)) {
  const step = Math.max(1, Math.floor(all.length / PER));
  const sample = all.filter((_, i) => i % step === 0).slice(0, PER);
  let n = 0, sameL = 0, sameH = 0, errs = 0, nL = 0;
  const diffs = [];
  for (const it of sample) {
    let text;
    try { text = fileAt(it.repo, it.sha, it.path); } catch { continue; }
    const lines = text.split("\n");
    let { a, b } = it;
    while (a < b && lines[a - 1].trim() === "") a++;
    while (b > a && lines[b - 1].trim() === "") b--;
    const l = languageOf(it.path);
    const t = await wts.chain(l, it.path, text, a, b);
    const z = await lezer.chain(l, it.path, text, a, b);
    const h = await heur.chain(l, it.path, text, a, b);
    n++;
    if (t.hasError) errs++;
    if (z) { nL++; if (key(t) === key(z)) sameL++; else diffs.push(`  ${it.repo} ${it.sha} ${it.path} ${a}-${b}: tree-sitter ${key(t)} | lezer ${key(z)} | heuristic ${key(h)}`); }
    if (key(t) === key(h)) sameH++;
  }
  say(`${lang.padEnd(5)} ${String(n).padEnd(6)} ${z(sameL, nL).padEnd(9)} ${z(sameH, n).padEnd(13)} ${errs}`);
  for (const d of diffs.slice(0, 12)) report += d + "\n";
}
function z(x, n) { return n ? `${x}/${n}` : "n/a"; }
writeFileSync(new URL("../results/heldout.txt", import.meta.url), report);
