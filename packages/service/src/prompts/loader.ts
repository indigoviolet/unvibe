/**
 * Prompt template loader (PRD §13).
 *
 * Templates are files `prompts/<name>.md` with front matter:
 *
 * ```md
 * ---
 * role: system
 * tier: main
 * variables: [source, anchor.quote]
 * ---
 *
 * <body with {{placeholders}}>
 * ```
 *
 * Front matter rules (validated here):
 * - `role` (string, required): the message role this template renders for
 *   (`system` for L0 instructions, `user` for everything else).
 * - `tier` (required): one of `main`, `small`, `second-opinion`.
 * - `variables` (required, may be empty): the declared variable names.
 *   Dotted names (`anchor.quote`) address nested values.
 * - Unknown front-matter keys are rejected (catches typos).
 *
 * Placeholder rules:
 * - Only `{{path}}` (optional inner whitespace) is a placeholder.
 * - Any other `{{` in the body is a load error. Template bodies must not
 *   contain literal `{{`; rephrase examples to avoid it.
 * - Every placeholder used must be declared; unused declarations are
 *   allowed at load time but must all be supplied at render time.
 *
 * Pure except for `loadTemplatesDir`, which reads a directory.
 * Rendering itself lives in `render.ts`.
 */

/** Model tiers from the PRD §13 table (which sessions may use a template). */
export type TemplateTier = "main" | "small" | "second-opinion";

export const TEMPLATE_TIERS: readonly TemplateTier[] = ["main", "small", "second-opinion"];

/** A parsed template file, ready to render. */
export interface ParsedTemplate {
  /** File basename without `.md` (e.g. `reader`). */
  name: string;
  role: string;
  tier: TemplateTier;
  /** Declared variables, sorted for stable output. */
  variables: string[];
  /** Body after the front matter, with line endings normalised to LF. */
  body: string;
  /** Unique placeholders found in the body, sorted. Always ⊆ variables. */
  usedVariables: string[];
}

export interface TemplateIssue {
  template: string;
  message: string;
}

/** Thrown when a template file fails validation. Carries every issue found. */
export class TemplateLoadError extends Error {
  readonly issues: TemplateIssue[];
  constructor(issues: TemplateIssue[]) {
    super(`invalid prompt template: ${issues.map((i) => `${i.template}: ${i.message}`).join("; ")}`);
    this.name = "TemplateLoadError";
    this.issues = issues;
  }
}

/** A declared or used variable path: `name` or `a.b.c`. */
export const VARIABLE_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Matches one placeholder; the scanner in `scanPlaceholders` enforces strictness. */
const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g;

/** Normalise line endings to LF (deterministic bytes on macOS and Linux). */
export function normaliseLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * Scan a body for placeholders. Returns the sorted unique paths.
 * Throws a TemplateLoadError entry when a `{{` does not form a valid
 * placeholder (e.g. `{{foo bar}}` or an unclosed `{{`).
 */
function scanPlaceholders(templateName: string, body: string): string[] {
  const found = new Set<string>();
  const issues: TemplateIssue[] = [];
  let i = 0;
  while (true) {
    const open = body.indexOf("{{", i);
    if (open < 0) break;
    PLACEHOLDER.lastIndex = open;
    const m = PLACEHOLDER.exec(body);
    if (m && m.index === open) {
      found.add(m[1]);
      i = open + m[0].length;
    } else {
      const preview = body.slice(open, open + 24).replace(/\n/g, "\\n");
      issues.push({
        template: templateName,
        message: `malformed placeholder near "${preview}": placeholders must look like {{variable}} or {{anchor.quote}}`,
      });
      i = open + 2;
    }
  }
  if (issues.length > 0) throw new TemplateLoadError(issues);
  return [...found].sort();
}

interface FrontMatter {
  role: string;
  tier: TemplateTier;
  variables: string[];
}

