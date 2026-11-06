/**
 * Prompt-hash for the demo fixture (issue #341).
 *
 * The fixture recordings are only valid for the prompts that produced
 * them. `hashPromptsDir` hashes every prompt template so the manifest can
 * record which prompts a recording came from; `fixture:snapshot` and the
 * drift test warn (never fail) when the current prompts differ, as the
 * signal to re-record.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** `sha256:<hex>` over every file under `promptsDir` (paths + bytes). */
export function hashPromptsDir(promptsDir: string): string {
  const hash = createHash("sha256");
  for (const full of collectFiles(promptsDir)) {
    hash.update(path.relative(promptsDir, full));
    hash.update("\0");
    hash.update(fs.readFileSync(full));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Default `prompts/` dir: repo root from this file, overridable. */
export function defaultPromptsDir(fromUrl: string): string {
  const here = path.dirname(new URL(fromUrl).pathname);
  for (const c of [
    path.resolve(here, "..", "..", "..", "..", "prompts"),
    path.resolve(process.cwd(), "prompts"),
  ]) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch {
      // try next
    }
  }
  return path.resolve(process.cwd(), "prompts");
}
