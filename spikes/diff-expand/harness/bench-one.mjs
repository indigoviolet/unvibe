// One measurement in a fresh process: node bench-one.mjs <candidate> <file> <line> [warmRuns]
// cold = ms from process start until the first answer (module load + init + grammar load +
// parse + walk); warm = median of further full answers (parse + walk) in the same process.
import { readFileSync } from "node:fs";
import { languageOf } from "./lang.mjs";
const [which, file, lineArg, runsArg] = process.argv.slice(2);
const mods = {
  wts: () => import("./cand-wts.mjs"),
  napi: () => import("./cand-astgrep-napi.mjs"),
  cli: () => import("./cand-astgrep-cli.mjs"),
  outline: () => import("./cand-astgrep-outline.mjs"),
  lezer: () => import("./cand-lezer.mjs"),
  heuristic: () => import("./cand-heuristic.mjs"),
  git: async () => (await import("./cand-git.mjs")).gitUserdiff,
};
const cand = await mods[which]();
const source = readFileSync(file, "utf8");
const line = +lineArg, lang = languageOf(file);
const old = source.replace(/\n/, " \n");
await cand.init();
const first = await cand.chain(lang, file, source, line, line, old);
const cold = performance.now();
const times = [];
for (let i = 0; i < +(runsArg ?? 7); i++) {
  const t = performance.now();
  await cand.chain(lang, file, source, line, line, old);
  times.push(performance.now() - t);
}
times.sort((x, y) => x - y);
console.log(JSON.stringify({ which, coldMs: Math.round(cold), warmMs: +times[times.length >> 1].toFixed(2), rssMB: Math.round(process.memoryUsage().rss / 1048576), answer: first?.[0] ? `${first[0].start}-${first[0].end}` : "none" }));
