// Runs every candidate over the corpus and scores it against the hand-written labels.
// usage: node score.mjs [caseIdPrefix]   -> prints tables, writes ../results/scores.json
import { mkdirSync, writeFileSync } from "node:fs";
import { loadCases } from "./cases.mjs";
import { materialize } from "./materialize.mjs";
import { languageOf } from "./lang.mjs";
import { isLeadOrBlank } from "./textlead.mjs";
import * as wts from "./cand-wts.mjs";
import * as sgNapi from "./cand-astgrep-napi.mjs";
import * as sgCli from "./cand-astgrep-cli.mjs";
import * as sgOutline from "./cand-astgrep-outline.mjs";
import * as lezer from "./cand-lezer.mjs";
import * as heur from "./cand-heuristic.mjs";
import { gitDefault, gitUserdiff } from "./cand-git.mjs";

const CANDS = [wts, sgNapi, sgCli, sgOutline, lezer, gitUserdiff, gitDefault, heur];
const filter = process.argv[2] ?? "";

function judge(exp, got, lines) {
  if (!exp && !got) return "exact";
  if (!exp) return "wrong";
  if (!got) return "nothing";
  if (got.end !== exp.end) return "wrong";
  if (got.start === exp.start) return "exact";
  const lo = Math.min(got.start, exp.start), hi = Math.max(got.start, exp.start);
  return lines.slice(lo - 1, hi - 1).every(isLeadOrBlank) ? "lead" : "wrong";
}

for (const c of CANDS) await c.init();
const rows = [];
for (const c of loadCases()) {
  if (!c.id.startsWith(filter)) continue;
  const m = materialize(c);
  const lines = m.newText.split("\n");
  let { a, b } = c;
  while (a < b && lines[a - 1].trim() === "") a++;
  while (b > a && lines[b - 1].trim() === "") b--;
  const lang = languageOf(c.path);
  const row = { id: c.id, lang: c.lang, note: c.note, range: `${a}-${b}`, expected: c.expected, results: {} };
  for (const cand of CANDS) {
    let chain, error = null;
    try { chain = await cand.chain(lang, c.path, m.newText, a, b, m.oldText); } catch (e) { error = String(e.message ?? e).split("\n")[0].slice(0, 200); chain = null; }
    const got = (chain ?? []).map((u) => ({ start: u.start, end: u.end }));
    let verdict = null, chainOk = null;
    if (c.expected) {
      verdict = chain === null ? (error ? "error" : "unsupported") : judge(c.expected[0], got[0], lines);
      if (chain !== null) chainOk = got.length === c.expected.length && c.expected.every((e, i) => ["exact", "lead"].includes(judge(e, got[i], lines)));
    }
    row.results[cand.name] = { verdict, chainOk, got, error };
  }
  rows.push(row);
}

const langs = [...new Set(rows.map((r) => r.lang))];
const pad = (s, n) => String(s).padEnd(n);
console.log("\nInnermost unit: exact / off-by-leading / wrong / nothing / unsupported, per language");
console.log(pad("candidate", 20) + langs.map((l) => pad(l, 14)).join("") + "ALL");
const summary = {};
for (const cand of CANDS) {
  let line = pad(cand.name, 20);
  const tot = { exact: 0, lead: 0, wrong: 0, nothing: 0, unsupported: 0, error: 0, n: 0, chainOk: 0, multi: 0, multiOk: 0 };
  summary[cand.name] = { perLang: {} };
  for (const l of [...langs, "ALL"]) {
    const t = { exact: 0, lead: 0, wrong: 0, nothing: 0, unsupported: 0, error: 0, n: 0, chainOk: 0, multi: 0, multiOk: 0 };
    for (const r of rows) {
      if (!r.expected || (l !== "ALL" && r.lang !== l)) continue;
      const x = r.results[cand.name];
      t[x.verdict]++; t.n++;
      if (x.chainOk) t.chainOk++;
      if (r.expected.length >= 2) { t.multi++; if (x.chainOk) t.multiOk++; }
    }
    summary[cand.name].perLang[l] = t;
    line += pad(`${t.exact}/${t.lead}/${t.wrong}/${t.nothing}/${t.unsupported + t.error}`, l === "ALL" ? 16 : 14);
    if (l === "ALL") line += ` of ${t.n}; whole chain right ${t.chainOk}/${t.n}; chains of 2+ levels ${t.multiOk}/${t.multi}`;
  }
  console.log(line);
}
console.log("\nFailures (innermost not exact, or chain wrong):");
for (const cand of CANDS) {
  const bad = rows.filter((r) => r.expected && (r.results[cand.name].verdict !== "exact" || !r.results[cand.name].chainOk));
  console.log(`\n## ${cand.name}: ${bad.length}`);
  for (const r of bad) {
    const x = r.results[cand.name];
    const f = (ch) => (ch.length ? ch.map((u) => `${u.start}-${u.end}`).join("; ") : "none");
    console.log(`  ${pad(r.id, 6)} ${pad(x.verdict, 11)} chain ${x.chainOk ? "ok " : "BAD"} want ${f(r.expected)} | got ${x.error ?? f(x.got)} | ${r.note}`);
  }
}
mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
if (!filter) writeFileSync(new URL("../results/scores.json", import.meta.url), JSON.stringify({ summary, rows }, null, 1));
