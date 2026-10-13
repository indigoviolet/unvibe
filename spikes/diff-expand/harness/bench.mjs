// Timing table: every candidate on a typical file, a large Python file, a 52.7k-line
// TypeScript file and a minified file. Each cell is a fresh node process.
// usage: node bench.mjs  -> ../results/bench.txt
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK, repoDir } from "./materialize.mjs";
const FILES = [
  ["typical .tsx (667 lines, 24 KB)", join(repoDir("unvibe"), "packages/web/src/source/diff/FileSection.tsx"), 300],
  ["typical .py (541 lines, 19 KB)", join(WORK, "files", "broken_ctx.py"), 192],
  ["frame.py (12.7k lines, 447 KB)", join(WORK, "files", "frame.py"), 10840],
  ["checker.ts (52.7k lines, 3.1 MB)", join(WORK, "files", "checker.ts"), 12505],
  ["react.min.js (31 lines, 11 KB)", join(WORK, "files", "react.production.min.js"), 10],
];
const one = new URL("./bench-one.mjs", import.meta.url).pathname;
let out = "";
const say = (s) => { out += s + "\n"; console.log(s); };
const base = [];
for (let i = 0; i < 5; i++) { const t = performance.now(); execFileSync("node", ["-e", "0"]); base.push(performance.now() - t); }
say(`bare "node -e 0" wall time: ${Math.round(base.sort((a, b) => a - b)[2])} ms (included in every cold number's process, not in coldMs itself)`);
for (const [label, file, line] of FILES) {
  say(`\n${label}`);
  for (const which of ["wts", "napi", "lezer", "cli", "outline", "git", "heuristic"]) {
    try {
      const r = JSON.parse(execFileSync("node", [one, which, file, String(line), ["cli", "git", "outline"].includes(which) ? "3" : "7"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
      say(`  ${which.padEnd(10)} cold ${String(r.coldMs).padStart(6)} ms   warm ${String(r.warmMs).padStart(9)} ms   rss ${String(r.rssMB).padStart(5)} MB   answer ${r.answer}`);
    } catch (e) {
      say(`  ${which.padEnd(10)} FAILED: ${String(e.stderr ?? e.message).split("\n").find((l) => l.trim()) ?? ""}`.slice(0, 200));
    }
  }
}
writeFileSync(new URL("../results/bench.txt", import.meta.url), out);
