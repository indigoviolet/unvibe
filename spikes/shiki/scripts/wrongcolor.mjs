/**
 * Wrong-colour analysis for issue #23: hunk-only vs full-file tokenising.
 *
 * For crafted multi-line-construct cases, compares the colour classes of
 * the hunk's own lines under both approaches and reports divergences.
 * For the demo fixture, scans every hunk for unbalanced multi-line
 * delimiters (the necessary condition for hunk-only to go wrong).
 */
import { createHighlighterCore, createCssVariablesTheme } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");

const hl = await createHighlighterCore({
  langs: [import("shiki/langs/python.mjs"), import("shiki/langs/typescript.mjs")],
  themes: [createCssVariablesTheme({ name: "x", variablePrefix: "--shk-" })],
  engine: createJavaScriptRegexEngine(),
});

const toks = (code, lang) =>
  hl.codeToTokens(code, { lang, theme: "x" }).tokens.map((row) => row.map((t) => t.color).join("|"));

const cases = [
  {
    name: "python docstring opened before hunk",
    lang: "python",
    full: 'def f():\n    """Docstring line one.\n    Docstring line two.\n    """\n    return 1\n',
    hunk: "    Docstring line two.\n    return 1\n",
  },
  {
    name: "python multiline string assigned across hunk",
    lang: "python",
    full: 'x = """start\nmiddle\nend"""\ny = 2\n',
    hunk: "middle\ny = 2\n",
  },
  {
    name: "ts block comment spanning hunk",
    lang: "typescript",
    full: "/* comment opens\nstill comment\nends */\nconst x = 1;\n",
    hunk: "still comment\nconst x = 1;\n",
  },
  {
    name: "ts template literal spanning hunk",
    lang: "typescript",
    full: "const s = `one\ntwo ${x}\nthree`;\nfoo();\n",
    hunk: "two ${x}\nfoo();\n",
  },
  {
    name: "control: no multiline constructs",
    lang: "python",
    full: "def f(a, b):\n    # comment\n    return a + b\n",
    hunk: "def f(a, b):\n    # comment\n    return a + b\n",
  },
];

for (const c of cases) {
  const fullRows = toks(c.full, c.lang);
  const hunkRows = toks(c.hunk, c.lang);
  // Align: hunk rows should equal the last N full rows when state matches.
  const tail = fullRows.slice(fullRows.length - hunkRows.length);
  const divergent = hunkRows.filter((r, i) => r !== tail[i]).length;
  console.log(`${divergent === 0 ? "SAME " : "WRONG"} ${c.name}: ${divergent}/${hunkRows.length} rows diverge`);
  if (divergent > 0) {
    console.log(`  hunk-only: ${hunkRows[0].slice(0, 120)}`);
    console.log(`  full-file: ${tail[0].slice(0, 120)}`);
  }
}

// Demo fixture: necessary condition = unbalanced multiline delimiters,
// checked per language (a lone backtick inside a Python regex is not a
// construct — language-agnostic counting false-positives on it).
const LANG_OF = { ".py": "py", ".ts": "ts", ".tsx": "ts", ".js": "ts", ".rst": "none" };
const diff = JSON.parse(readFileSync(path.join(ROOT, "fixtures/urllib3-5020/diff.json"), "utf8"));
let hunks = 0;
let risky = 0;
for (const f of diff) {
  const ext = (f.path.match(/\.[a-z0-9]+$/i) ?? [""])[0].toLowerCase();
  const lang = LANG_OF[ext] ?? "none";
  const text = f.diff;
  const parts = text.split(/^@@ .* @@.*$/m).slice(1);
  for (const body of parts) {
    hunks++;
    const code = body
      .split("\n")
      .filter((l) => l.startsWith(" ") || l.startsWith("+") || l.startsWith("-"))
      .map((l) => l.slice(1))
      .join("\n");
    let bad = false;
    let detail = "";
    if (lang === "py") {
      const triple = (code.match(/"""/g) ?? []).length + (code.match(/'''/g) ?? []).length;
      bad = triple % 2 === 1;
      detail = `triple=${triple}`;
    } else if (lang === "ts") {
      const blockOpen = (code.match(/\/\*/g) ?? []).length;
      const blockClose = (code.match(/\*\//g) ?? []).length;
      const backtick = (code.match(/`/g) ?? []).length;
      bad = blockOpen !== blockClose || backtick % 2 === 1;
      detail = `block=${blockOpen}/${blockClose} ticks=${backtick}`;
    }
    if (bad) {
      risky++;
      console.log(`risky hunk in ${f.key}: ${detail}`);
    }
  }
}
console.log(`demo fixture: ${hunks} hunks, ${risky} with unbalanced multiline delimiters`);
