/**
 * Text-selection helpers (comments owner; PRD §4.6).
 *
 * Pure, DOM-free word snapping ported from `prototype.html` so it is unit
 * tested here and reused by the floating toolbar:
 * - a selection snaps to whole words, with leading/trailing spaces trimmed;
 * - the highlight updates to match (the toolbar calls this before reading
 *   the quote, then re-applies the snapped range to the live Selection).
 *
 * The DOM host resolution (`resolveSelectionHost`) lives in
 * `SelectionToolbar.tsx` next to the mouse handling; the line-id parser
 * here is pure so the "pure-deletion row anchors to the nearest numbered
 * row" rule is tested without a browser.
 */

/** Word character: letters, numbers, `_`, straight and curly apostrophes. */
export const WORD_CHAR = /[\p{L}\p{N}_'’]/u;

/** Is this single character a word character? */
export function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  WORD_CHAR.lastIndex = 0;
  return WORD_CHAR.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/**
 * Snap `[start, end)` offsets inside one text node to whole words.
 * Mirrors the prototype's `snapToWords` for a single node:
 * - skip leading whitespace, trim trailing whitespace;
 * - grow a partial word at either end to its boundary (only when the
 *   selection starts/ends *inside* a word, i.e. both neighbours are word
 *   chars — a boundary start/end does not grow).
 */
export function snapWordOffsets(text: string, start: number, end: number): [number, number] {
  let so = Math.max(0, Math.min(text.length, start));
  let eo = Math.max(0, Math.min(text.length, end));
  if (eo < so) [so, eo] = [eo, so];
  while (so < text.length && isSpace(text[so])) so++;
  while (eo > 0 && isSpace(text[eo - 1])) eo--;
  while (so > 0 && isWordChar(text[so - 1]) && isWordChar(text[so] ?? "")) so--;
  while (eo < text.length && isWordChar(text[eo]) && isWordChar(text[eo - 1] ?? "")) eo++;
  return [so, eo];
}

/** Collapse whitespace and trim: the quoted anchor text. */
export function normalizeQuote(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** Longest selection the toolbar acts on (owner: cross-hunk and long-line selections must work). */
export const MAX_QUOTE_CHARS = 10_000;

/** Quotes shorter than 2 or longer than MAX_QUOTE_CHARS are not acted on. */
export function validSelectionQuote(quote: string): boolean {
  return quote.length >= 2 && quote.length <= MAX_QUOTE_CHARS;
}

export interface ParsedLineId {
  fileKey: string;
  line: number;
}

/**
 * Parse a diff row id of the form `L-<fileKey>-<line>`. File keys contain
 * dashes and dots (service-canonical path slugs), so split from the right —
 * the prototype's `/^L-(\w+)-(\d+)$/` cannot parse them.
 */
export function parseLineElementId(id: string): ParsedLineId | null {
  if (!id.startsWith("L-")) return null;
  const rest = id.slice(2);
  const dash = rest.lastIndexOf("-");
  if (dash <= 0) return null;
  const fileKey = rest.slice(0, dash);
  const line = Number(rest.slice(dash + 1));
  if (!fileKey || !Number.isSafeInteger(line) || line < 1) return null;
  return { fileKey, line };
}

/** Registry key for a new-side diff line (mirrors `lineSlots.slotKey`). */
export function diffSlotKey(fileKey: string, line: number): string {
  return `${fileKey}:${line}`;
}
