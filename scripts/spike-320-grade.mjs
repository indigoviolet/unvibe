/*global console process */
// Spike #320 blind grade: a separate pass that cannot see source labels.
//   node scripts/spike-320-grade.mjs [--cap-left 0.90] [--dry-run]
// Reads docs/spikes/320-fork-source/raw/results.json, shuffles each question's
// answers under neutral labels (Answer 1..N, seeded per question), asks pi to
// score correctness / specificity / redundancy against the ground-truth key,
// then maps scores back to sources only in the output file. Grading spend is
// charged against the same $1 spike cap by the caller's remaining budget.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pi403Error, PiSession } from "./spike-320-harness.mjs";
import {
  assertPriced,
  costOf,
  fetchPiCatalog,
  findCatalogEntry,
  formatUsd,
  precheckModelOffered,
  resolvePiCmd,
} from "./live-pi-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPIKE_DIR = path.join(ROOT, "docs", "spikes", "320-fork-source");
const MODEL = { provider: "pi", model: "muse-spark-1.3-contributor" };
const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const capIdx = argv.indexOf("--cap");
const CAP = capIdx >= 0 ? Number(argv[capIdx + 1]) : 1;

function shuffled(items, seedText) {
  let seed = 2166136261;
  for (const ch of seedText) { seed ^= ch.codePointAt(0); seed = Math.imul(seed, 16777619); }
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    seed = Math.imul(seed ^ (seed >>> 13), 16777619);
    const j = Math.abs(seed) % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  const questionsDoc = JSON.parse(fs.readFileSync(path.join(SPIKE_DIR, "questions.json"), "utf8"));
  const raw = JSON.parse(fs.readFileSync(path.join(SPIKE_DIR, "raw", "results.json"), "utf8"));
  const alreadySpent = raw.dryRun ? 0 : Number(raw.spendUsd ?? 0);
  let rates = { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 };
  if (!DRY) {
    precheckModelOffered(resolvePiCmd(), MODEL);
    const catalog = await fetchPiCatalog(resolvePiCmd());
    rates = assertPriced(findCatalogEntry(catalog, MODEL), { ...MODEL, allowUnpriced: false });
    console.log(`grade: ask spend already ${formatUsd(alreadySpent)} of cap ${formatUsd(CAP)}`);
  }
  let gradeSpend = 0;
  const grades = [];
  for (const q of questionsDoc.questions) {
    const recs = raw.results.filter((r) => r.question === q.id && r.answer);
    if (recs.length === 0) continue;
    const blind = shuffled(recs, q.id).map((r, i) => ({ label: `Answer ${i + 1}`, source: r.source, toolReads: (r.toolReads ?? []).length, answer: r.answer }));
    const prompt = [
      "Grade these answers to one code-review question. You do not know how each answer was produced; grade only the text.",
      "",
      `Question: ${q.question}`,
      "",
      "Ground truth (an answer is correct only where it matches these points; penalise invented file names, line numbers or behaviour):",
      ...q.key.map((k) => `- ${k}`),
      "",
      "Score each answer 1-5 on: correctness (matches ground truth, no invented claims), specificity (cites real files/lines/mechanisms vs vague restatement), redundancy (5 = no wasted re-derivation or repetition; lower when it re-reads or repeats material it was already given — judge from the text alone).",
      "Reply with ONLY a JSON array like [{\"label\":\"Answer 1\",\"correctness\":3,\"specificity\":3,\"redundancy\":3,\"why\":\"one line\"}].",
      "",
      ...blind.map((b) => `## ${b.label}\n\n${b.answer}`),
    ].join("\n");
    let scores = [];
    let usage = { inputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, outputTokens: 0 };
    if (DRY) {
      scores = blind.map((b) => ({ label: b.label, correctness: 3, specificity: 3, redundancy: 3, why: "dry-run stub grade" }));
    } else {
      const session = new PiSession(process.cwd(), fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-spike320-grade-")));
      try {
        const res = await session.prompt(prompt);
        usage = res.usage;
        const m = res.text.match(/\[[\s\S]*\]/);
        if (!m) throw new Error(`grade ${q.id}: no JSON array in reply: ${res.text.slice(0, 200)}`);
        scores = JSON.parse(m[0]);
      } finally { session.close(); }
      gradeSpend += costOf(usage, rates);
      if (alreadySpent + gradeSpend > CAP) throw new Error(`grade would exceed cap: asks ${formatUsd(alreadySpent)} + grades ${formatUsd(gradeSpend)} > ${formatUsd(CAP)}`);
    }
    for (const b of blind) {
      const s = scores.find((x) => x.label === b.label) ?? {};
      grades.push({ question: q.id, source: b.source, blindLabel: b.label, toolReads: b.toolReads, correctness: s.correctness ?? null, specificity: s.specificity ?? null, redundancy: s.redundancy ?? null, why: s.why ?? "" });
    }
    console.log(`${q.id}: graded ${blind.length} answers (grade spend so far ${formatUsd(gradeSpend)})`);
  }
  const out = { dryRun: DRY, gradeSpendUsd: gradeSpend, askSpendUsd: alreadySpent, totalSpendUsd: alreadySpent + gradeSpend, grades };
  fs.writeFileSync(path.join(SPIKE_DIR, "raw", "grades.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`grades -> raw/grades.json (total spend ${formatUsd(out.totalSpendUsd)} / cap ${formatUsd(CAP)})`);
}

main().catch((e) => {
  if (e instanceof Pi403Error) { console.error(`STOP: ${e.message}`); process.exit(3); }
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
