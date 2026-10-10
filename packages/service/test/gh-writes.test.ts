/**
 * M6 guardrail: nothing outside the Submit review path may write to GitHub.
 *
 * Allowed writers: `src/submit/**` (review POST + `gh pr edit`) and
 * `src/routes/submit.ts` (the HTTP wrapper calling into `src/submit/`).
 * Every other `runGh` call site must be a read (`gh pr view`, `gh api user`,
 * `gh api …/comments` GET, `git …`). If this test fails, a write leaked
 * outside Submit — move it into `src/submit/`.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("gh write guardrail", () => {
  it("only src/submit + routes/submit.ts contain gh writes", () => {
    const src = path.resolve(import.meta.dirname, "..", "src");
    const allowed = new Set([
      path.join(src, "submit", "submit.ts"),
      path.join(src, "submit", "description.ts"),
      path.join(src, "submit", "existing.ts"),
      path.join(src, "submit", "index.ts"),
      path.join(src, "routes", "submit.ts"),
    ]);
    // Write indicators: review POST body, description body-file, edit calls.
    const WRITE_RE = /--body-file|--input|\/pulls\/.*\/reviews|"edit"|'edit'|\bevent\b/i;
    const offenders: string[] = [];
    for (const file of listTs(src)) {
      const text = fs.readFileSync(file, "utf8");
      if (!text.includes("runGh")) continue;
      if (WRITE_RE.test(text) && !allowed.has(file)) offenders.push(path.relative(src, file));
    }
    expect(offenders, "gh writes outside src/submit + routes/submit.ts").toEqual([]);
  });
});
