/**
 * Fixture provenance checks (issue #341): prompt drift warns, placeholder
 * strings fail. Fast suite (`mise run check`) must stay green on the
 * checked-in fixture.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { hashPromptsDir } from "../src/replay/prompts-hash.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "urllib3-5020");

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

describe("fixture prompt drift (#341)", () => {
  it("warns (never fails) when the current prompts differ from the recorded ones", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, "manifest.json"), "utf8")) as {
      promptHash?: string;
    };
    if (!manifest.promptHash) return; // unrecorded fixture: nothing to compare
    const promptsDir = path.resolve(FIXTURES, "..", "..", "prompts");
    if (!fs.existsSync(promptsDir)) return;
    const current = hashPromptsDir(promptsDir);
    if (current !== manifest.promptHash) {
      console.warn(
        `[fixture-drift] prompts changed since the demo was recorded (manifest ${manifest.promptHash}, now ${current}). ` +
          `Re-record the fixture (issue #341) before trusting the demo.`,
      );
    }
    expect(true).toBe(true);
  });
});

describe("fixture placeholders (#341)", () => {
  it("fails when placeholder text appears in the fixture or snapshot", () => {
    const banned = [/Suggested comment\./, /\blorem\b/i, /\bTODO\b/, /\bplaceholder\b/i];
    const hits: string[] = [];
    for (const f of walkFiles(FIXTURES)) {
      if (!/\.(md|json)$/.test(f)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const re of banned) {
        if (re.test(text)) hits.push(`${path.relative(FIXTURES, f)}: ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
