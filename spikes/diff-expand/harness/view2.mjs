// Labelling aid: prints the changed lines, then the tree-sitter chain as a PROPOSAL with
// the lines around each boundary, plus every definition-looking line between the proposed
// start and the hunk (to catch a nested unit the proposal skipped). A person reads these
// and writes the expected chain in corpus/cases.txt.
import { materialize } from "./materialize.mjs";
import { languageOf } from "./lang.mjs";
import * as wts from "./cand-wts.mjs";
await wts.init();
const DEF = /^\s*(?:(?:pub(?:\([^)]*\))?|public|private|protected|static|final|abstract|async|export|default|unsafe|const)\s+)*(?:def|func|fn|function|class|impl|trait|struct|enum|interface|module|mod|namespace)\b|=>\s*\{\s*$|\bdo(?:\s*\|[^|]*\|)?\s*$|\bfunc\(.*\{\s*$|function\s*\w*\(.*\{\s*$/;
for (const spec of process.argv.slice(2)) {
  const [repo, sha, path, a0, b0] = spec.split(/\s+/);
  const c = { id: spec, repo, sha, path, a: +a0, b: +(b0 ?? a0) };
  let m;
  try { m = materialize(c); } catch (e) { console.log(`!! ${spec}: ${e.message}`); continue; }
  const L = m.newText.split("\n");
  let { a, b } = c;
  while (a < b && L[a - 1].trim() === "") a++;
  while (b > a && L[b - 1].trim() === "") b--;
  const show = (from, to, mark) => {
    for (let i = Math.max(1, from); i <= Math.min(L.length, to); i++) console.log(`  ${mark}${String(i).padStart(5)}| ${L[i - 1].slice(0, 100)}`);
  };
  console.log(`\n=== ${repo} ${sha} ${path} ${a} ${b}  (${L.length} lines)`);
  show(a, Math.min(b, a + 3), "+");
  if (b > a + 3) { console.log(`  +  ...`); show(b, b, "+"); }
  const ch = await wts.chain(languageOf(path), path, m.newText, a, b);
  let prevStart = a;
  for (const u of ch ?? []) {
    console.log(` -- proposed ${u.start}-${u.end} ${u.kind} ${u.name}`);
    show(u.start - 2, u.start, " ");
    const defs = [];
    for (let i = u.start + 1; i < prevStart; i++) if (DEF.test(L[i - 1])) defs.push(i);
    const near = defs.slice(-3);
    if (defs.length) console.log(`       defs between: ${defs.length}; nearest: ${near.map((i) => `${i}:${L[i - 1].trim().slice(0, 50)}`).join(" || ")}`);
    console.log("       ...");
    show(u.end, u.end + 1, " ");
    prevStart = u.start;
  }
  if (!ch?.length) console.log(" -- proposed: none");
}
