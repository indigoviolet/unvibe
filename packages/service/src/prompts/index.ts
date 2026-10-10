/**
 * Prompt template library: discovery + rendering (PRD §13).
 *
 * Templates live in `prompts/<name>.md` at the repo root. At runtime the
 * directory is located by `resolvePromptsDir` (env override
 * `UNVIBE_PROMPTS_DIR`, else walk up from the caller's directory to the
 * first ancestor containing `prompts/instructions.md`), so the same code
 * works from `dist/`, from tests, and from an installed location.
 * Route and pipeline code should prefer passing an explicit directory in
 * tests and the resolved one in production.
 */
import fs from "node:fs";
import path from "node:path";
import { parseTemplate, TemplateLoadError, type ParsedTemplate } from "./loader.js";

export { TemplateLoadError, TEMPLATE_TIERS, type TemplateTier } from "./loader.js";
export { TemplateRenderError, renderTemplate, type RenderValues } from "./render.js";
export { parseTemplate, type ParsedTemplate } from "./loader.js";

/** Map of template name → parsed template. Insertion order is file order. */
export type TemplateLibrary = Map<string, ParsedTemplate>;

/**
 * Load every `*.md` file in `dir` as a template. The file basename (minus
 * `.md`) is the template name. Throws on the first invalid file? No:
 * collects every file's issues into one error so a single `check` run
 * reports all broken templates.
 */
export async function loadTemplatesDir(dir: string): Promise<TemplateLibrary> {
  const entries = await fs.promises.readdir(dir);
  const names = entries
    .filter((e) => e.endsWith(".md"))
    .map((e) => e.slice(0, -".md".length))
    .sort();
  const out: TemplateLibrary = new Map();
  const issues: { template: string; message: string }[] = [];
  for (const name of names) {
    const raw = await fs.promises.readFile(path.join(dir, `${name}.md`), "utf8");
    try {
      out.set(name, parseTemplate(name, raw));
    } catch (err) {
      if (err instanceof TemplateLoadError) issues.push(...err.issues);
      else throw err;
    }
  }
  if (issues.length > 0) throw new TemplateLoadError(issues);
  return out;
}

/** Synchronous variant for servers that load once at startup. */
export function loadTemplatesDirSync(dir: string): TemplateLibrary {
  const entries = fs.readdirSync(dir);
  const names = entries
    .filter((e) => e.endsWith(".md"))
    .map((e) => e.slice(0, -".md".length))
    .sort();
  const out: TemplateLibrary = new Map();
  const issues: { template: string; message: string }[] = [];
  for (const name of names) {
    const raw = fs.readFileSync(path.join(dir, `${name}.md`), "utf8");
    try {
      out.set(name, parseTemplate(name, raw));
    } catch (err) {
      if (err instanceof TemplateLoadError) issues.push(...err.issues);
      else throw err;
    }
  }
  if (issues.length > 0) throw new TemplateLoadError(issues);
  return out;
}

/**
 * Locate the prompts directory: `UNVIBE_PROMPTS_DIR` wins; otherwise walk
 * up from `startDir` (default: current working directory) to the first
 * ancestor containing `prompts/instructions.md`. Returns null when absent.
 */
export function resolvePromptsDir(startDir: string = process.cwd()): string | null {
  const override = process.env.UNVIBE_PROMPTS_DIR;
  if (override && fs.existsSync(path.join(override, "instructions.md"))) return override;
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "prompts");
    if (fs.existsSync(path.join(candidate, "instructions.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