/** Minimal front-matter parser: `key: value` lines with scalars or `[...]`/`-` lists. */
function parseFrontMatter(templateName: string, raw: string): { fm: FrontMatter; body: string } {
  const issues: TemplateIssue[] = [];
  const fail = (message: string): never => {
    throw new TemplateLoadError([{ template: templateName, message }]);
  };
  if (!raw.startsWith("---\n") && raw !== "---" && !raw.startsWith("---\r\n")) {
    fail("missing front matter: file must start with a --- fence");
  }
  const rest = raw.slice(3);
  const lines = rest.split("\n");
  // lines[0] is the remainder of the opening fence line ("" after normalisation).
  if (lines[0].trim() !== "") fail("front matter opening fence must be --- alone on its first line");
  let close = -1;
  for (let n = 1; n < lines.length; n++) {
    if (lines[n].trim() === "---" || lines[n].trim() === "...") {
      close = n;
      break;
    }
  }
  if (close < 0) fail("missing closing --- fence for front matter");
  const fmLines = lines.slice(1, close);
  const bodyLines = lines.slice(close + 1);
  // Drop exactly one leading blank line after the fence (the conventional gap).
  if (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();

  const fields = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of fmLines) {
    if (/^\s*(#|$)/.test(line)) continue;
    const listItem = line.match(/^\s+-\s+(.*)$/);
    if (listItem && current) {
      fields.get(current)?.push(listItem[1].trim());
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!kv) {
      issues.push({ template: templateName, message: `cannot parse front-matter line: "${line.trim()}"` });
      continue;
    }
    current = kv[1];
    if (fields.has(current)) {
      issues.push({ template: templateName, message: `duplicate front-matter key "${current}"` });
      continue;
    }
    fields.set(current, [kv[2].trim()]);
  }

  for (const key of fields.keys()) {
    if (key !== "role" && key !== "tier" && key !== "variables") {
      issues.push({ template: templateName, message: `unknown front-matter key "${key}"` });
    }
  }

  const roleRaw = fields.get("role")?.[0] ?? "";
  const tierRaw = fields.get("tier")?.[0] ?? "";
  if (!roleRaw) issues.push({ template: templateName, message: 'missing required front-matter key "role"' });
  if (!tierRaw) {
    issues.push({ template: templateName, message: 'missing required front-matter key "tier"' });
  } else if (!(TEMPLATE_TIERS as readonly string[]).includes(tierRaw)) {
    issues.push({
      template: templateName,
      message: `invalid tier "${tierRaw}": must be one of ${TEMPLATE_TIERS.join(", ")}`,
    });
  }

  const variables: string[] = [];
  if (!fields.has("variables")) {
    issues.push({ template: templateName, message: 'missing required front-matter key "variables" (use [] when none)' });
  } else {
    const rawVars = fields.get("variables") ?? [];
    // `variables: [a, b]` inline form, or block `- a` list form, or `[]`.
    let items: string[];
    if (rawVars.length === 1 && rawVars[0].startsWith("[") && rawVars[0].endsWith("]")) {
      const inner = rawVars[0].slice(1, -1).trim();
      items = inner === "" ? [] : inner.split(",").map((s) => s.trim());
    } else if (rawVars.length === 1 && rawVars[0] === "") {
      items = [];
    } else {
      items = rawVars.map((s) => s.trim()).filter((s) => s !== "");
    }
    const seen = new Set<string>();
    for (const v of items) {
      if (!VARIABLE_PATH.test(v)) {
        issues.push({ template: templateName, message: `invalid variable name "${v}"` });
      } else if (seen.has(v)) {
        issues.push({ template: templateName, message: `duplicate variable "${v}"` });
      } else {
        seen.add(v);
        variables.push(v);
      }
    }
  }

  if (issues.length > 0) throw new TemplateLoadError(issues);
  return {
    fm: {
      role: roleRaw,
      tier: tierRaw as TemplateTier,
      variables: [...variables].sort(),
    },
    body: bodyLines.join("\n"),
  };
}

/**
 * Parse and validate one template file. `raw` is the file's UTF-8 text.
 * Throws TemplateLoadError with every issue found.
 */
export function parseTemplate(name: string, raw: string): ParsedTemplate {
  const { fm, body } = parseFrontMatter(name, normaliseLineEndings(raw));
  const usedVariables = scanPlaceholders(name, body);
  const declared = new Set(fm.variables);
  const undeclared = usedVariables.filter((v) => !declared.has(v));
  if (undeclared.length > 0) {
    throw new TemplateLoadError(
      undeclared.map((v) => ({
        template: name,
        message: `placeholder {{${v}}} is used but not declared in front-matter variables`,
      })),
    );
  }
  return {
    name,
    role: fm.role,
    tier: fm.tier,
    variables: fm.variables,
    body,
    usedVariables,
  };
}
