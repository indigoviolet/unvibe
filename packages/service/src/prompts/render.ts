/**
 * Deterministic template rendering (PRD §13).
 *
 * Guarantees:
 * - Stable ordering: placeholders are substituted left to right; nothing
 *   about the output depends on the key order of the supplied values object.
 * - No timestamps, no random IDs: substitution is a pure function of the
 *   template plus the supplied strings.
 * - Normalised line endings: CRLF (and lone CR) in values becomes LF, so
 *   the same logical inputs give the same bytes on macOS and Linux.
 * - Nested variables: `{{anchor.quote}}` resolves `values.anchor.quote`.
 *
 * Validation at render time: every declared variable must be supplied as a
 * string; extra supplied keys are ignored. All missing/invalid variables
 * are reported in a single error.
 */
import { normaliseLineEndings, type ParsedTemplate } from "./loader.js";

export type RenderValues = Record<string, unknown>;

/** Thrown when supplied values do not satisfy a template's declarations. */
export class TemplateRenderError extends Error {
  readonly template: string;
  readonly missing: string[];
  constructor(template: string, missing: string[]) {
    super(`cannot render ${template}: ${missing.join("; ")}`);
    this.name = "TemplateRenderError";
    this.template = template;
    this.missing = missing;
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

function lookup(values: RenderValues, path: string): unknown {
  let node: unknown = values;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

/**
 * Render a parsed template. Returns the exact bytes to send.
 * Throws TemplateRenderError listing every declared variable that is
 * missing or not a string.
 */
export function renderTemplate(template: ParsedTemplate, values: RenderValues): string {
  const problems: string[] = [];
  const resolved = new Map<string, string>();
  for (const name of template.variables) {
    const value = lookup(values, name);
    if (typeof value !== "string") {
      problems.push(
        value === undefined
          ? `missing variable {{${name}}}`
          : `variable {{${name}}} must be a string, got ${Array.isArray(value) ? "array" : typeof value}`,
      );
    } else {
      resolved.set(name, normaliseLineEndings(value));
    }
  }
  if (problems.length > 0) throw new TemplateRenderError(template.name, problems);
  return template.body.replace(PLACEHOLDER, (_m, path: string) => resolved.get(path) ?? _m);
}
