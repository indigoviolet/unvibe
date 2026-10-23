/**
 * Glossary (issue #252): the guide's shared term list.
 *
 * The reader writes the glossary in its existing turn (trailing JSON
 * `glossary`); later card-writing turns receive it as a compact context
 * block; card text links exact matches with no agent.
 *
 * Pure TypeScript: no Node or DOM APIs, so service and web both import it.
 */

import { parseId } from "./ids.js";
import { truncateAtWordBoundary } from "./content/hunk.js";

/** One glossary term: exact code name, one-line definition, citation. */
export interface GlossaryEntry {
  /** Exact name from the code (identifier, file, setting, flag or term). */
  name: string;
  /** One-line definition. */
  definition: string;
  /** Where it is defined: existing citation grammar (`code:`, `diff:` or `h:`). */
  citation: string;
}

/** Raw trailing-JSON shape the reader sends. */
export interface RawGlossaryEntry {
  name?: unknown;
  definition?: unknown;
  citation?: unknown;
}

/** Most terms the reader may name (kept compact for later prompts). */
export const MAX_GLOSSARY_TERMS = 20;

/** Max chars for a name / definition (one line each). */
export const MAX_GLOSSARY_NAME = 80;
export const MAX_GLOSSARY_DEFINITION = 200;

export interface NormalizedGlossary {
  terms: GlossaryEntry[];
  dropped: {
    /** Entries missing a name, definition or citation (or wrong types). */
    empty: number;
    /** Entries with a citation that does not parse as diff/code/h. */
    invalidCitation: number;
    /** Entries dropped as duplicate exact names (first wins). */
    duplicates: number;
    /** Entries past the cap. */
    extra: number;
  };
}

function cleanName(text: string): string {
  return truncateAtWordBoundary(text.replace(/\s+/g, " ").trim(), MAX_GLOSSARY_NAME);
}

function cleanDefinition(text: string): string {
  return truncateAtWordBoundary(text.replace(/\s+/g, " ").trim(), MAX_GLOSSARY_DEFINITION);
}

/**
 * Validate one reader glossary payload. Empty input is valid (no terms yet).
 * Exact-name dedupe: first wins. Unknown/invalid shapes are dropped and
 * reported, never stored.
 */
export function normalizeGlossary(input: unknown): NormalizedGlossary {
  const empty = { terms: [], dropped: { empty: 0, invalidCitation: 0, duplicates: 0, extra: 0 } };
  if (!Array.isArray(input)) return empty;
  const terms: GlossaryEntry[] = [];
  const seen = new Set<string>();
  let invalidCitation = 0;
  let duplicates = 0;
  let extra = 0;
  let emptyCount = 0;
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      emptyCount += 1;
      continue;
    }
    const rec = raw as Record<string, unknown>;
    const nameRaw = typeof rec["name"] === "string" ? rec["name"] : "";
    const defRaw = typeof rec["definition"] === "string" ? rec["definition"] : "";
    const citeRaw = typeof rec["citation"] === "string" ? rec["citation"] : "";
    const name = cleanName(nameRaw);
    const definition = cleanDefinition(defRaw);
    const citation = citeRaw.trim();
    if (name === "" || definition === "" || citation === "") {
      emptyCount += 1;
      continue;
    }
    const parsed = parseId(citation);
    if (!parsed || (parsed.kind !== "diff" && parsed.kind !== "code" && parsed.kind !== "h")) {
      invalidCitation += 1;
      continue;
    }
    if (seen.has(name)) {
      duplicates += 1;
      continue;
    }
    if (terms.length >= MAX_GLOSSARY_TERMS) {
      extra += 1;
      continue;
    }
    seen.add(name);
    terms.push({ name, definition, citation });
  }
  return { terms, dropped: { empty: emptyCount, invalidCitation, duplicates, extra } };
}

/**
 * Compact context block for later card-writing turns (per-hunk jobs, Ask,
 * Go deeper, concept pages). Names + one-line definitions only, no long
 * text, with the instruction to use those exact terms.
 */
export function formatGlossaryForPrompt(terms: GlossaryEntry[]): string {
  if (terms.length === 0) return "";
  const rows = terms.map((t) => `- \`${t.name}\` — ${t.definition}`);
  return [
    "## Glossary",
    "",
    "Use these exact terms for the things they name: call each thing by this exact term everywhere, never a synonym, abbreviation or paraphrase.",
    "",
    ...rows,
    "",
  ].join("\n");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_]/.test(ch);
}

/**
 * Link exact glossary matches in a stored HTML string.
 *
 * Rules (issue #252):
 * - exact, case-sensitive matches only, with word boundaries (no substring
 *   of a larger identifier);
 * - longest names first, so a short prefix never steals a longer term;
 * - only the first mention per card: `used` tracks names already linked
 *   across the card's blocks (share one set per card);
 * - never inside existing `<a>` links or tags themselves (callers never
 *   pass fenced code blocks or headings: `CodeBlock`s render separately
 *   and card titles render separately). Inline `<code>` spans ARE linked:
 *   identifiers usually appear there, and the link nests inside the span.
 *
 * Returns the transformed HTML and the names linked in this string.
 */
export function linkGlossaryInHtml(
  html: string,
  terms: GlossaryEntry[],
  used?: Set<string>,
): { html: string; linked: string[] } {
  const seen = used ?? new Set<string>();
  const candidates = terms
    .filter((t) => t.name !== "" && !seen.has(t.name))
    .sort((a, b) => b.name.length - a.name.length);
  if (candidates.length === 0 || html === "") return { html, linked: [] };
  const linked: string[] = [];
  // Split into tags vs text so replacements never touch markup.
  const parts = html.split(/(<[^>]*>)/g);
  let inAnchor = 0;
  const out: string[] = [];
  for (const part of parts) {
    if (part === "") continue;
    if (part.startsWith("<")) {
      const lower = part.toLowerCase();
      if (/^<\s*a\b/.test(lower)) inAnchor += 1;
      else if (/^<\s*\/\s*a\b/.test(lower)) inAnchor = Math.max(0, inAnchor - 1);
      out.push(part);
      continue;
    }
    if (inAnchor > 0) {
      out.push(part);
      continue;
    }
    out.push(linkTextNode(part, candidates, seen, linked));
  }
  return { html: out.join(""), linked };
}

function linkTextNode(
  text: string,
  candidates: GlossaryEntry[],
  seen: Set<string>,
  linked: string[],
): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    let best: GlossaryEntry | null = null;
    for (const t of candidates) {
      if (seen.has(t.name)) continue;
      if (text.startsWith(t.name, i)) {
        const before = i > 0 ? text[i - 1] : undefined;
        const after = i + t.name.length < text.length ? text[i + t.name.length] : undefined;
        if (isWordChar(before) || isWordChar(after)) continue;
        best = t;
        break; // candidates sorted longest-first
      }
    }
    if (!best) {
      out += text[i];
      i += 1;
      continue;
    }
    out += `<a class="gx" data-glossary="${escapeAttr(best.name)}">${escapeHtmlText(best.name)}</a>`;
    seen.add(best.name);
    linked.push(best.name);
    i += best.name.length;
  }
  return out;
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
