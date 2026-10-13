// Finds hunks likely to be hard cases (deep nesting, leading decorators/comments,
// ranges crossing a definition) so a person can pick them for the corpus.
// usage: node find-hard.mjs <repo> <ext,ext> <maxCommits> <pathRegex>
import { execFileSync } from "node:child_process";
import { heuristicChain } from "./heuristic.mjs";
import { repoDir } from "./materialize.mjs";
const [repo, exts, maxCommits = "200", filter = "."] = process.argv.slice(2);
const dir = repoDir(repo);
const out = execFileSync("node", [new URL("./list-hunks.mjs", import.meta.url).pathname, dir, exts, maxCommits, filter], { encoding: "utf8", maxBuffer: 1 << 30 });
const cache = new Map();
const seen = new Set();
for (const line of out.split("\n")) {
  const m = /^(\w+) (\S+) -\d+,\d+ \+(\d+),(\d+)/.exec(line);
  if (!m || +m[4] === 0) continue;
  const [, sha, path] = m, a = +m[3], b = a + +m[4] - 1;
  const key = `${sha}:${path}`;
  if (!cache.has(key)) {
    try { cache.set(key, execFileSync("git", ["-C", dir, "show", key], { encoding: "utf8", maxBuffer: 1 << 28 })); } catch { cache.set(key, null); }
  }
  const text = cache.get(key);
  if (!text) continue;
  const lines = text.split("\n");
  const chain = heuristicChain(text, a, b);
  const tags = [];
  if (chain.length >= 3) tags.push(`depth${chain.length}`);
  if (chain[0] && /^\s*(@|#\[|\/\/\/|\/\*\*|#)/.test(lines[chain[0].start - 1]) ) tags.push("lead");
  const inner = lines.slice(a - 1, b).filter((l) => /^\s*(?:(?:pub|public|private|protected|static|async|export)\s+)*(def|func|fn|function|class)\b/.test(l)).length;
  if (inner >= 2 || (inner === 1 && b - a > 6 && !/^\s*(?:\w+\s+)*(def|func|fn|function|class)\b/.test(lines[a - 1]))) tags.push("spans");
  if (/\basync\b/.test(chain[0]?.name ?? "")) tags.push("async");
  if (!tags.length) continue;
  const sig = `${path}:${tags.join(",")}:${chain[0]?.name}`;
  if (seen.has(sig)) continue;
  seen.add(sig);
  console.log(`${repo} ${sha} ${path} ${a} ${b} [${tags.join(",")}] ${(chain[0]?.name ?? "").slice(0, 50)}`);
}
