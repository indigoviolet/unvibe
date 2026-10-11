/**
 * Model-reliability live test: both providers × candidates A–E.
 * Short prompts built from fixtures/urllib3-5020 conn hunk 0; each generation
 * scored valid-first-try / valid-after-one-repair / cites-correct.
 * Raw outputs saved to out/rel/ for audit. Validators run in Node except
 * Mermaid (browser render pass in validate-mmd.mjs).
 *
 * Usage: node src/reliability.mjs [only-provider] [only-candidate]
 *   e.g. node src/reliability.mjs claude A
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { validateDiagram } from "./spec.js";
import { D2 } from "@d2lang/d2";
import { Graphviz } from "@hpcc-js/wasm/graphviz";

const HUNK = `diff --git a/src/urllib3/connection.py b/src/urllib3/connection.py
@@ -77,6 +77,37 @@ class BaseSSLError(BaseException):
 _CONTAINS_CONTROL_CHAR_RE = re.compile(r"[^-!#$%&'*+.^\`_|~0-9a-zA-Z]")
+# Starting the optional OWS match at the beginning of a whitespace run avoids
+# quadratic backtracking for long header values.
+_OBSOLETE_FOLD_RE = re.compile(r"(?:(?<![ \\t])[ \\t]+)?\\r\\n[ \\t]+")
+
+
+def _normalize_header_value(value: str) -> str:
+    if "\\r\\n" not in value:
+        return value
+    return _OBSOLETE_FOLD_RE.sub(" ", value)
+
+
+def _normalize_header_values(
+    message: http.client.HTTPMessage,
+) -> list[tuple[str, str]]:
+    header_items = message.items()
+    headers_changed = False
+    for index, (name, value) in enumerate(header_items):
+        normalized_value = _normalize_header_value(value)
+        if normalized_value != value:
+            header_items[index] = (name, normalized_value)
+            headers_changed = True
+
+    if headers_changed:
+        # Keep the original message in sync for downstream consumers such as
+        # cookie jars while preserving its identity and header ordering.
+        for name, _ in header_items:
+            del message[name]
+        for name, value in header_items:
+            message[name] = value
+
+    return header_items`;

const CONTEXT = `You are documenting this diff hunk from urllib3 (fileKey "conn",
src/urllib3/connection.py). Citable new-side line ranges: conn lines 77-113
(the helpers shown below) and conn lines 647-654 (the getresponse call site,
not shown). Draw the header data flow in 5-7 nodes: server with folded header
-> http.client parse_headers -> HTTPMessage keeps CRLF -> _normalize helpers
(OWS CRLF RWS becomes one space) -> HTTPHeaderDict r.headers AND the same
HTTPMessage object (Requests' cookie jar reads it).

Diff hunk:
${HUNK}`;

const FORMATS = {
  A: {
    fence: "mermaid",
    n: 8,
    prompt: `Output ONLY one fenced \`\`\`mermaid block: a flowchart (TB or LR)
with 5-7 nodes and short labels for the flow above. Cite the code on 1-2
nodes by putting a token like [[diff:conn:80-88]] or [[diff:conn:650-651]]
inside the node label. No prose before or after the block.`,
  },
  B: {
    fence: "diagram-json",
    n: 8,
    prompt: `Output ONLY one fenced \`\`\`diagram-json block with this schema:
{"version":1,"kind":"flow","title":"<plain, no brackets>","direction":"LR",
 "nodes":[{"id":"<lowercase-dashes>","title":"<1-48 chars, plain, NO [ ]>","sub":"<optional second line>",
 "state":"default|ok|bad","cite":"<optional: diff:conn:START-END, no brackets>","col":0}],
 "edges":[{"from":"<id>","to":"<id>","label":"<optional>"}]}
Rules: 5-7 nodes; ids unique; every edge endpoint exists; title/sub plain
text (never link tokens); cite uses the BARE form diff:conn:80-88 on 1-2
nodes/edges, ranges inside 77-113 or 647-654. No prose before or after.`,
  },
  C: {
    fence: "d2",
    n: 8,
    prompt: `Output ONLY one fenced \`\`\`d2 block (D2 language: https://d2lang.com):
direction right, 5-7 shapes with short labels (quote labels containing
newlines as "line1\\nline2"), connected srv -> cli style. On 1-2 shapes add
a line 'tooltip: "diff:conn:80-88"' (bare form, ranges inside 77-113 or
647-654) to record the code citation. No prose before or after.`,
  },
  D: {
    fence: "json",
    n: 8,
    prompt: `Output ONLY one fenced \`\`\`json block: an array of Excalidraw
skeleton elements on an 800x400 canvas (origin top-left, y grows down).
Element shapes (ABSOLUTE x/y numbers required):
rectangle {"type":"rectangle","id":"a","x":10,"y":20,"width":150,"height":70}
text {"type":"text","id":"a-t","x":18,"y":30,"width":134,"height":40,"text":"Title\\nsubtitle","fontSize":15}
arrow {"type":"arrow","id":"e1","x":160,"y":55,"width":28,"height":0,"points":[[0,0],[28,0]]}
Draw the flow with 5-7 labelled boxes (text inside boxes) and arrows.
On 1-2 elements add "metadata":{"cite":"diff:conn:80-88"} (bare form,
ranges inside 77-113 or 647-654). Output NUMBERS for all coordinates,
no prose before or after.`,
  },
  E: {
    fence: "dot",
    n: 4,
    prompt: `Output ONLY one fenced \`\`\`dot block (Graphviz DOT):
digraph with rankdir=LR, node [shape=box], 5-7 nodes with short labels
("line1\\nline2" for two lines), connected a -> b. On 1-2 nodes add
URL="diff:conn:80-88" (bare form, ranges inside 77-113 or 647-654) to
record the code citation. No prose before or after.`,
  },
};

function extractFence(text, fence) {
  const m = text.match(new RegExp("```" + fence + "\\s*\\n([\\s\\S]*?)```"));
  return m ? m[1].trim() : null;
}

// Citable ranges: conn new-side 77-113 and 647-654.
function citeScore(tokens) {
  let ok = false;
  for (const t of tokens) {
    const m = t.match(/^(?:diff|code):([A-Za-z0-9_./-]+):(\d+)(?:-(\d+))?/);
    if (!m) continue;
    if (m[1] !== "conn") continue;
    const s = Number(m[2]);
    const e = m[3] ? Number(m[3]) : s;
    if ((s >= 77 && e <= 113) || (s >= 647 && e <= 654)) { ok = true; break; }
  }
  return ok;
}

function scanTokens(text) {
  const out = [];
  for (const m of text.matchAll(/\[\[(diff|code):[^\]]+\]\]/g)) out.push(m[0].slice(2, -2));
  for (const m of text.matchAll(/"(diff:conn:\d+(?:-\d+)?)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/URL="(diff:[^"]+)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/tooltip:\s*"?(diff:[^"\s]+)"?/g)) out.push(m[1]);
  for (const m of text.matchAll(/"cite"\s*:\s*"(diff:[^"]+)"/g)) out.push(m[1]);
  return [...new Set(out)];
}

function validateA(body) {
  const src = extractFence(body, "mermaid");
  if (!src) return { ok: false, error: "no mermaid block", cites: [] };
  const first = src.split("\n")[0].trim();
  if (!/^(flowchart|sequenceDiagram|graph)\b/.test(first)) {
    return { ok: false, error: `bad header: ${first.slice(0, 60)}`, cites: [] };
  }
  const opens = (src.match(/\[/g) || []).length;
  const closes = (src.match(/\]/g) || []).length;
  if (Math.abs(opens - closes) > 2) {
    return { ok: false, error: `unbalanced brackets [${opens}] ]${closes}`, cites: [] };
  }
  return { ok: true, error: null, cites: scanTokens(src), src };
}

function validateB(body) {
  const src = extractFence(body, "diagram-json");
  if (!src) return { ok: false, error: "no diagram-json block", cites: [] };
  let d;
  try { d = JSON.parse(src); } catch (e) { return { ok: false, error: "JSON: " + String(e.message).slice(0, 120), cites: [] }; }
  const v = validateDiagram(d);
  return { ok: v.ok, error: v.ok ? null : v.errors.join("; ").slice(0, 300), cites: v.cites };
}

async function validateC(d2, body) {
  const src = extractFence(body, "d2");
  if (!src) return { ok: false, error: "no d2 block", cites: [] };
  try {
    await d2.compile(src);
  } catch (e) { return { ok: false, error: "D2: " + String(e).slice(0, 200), cites: [] }; }
  return { ok: true, error: null, cites: scanTokens(src).filter((t) => t.startsWith("diff:")) };
}

function validateD(body) {
  const src = extractFence(body, "json");
  if (!src) return { ok: false, error: "no json block", cites: [] };
  let els;
  try { els = JSON.parse(src); } catch (e) { return { ok: false, error: "JSON: " + String(e.message).slice(0, 120), cites: [] }; }
  if (!Array.isArray(els) || els.length < 3) return { ok: false, error: "not an element array", cites: [] };
  const errs = [];
  const ids = new Set();
  for (const el of els) {
    if (typeof el !== "object" || !el) { errs.push("non-object element"); continue; }
    if (!["rectangle", "ellipse", "text", "arrow", "line"].includes(el.type)) errs.push(`bad type ${el.type}`);
    if (typeof el.x !== "number" || typeof el.y !== "number" || Number.isNaN(el.x) || Number.isNaN(el.y)) {
      errs.push(`non-numeric coords on ${el.id}`);
    }
    if (el.id) ids.add(el.id);
  }
  if (els.filter((e) => e && (e.type === "rectangle" || e.type === "ellipse")).length < 3) {
    errs.push("fewer than 3 boxes");
  }
  const cites = [];
  for (const m of src.matchAll(/"cite"\s*:\s*"(diff:[^"]+)"/g)) cites.push(m[1]);
  return { ok: errs.length === 0, error: errs.length ? errs.slice(0, 4).join("; ") : null, cites };
}

async function validateE(gv, body) {
  const src = extractFence(body, "dot");
  if (!src) return { ok: false, error: "no dot block", cites: [] };
  try {
    gv.dot(src);
  } catch (e) { return { ok: false, error: "dot: " + String(e).slice(0, 200), cites: [] }; }
  return { ok: true, error: null, cites: scanTokens(src).filter((t) => t.startsWith("diff:")) };
}

function runCli(provider, prompt, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const [cmd, args] = provider === "claude"
      ? ["claude", ["-p", "--output-format", "text"]]
      : ["codex", ["exec", "-s", "read-only"]];
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const kill = setTimeout(() => { child.kill("SIGKILL"); resolve({ text: out, timedOut: true }); }, timeoutMs);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", () => { clearTimeout(kill); resolve({ text: out, timedOut: false, stderr: err.slice(0, 300) }); });
    child.on("error", (e) => { clearTimeout(kill); resolve({ text: out, timedOut: false, spawnError: String(e).slice(0, 200) }); });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const VALIDATORS = { A: validateA, B: validateB, D: validateD };

async function main() {
  const onlyProv = process.argv[2];
  const onlyCand = process.argv[3];
  const providers = ["claude", "codex"].filter((p) => !onlyProv || p === onlyProv);
  const cands = Object.keys(FORMATS).filter((c) => !onlyCand || c === onlyCand);
  fs.mkdirSync("out/rel", { recursive: true });

  let prior = [];
  try { prior = JSON.parse(fs.readFileSync("out/rel/results.json", "utf8")); } catch {}
  const doneTags = new Set(prior.map((r) => r.tag));
  const d2 = new D2();
  const gv = await Graphviz.load();
  const tasks = [];
  for (const p of providers) {
    for (const c of cands) {
      for (let i = 0; i < FORMATS[c].n; i++) { const tag = p+"-"+c+"-"+i; if (!doneTags.has(tag)) tasks.push({ p, c, i }); }
    }
  }
  // Deterministic order, modest concurrency.
  const CONC = 4;
  const total = tasks.length + prior.length;
  const results = [...prior];
  let done = 0;
  async function worker() {
    while (tasks.length) {
      const t = tasks.shift();
      const tag = `${t.p}-${t.c}-${t.i}`;
      const prompt = `${CONTEXT}\n\n${FORMATS[t.c].prompt}`;
      fs.writeFileSync(`out/rel/${tag}.prompt.txt`, prompt);
      const r1 = await runCli(t.p, prompt);
      fs.writeFileSync(`out/rel/${tag}.txt`, (r1.timedOut ? "[TIMED OUT]\n" : "") + r1.text);
      const v1 = await validate(t.p, t.c, d2, gv, r1.text);
      let v2 = null;
      if (!v1.ok && !r1.timedOut) {
        const repair = `Your diagram had these errors:\n${v1.error}\n\nOutput ONLY the corrected fenced \`\`\`${FORMATS[t.c].fence} block, no prose.`;
        const r2 = await runCli(t.p, repair);
        fs.writeFileSync(`out/rel/${tag}.repair.txt`, r2.text);
        v2 = await validate(t.p, t.c, d2, gv, r2.text);
      }
      const citesOk = citeScore([...(v1.cites || []), ...((v2 && v2.cites) || [])]);
      results.push({ tag, provider: t.p, cand: t.c, firstOk: v1.ok && !r1.timedOut, repairOk: v2 ? v2.ok : null, citesOk, err1: v1.error });
      done++;
      console.log(`[${done}/${total}] ${tag} first=${v1.ok} repair=${v2 ? v2.ok : "-"} cites=${citesOk} ${v1.error ?? ""}`.slice(0, 160));
    }
  }
  async function validate(p, c, d2i, gvi, text) {
    if (c === "A") return validateA(text);
    if (c === "B") return validateB(text);
    if (c === "C") return validateC(d2i, text);
    if (c === "D") return validateD(text);
    return validateE(gvi, text);
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  if (!tasks.length) { console.log("nothing to do"); } 
  await d2.dispose();
  fs.writeFileSync("out/rel/results.json", JSON.stringify(results, null, 2));
  summarize(results);
}

function summarize(results) {
  for (const p of ["claude", "codex"]) {
    for (const c of Object.keys(FORMATS)) {
      const rs = results.filter((r) => r.provider === p && r.cand === c);
      if (!rs.length) continue;
      const f = rs.filter((r) => r.firstOk).length;
      const r = rs.filter((r) => r.firstOk || r.repairOk).length;
      const cc = rs.filter((r) => r.citesOk).length;
      console.log(`${p} ${c}: first ${f}/${rs.length}, after-repair ${r}/${rs.length}, cites ${cc}/${rs.length}`);
    }
  }
}

await main();
