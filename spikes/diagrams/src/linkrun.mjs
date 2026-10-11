/**
 * link: convention reliability run — the §7 gate for D2 adoption.
 *
 * Tests the minimal one-line cite wording across 3 diagram kinds
 * (flow, fold=before-after, seq=four-participant sequence), both providers
 * (claude + codex CLIs in print mode), ~8 generations per provider.
 *
 * Scoring per output (see docs/diagram-options.md §9 brief):
 *  - compiles first try with the binary (`d2 - -` via stdin, 30s timeout)
 *  - compiles after exactly one repair turn fed the compiler error text
 *  - every link: value is a syntactically valid cite token
 *  - every cited diff:conn range lies inside the hunk (77-113, 647-654)
 *  - cites present on >=2 shapes/connections (as the prompt implies)
 *  - forbidden constructs used (listed)
 *  - rendered SVG has one <a href> per cite, token byte-identical
 *  - source/SVG sizes, compile ms, style counts, fonts embedded
 *  - cites anywhere else (labels, tooltips, comments)
 *
 * Usage: node src/linkrun.mjs [provider] [kind]
 *   e.g. node src/linkrun.mjs claude flow
 * Env: D2_BIN — path to d2 binary (default: resolved once from
 *   `mise x d2@latest -- which d2`, never installed system-wide).
 *
 * Outputs: out/link/<tag>.(prompt.txt|txt|repair.txt|d2|svg|json)
 *   plus out/link/results.json (append-safe, skips finished tags).
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";

const OUT = "out/link";
fs.mkdirSync(OUT, { recursive: true });

// --- d2 binary (resolved once; mise shim, no system install) ---
let D2_BIN = process.env.D2_BIN;
if (!D2_BIN) {
  try {
    D2_BIN = execFileSync("mise", ["x", "d2@latest", "--", "which", "d2"], { encoding: "utf8" }).trim().split("\n").pop().trim();
  } catch (e) {
    console.error("cannot resolve d2 binary:", String(e).slice(0, 200));
    process.exit(1);
  }
}
const D2_VERSION = execFileSync(D2_BIN, ["version"], { encoding: "utf8" }).trim();
console.log(`d2: ${D2_BIN} ${D2_VERSION}`);

// --- fixture context (same hunk as reliability.mjs) ---
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

const CONTEXT = `You are documenting this diff hunk from urllib3 (fileKey "conn", src/urllib3/connection.py). Citable new-side line ranges: conn lines 77-113 (the helpers shown below) and conn lines 647-654 (the getresponse call site, not shown).

Diff hunk:
${HUNK}`;

// The cite rule under test: exactly one prompt line.
const CITE_LINE = `Cite code by putting link: "diff:conn:START-END" (ranges inside 77-113 or 647-654, no [[ ]], no tooltip:) directly on 2-3 shapes or connections.`;

const LIMITS = `Limits: at most 12 shapes and 16 connections; no icon:, no shape: image, no imports, no markdown labels, no layers, no vars, no classes. Optionally add a \`Caption:\` line after the block.`;

const KINDS = {
  flow: {
    n: 3,
    task: `Draw the header data flow in 5-7 nodes: server with folded header -> http.client parse_headers -> HTTPMessage keeps CRLF -> _normalize helpers (OWS CRLF RWS becomes one space) -> HTTPHeaderDict r.headers AND the same HTTPMessage object (Requests' cookie jar reads it).`,
    format: `Output ONLY one fenced \`\`\`d2 block, no prose before or after.
D2 rules: first line \`direction: right\`; shapes as \`id: "Short label"\`; edges as \`a -> b: label\`.
${CITE_LINE}
${LIMITS}`,
  },
  fold: {
    n: 2,
    task: `Draw a before/after diagram in 4-8 shapes: LEFT the folded header bytes on the wire (Set-Cookie with CRLF plus a space-indented continuation line), RIGHT the unfolded single-line value (the fold becomes one space); include the _OBSOLETE_FOLD_RE regex node and the _normalize_header_value helper as the mapping between left and right.`,
    format: `Output ONLY one fenced \`\`\`d2 block, no prose before or after.
D2 rules: first line \`direction: right\`; shapes as \`id: "Short label"\`; edges as \`a -> b: label\`.
${CITE_LINE}
${LIMITS}`,
  },
  seq: {
    n: 3,
    task: `Draw a four-participant sequence diagram: a client app calls ConnectionPool, which calls HTTPConnection.getresponse (the call site at conn 647-654), which calls http.client parse_headers (keeps the raw CRLF fold), which returns an HTTPMessage; then the normalized HTTPHeaderDict plus the same HTTPMessage object go back (the cookie jar reads the same object).`,
    format: `Output ONLY one fenced \`\`\`d2 block, no prose before or after.
D2 rules: first line \`shape: sequence_diagram\`; then one line per participant (\`name: Label\`); messages as \`a -> b: text\`.
${CITE_LINE}
${LIMITS}`,
  },
};

// --- extraction / validation helpers ---
function extractFence(text, fence) {
  const m = text.match(new RegExp("```" + fence + "\\s*\\n([\\s\\S]*?)```"));
  return m ? m[1].trim() : null;
}

// Bare cite-token grammar (no [[ ]]): diff:<key>:<lines>, code:<path>:<lines>, desc:<id>
const TOKEN_RE = /^(?:diff|code):[A-Za-z0-9_./-]+:\d+(?:-\d+)?(?:@[0-9a-fA-F]+)?$|^desc:[A-Za-z0-9_-]+$/;

function extractLinks(src) {
  const vals = [];
  let rest = src;
  for (const m of src.matchAll(/link\s*:\s*"([^"]*)"/g)) vals.push({ value: m[1], quoted: true });
  rest = src.replace(/link\s*:\s*"[^"]*"/g, "link: ");
  for (const m of rest.matchAll(/link\s*:\s*'([^']*)'/g)) vals.push({ value: m[1], quoted: true });
  rest = rest.replace(/link\s*:\s*'[^']*'/g, "link: ");
  // Unquoted fallback: same-line only ([ \t], never \n) so a bare `link:`
  // at end of line cannot swallow the next line's `}`.
  for (const m of rest.matchAll(/link[ \t]*:[ \t]*([^\s#{}][^\s#{}]*)/g)) vals.push({ value: m[1], quoted: false });
  return vals;
}

const FORBIDDEN = [
  ["icon:", /\bicon\s*:/],
  ["shape: image", /shape\s*:\s*image/],
  ["import (...@)", /\.\.\.@/],
  ["import (: @)", /:\s*@[A-Za-z0-9_./-]/],
  ["markdown label", /\|\s*(?:md|tex|latex)\b/],
  ["code-block label", /^\s*[A-Za-z0-9_]+:\s*\|/m],
  ["near:", /\bnear\s*:/],
  ["layers:", /^\s*layers\s*:/m],
  ["scenarios:", /^\s*scenarios\s*:/m],
  ["steps:", /^\s*steps\s*:/m],
  ["boards:", /^\s*boards\s*:/m],
  ["vars", /^\s*vars\s*:/m],
  ["d2-config", /d2-config/],
  ["classes", /^\s*classes\s*:/m],
];

function citesElsewhere(src) {
  const found = [];
  if (/\[\[(?:diff|code|desc):[^\]]+\]\]/.test(src)) found.push("[[token]] brackets");
  const noLinks = src.replace(/link\s*:\s*"[^"]*"/g, "link:\"\"").replace(/link\s*:\s*'[^']*'/g, "link:''");
  if (/tooltip\s*:\s*"[^"]*(?:diff|code|desc):[^"]*"/.test(noLinks)) found.push("tooltip cite");
  if (/^\s*#[^\n]*(?:diff|code|desc):/m.test(noLinks)) found.push("comment cite");
  const noComments = noLinks.replace(/^\s*#[^\n]*/gm, "");
  if (/(?:diff|code):[A-Za-z0-9_./-]+:\d/.test(noComments)) found.push("label/body cite");
  else if (/\bdesc:[A-Za-z0-9_-]+/.test(noComments)) found.push("label/body cite");
  if (/^\s*tooltip\s*:/m.test(src)) found.push("tooltip: used");
  return found;
}

