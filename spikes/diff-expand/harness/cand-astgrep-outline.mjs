// Candidate 1c: `ast-grep outline` (CLI only; the napi package has no outline API).
// It lists a file's top-level items and their direct members with ranges: two levels.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { BIN } from "./cand-astgrep-cli.mjs";
import { LANGS } from "./units.mjs";

export const name = "ast-grep outline";
export async function init() {}
export function outline(file) {
  const out = execFileSync(BIN, ["outline", "--json=compact", "--view", "expanded", file], { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(out);
}
export async function chain(lang, path, source, a, b) {
  if (!LANGS[lang]) return null;
  const dir = mkdtempSync(join(tmpdir(), "sgol-"));
  try {
    const file = join(dir, basename(path));
    writeFileSync(file, source);
    const flat = [];
    const walk = (items) => { for (const it of items ?? []) { flat.push(it); walk(it.members); } };
    for (const f of outline(file)) walk(f.items);
    return flat
      .map((it) => ({ start: it.range.start.line + 1, end: it.range.end.column === 0 ? it.range.end.line : it.range.end.line + 1, kind: it.symbolType, name: it.name }))
      // Plain variables are not units (a multi-line list or object would otherwise count).
      .filter((u) => u.start <= a && u.end >= b && u.end > u.start && !["variable", "constant", "field", "property"].includes(u.kind))
      .sort((x, y) => (x.end - x.start) - (y.end - y.start));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
