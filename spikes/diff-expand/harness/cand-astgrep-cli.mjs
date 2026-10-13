// Candidate 1b: the ast-grep CLI binary, one process per file. The query is a rule that
// matches every unit kind; the enclosing ones are picked by range here. Simplified on
// purpose: only definition kinds and their wrappers (no closures bound to names, no
// describe/it blocks), with leading comments found by text.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { LANGS } from "./units.mjs";
import { leadStartByText } from "./textlead.mjs";
const require = createRequire(import.meta.url);
export const BIN = join(dirname(require.resolve("@ast-grep/cli-linux-x64-gnu/package.json")), "ast-grep");
const CLI_LANG = { javascript: "JavaScript", typescript: "TypeScript", tsx: "Tsx", python: "Python", go: "Go", rust: "Rust", java: "Java", ruby: "Ruby" };

const TS_ONLY = new Set(["abstract_class_declaration", "interface_declaration", "enum_declaration", "internal_module", "module", "type_alias_declaration"]);

export const name = "ast-grep cli";
export async function init() {}
export function runCli(lang, file) {
  const cfg = LANGS[lang];
  // The TypeScript-only kinds are rejected for JavaScript ("Invalid Kind"), so drop them there.
  const kinds = [...cfg.units, ...(cfg.wrap ?? [])].filter((k) => lang !== "javascript" || !TS_ONLY.has(k));
  const rule = `id: unit\nlanguage: ${CLI_LANG[lang]}\nrule:\n  any:\n${kinds.map((k) => `    - kind: ${k}`).join("\n")}\n`;
  const out = execFileSync(BIN, ["scan", "--inline-rules", rule, "--json=compact", file], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}
export async function chain(lang, path, source, a, b) {
  if (!LANGS[lang]) return null;
  const cfg = LANGS[lang];
  const dir = mkdtempSync(join(tmpdir(), "sgcli-"));
  try {
    const file = join(dir, basename(path));
    writeFileSync(file, source);
    const lines = source.split("\n");
    const hits = runCli(lang, file)
      .map((m) => ({ start: m.range.start.line + 1, end: m.range.end.column === 0 ? m.range.end.line : m.range.end.line + 1, text: m.lines?.split("\n")[0] ?? "" }))
      .filter((u) => u.start <= a && u.end >= b && u.end > u.start)
      .sort((x, y) => (x.end - x.start) - (y.end - y.start));
    const out = [];
    for (const u of hits) {
      const last = out[out.length - 1];
      // A wrapper (export/decorated) directly around the previous unit replaces it.
      if (last && last.end === u.end && u.start <= last.start && last.start - u.start <= 12 && !cfg.units.has("x")) {
        const between = lines.slice(u.start - 1, last.start - 1).every((l) => /^\s*(@|export\b|$)/.test(l));
        if (between) { last.start = u.start; continue; }
      }
      out.push({ start: u.start, end: u.end, kind: "unit", name: u.text.trim().slice(0, 60) });
    }
    for (const u of out) u.start = leadStartByText(lines, u.start);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