// Citable ranges: conn new-side 77-113 and 647-654.
function rangeInHunk(value) {
  const m = value.match(/^(?:diff|code):([A-Za-z0-9_./-]+):(\d+)(?:-(\d+))?/);
  if (!m) return null; // desc: or unparsable — no range to check
  if (m[1] !== "conn") return false;
  const s = Number(m[2]);
  const e = m[3] ? Number(m[3]) : s;
  if (e < s) return false;
  return (s >= 77 && e <= 113) || (s >= 647 && e <= 654);
}

// --- d2 compile via binary, stdin only ---
function compileD2(src, extraArgs = [], timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(D2_BIN, [...extraArgs, "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = Buffer.alloc(0);
    let err = "";
    const kill = setTimeout(() => { child.kill("SIGKILL"); }, timeoutMs);
    let killed = false;
    child.stdout.on("data", (d) => { out = Buffer.concat([out, d]); });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code, signal) => {
      clearTimeout(kill);
      killed = signal === "SIGKILL";
      resolve({ ok: code === 0, code, signal, svg: out.toString("utf8"), bytes: out.length, stderr: err.slice(0, 600), ms: Date.now() - t0, timedOut: killed });
    });
    child.on("error", (e) => { clearTimeout(kill); resolve({ ok: false, code: -1, stderr: String(e).slice(0, 300), ms: Date.now() - t0, timedOut: false, svg: "", bytes: 0 }); });
    child.stdin.write(src);
    child.stdin.end();
  });
}

