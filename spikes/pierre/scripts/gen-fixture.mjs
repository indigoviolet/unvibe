// Generates src/demoPatches.ts from fixtures/urllib3-5020/diff.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const raw = JSON.parse(readFileSync(join(root, "fixtures/urllib3-5020/diff.json"), "utf8"));
const out =
  "/** Auto-generated from fixtures/urllib3-5020/diff.json — do not hand-edit. */\n" +
  `export const DEMO_PATCHES: { key: string; path: string; patch: string }[] = ${JSON.stringify(
    raw.map((f) => ({ key: f.key, path: f.path, patch: f.diff })),
    null,
    2,
  )};\n`;
writeFileSync(join(here, "..", "src", "demoPatches.ts"), out);
console.log(`wrote ${raw.length} patches`);
