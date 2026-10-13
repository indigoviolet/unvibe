// Parses corpus/cases.txt.
import { readFileSync } from "node:fs";
export function loadCases() {
  const text = readFileSync(new URL("../corpus/cases.txt", import.meta.url), "utf8");
  const cases = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [id, src, range, note, exp] = line.split("|").map((s) => s.trim());
    const [repo, sha, path] = src.split(/\s+/);
    const [a, b] = range.split("-").map(Number);
    const expected = exp === "unscored" ? null : exp === "none" ? [] : exp.split(";").map((s) => { const [x, y] = s.trim().split("-").map(Number); return { start: x, end: y }; });
    cases.push({ id, lang: id.replace(/\d+$/, ""), repo, sha, path, a, b, note, expected });
  }
  return cases;
}