function svgStats(svg) {
  const hrefs = [...svg.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]);
  return {
    hrefs,
    aCount: (svg.match(/<a [^>]*href=/g) || []).length,
    styleBlocks: (svg.match(/<style/g) || []).length,
    styleAttrs: (svg.match(/ style="/g) || []).length,
    fontFaces: (svg.match(/@font-face/g) || []).length,
    foreignObjects: (svg.match(/<foreignObject/g) || []).length,
    bytes: svg.length,
  };
}

function scoreOutput(src) {
  const links = extractLinks(src);
  const tokenValid = links.map((l) => TOKEN_RE.test(l.value));
  const ranges = links.map((l) => rangeInHunk(l.value));
  const allTokensValid = links.length > 0 && tokenValid.every(Boolean);
  const allRangesOk = links.length > 0 && ranges.every((r) => r === true);
  const citesPresent = links.filter((l) => TOKEN_RE.test(l.value) && rangeInHunk(l.value) === true).length >= 2;
  const forbidden = FORBIDDEN.filter(([, re]) => re.test(src)).map(([n]) => n);
  const elsewhere = citesElsewhere(src);
  return { links: links.map((l) => l.value), allTokensValid, allRangesOk, citesPresent, forbidden, elsewhere };
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

async function main() {
  if (process.argv[2] === "rescore") return await rescore();
  const onlyProv = process.argv[2];
  const onlyKind = process.argv[3];
  const providers = ["claude", "codex"].filter((p) => !onlyProv || p === onlyProv);
  const kinds = Object.keys(KINDS).filter((k) => !onlyKind || k === onlyKind);

  let prior = [];
  try { prior = JSON.parse(fs.readFileSync(`${OUT}/results.json`, "utf8")); } catch {}
  const doneTags = new Set(prior.map((r) => r.tag));
  const results = [...prior];
  const tasks = [];
  for (const p of providers)
    for (const k of kinds)
      for (let i = 0; i < KINDS[k].n; i++) {
        const tag = `${p}-link-${k}-${i}`;
        if (!doneTags.has(tag)) tasks.push({ p, k, i, tag });
      }

  const CONC = 3;
  let done = 0;
  const total = tasks.length + prior.length;
  async function worker() {
    while (tasks.length) {
      const t = tasks.shift();
      const prompt = `${CONTEXT}\n\n${KINDS[t.k].task}\n\n${KINDS[t.k].format}`;
      fs.writeFileSync(`${OUT}/${t.tag}.prompt.txt`, prompt);
      const r1 = await runCli(t.p, prompt);
      fs.writeFileSync(`${OUT}/${t.tag}.txt`, (r1.timedOut ? "[TIMED OUT]\n" : "") + r1.text);
      const src1 = extractFence(r1.text, "d2");
      const rec = { tag: t.tag, provider: t.p, kind: t.k, d2bin: D2_VERSION, srcBytes: src1 ? src1.length : 0 };
      let c1 = null;
      if (src1 && !r1.timedOut) {
        fs.writeFileSync(`${OUT}/${t.tag}.d2`, src1);
        c1 = await compileD2(src1);
        Object.assign(rec, { firstOk: c1.ok, firstErr: c1.ok ? null : (c1.timedOut ? "[TIMEOUT] " : `[exit ${c1.code}] `) + c1.stderr, compileMs: c1.ms });
        if (c1.ok) {
          const st = svgStats(c1.svg);
          fs.writeFileSync(`${OUT}/${t.tag}.svg`, c1.svg);
          rec.svg = st;
        }
        Object.assign(rec, scoreOutput(src1));
      } else {
        rec.firstOk = false;
        rec.firstErr = r1.timedOut ? "[CLI TIMED OUT]" : "no d2 block";
        Object.assign(rec, { links: [], allTokensValid: false, allRangesOk: false, citesPresent: false, forbidden: [], elsewhere: [] });
      }
      // Exactly one repair turn if first compile failed.
      let c2 = null;
      if (!rec.firstOk && src1 && !r1.timedOut) {
        const repair = `Your D2 diagram failed to compile with this error:\n${rec.firstErr}\n\nOutput ONLY the corrected fenced \`\`\`d2 block, no prose.`;
        const r2 = await runCli(t.p, repair);
        fs.writeFileSync(`${OUT}/${t.tag}.repair.txt`, r2.text);
        const src2 = extractFence(r2.text, "d2");
        if (src2) {
          fs.writeFileSync(`${OUT}/${t.tag}.repaired.d2`, src2);
          c2 = await compileD2(src2);
          rec.repairOk = c2.ok;
          rec.repairErr = c2.ok ? null : (c2.timedOut ? "[TIMEOUT] " : `[exit ${c2.code}] `) + c2.stderr;
          if (c2.ok && !c1?.ok) {
            const st = svgStats(c2.svg);
            fs.writeFileSync(`${OUT}/${t.tag}.svg`, c2.svg);
            rec.svg = st;
            Object.assign(rec, scoreOutput(src2));
          }
        } else rec.repairOk = false;
      } else rec.repairOk = null;
      // href check: one <a href> per cite, token byte-identical.
      if (rec.svg) {
        rec.hrefOk = rec.links.length > 0 && rec.links.every((v) => rec.svg.hrefs.includes(v));
        rec.hrefCount = rec.svg.aCount;
      } else { rec.hrefOk = false; rec.hrefCount = 0; }
      rec.validWithCites = (rec.firstOk || rec.repairOk === true) && rec.allTokensValid && rec.allRangesOk && rec.citesPresent;
      results.push(rec);
      done++;
      console.log(`[${done}/${total}] ${t.tag} first=${rec.firstOk} repair=${rec.repairOk} cites=${rec.links.join(",") || "-"} forb=[${(rec.forbidden || []).join("|") || "-"}] href=${rec.hrefOk} validCites=${rec.validWithCites}`.slice(0, 220));
      fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  summarize(results);
}

async function rescore() {
  // Re-derive results.json from saved outputs (no new generations).
  const tags = fs.readdirSync(OUT)
    .filter((f) => f.endsWith(".txt") && !f.includes(".repair") && !f.includes(".prompt"))
    .map((f) => f.slice(0, -4));
  const results = [];
  for (const tag of tags) {
    const [, provider, , kind] = tag.split(/-(link)-/);
    const parts = tag.split("-link-");
    const p = parts[0], k = parts[1].split("-").slice(0, -1).join("-");
    void provider; void kind;
    const text = fs.readFileSync(`${OUT}/${tag}.txt`, "utf8");
    const src = extractFence(text, "d2");
    const rec = { tag, provider: p, kind: k, d2bin: D2_VERSION, srcBytes: src ? src.length : 0 };
    if (src) {
      const c = await compileD2(src);
      Object.assign(rec, { firstOk: c.ok, firstErr: c.ok ? null : `[exit ${c.code}] ` + c.stderr, compileMs: c.ms });
      if (c.ok) {
        const st = svgStats(c.svg);
        fs.writeFileSync(`${OUT}/${tag}.svg`, c.svg);
        rec.svg = st;
      }
      Object.assign(rec, scoreOutput(src));
      const repFile = `${OUT}/${tag}.repair.txt`;
      if (!rec.firstOk && fs.existsSync(repFile)) {
        const src2 = extractFence(fs.readFileSync(repFile, "utf8"), "d2");
        if (src2) {
          const c2 = await compileD2(src2);
          rec.repairOk = c2.ok;
          if (c2.ok) { const st = svgStats(c2.svg); fs.writeFileSync(`${OUT}/${tag}.svg`, c2.svg); rec.svg = st; Object.assign(rec, scoreOutput(src2)); }
        } else rec.repairOk = false;
      } else rec.repairOk = null;
    } else {
      Object.assign(rec, { firstOk: false, firstErr: "no d2 block", repairOk: null, links: [], allTokensValid: false, allRangesOk: false, citesPresent: false, forbidden: [], elsewhere: [] });
    }
    if (rec.svg) {
      rec.hrefOk = rec.links.length > 0 && rec.links.every((v) => rec.svg.hrefs.includes(v));
      rec.hrefCount = rec.svg.aCount;
    } else { rec.hrefOk = false; rec.hrefCount = 0; }
    rec.validWithCites = (rec.firstOk || rec.repairOk === true) && rec.allTokensValid && rec.allRangesOk && rec.citesPresent;
    results.push(rec);
    console.log(`${tag} first=${rec.firstOk} cites=${rec.links.join(",") || "-"} href=${rec.hrefOk} validCites=${rec.validWithCites}`);
  }
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  summarize(results);
}

function summarize(results) {  for (const p of ["claude", "codex"]) {
    for (const k of Object.keys(KINDS)) {
      const rs = results.filter((r) => r.provider === p && r.kind === k);
      if (!rs.length) continue;
      const f = rs.filter((r) => r.firstOk).length;
      const a = rs.filter((r) => r.firstOk || r.repairOk).length;
      const v = rs.filter((r) => r.validWithCites).length;
      console.log(`${p} ${k}: first ${f}/${rs.length}, after-repair ${a}/${rs.length}, valid-with-correct-cites ${v}/${rs.length}`);
    }
  }
  const all = results;
  console.log(`TOTAL valid-with-correct-cites: ${all.filter((r) => r.validWithCites).length}/${all.length}`);
}

await main();
