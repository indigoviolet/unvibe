/**
 * Pure hunk-token plumbing (spike/shiki-highlighting, Refs #23). No Shiki
 * import here, so this is unit-testable with a fake tokenizer.
 *
 * Model: a hunk is a fragment, so each side is tokenised as its own
 * sequence with grammar state carried across its lines:
 * - old side: `del` + `ctx` line texts, in hunk order;
 * - new side: `add` + `ctx` line texts, in hunk order.
 * Context lines therefore get one token row per side; the two may differ
 * when the sides' grammar states diverge (e.g. one side opened a
 * multi-line string). Unified rows show the new-side row (the post-image
 * under review); split cells show their own side.
 *
 * Caps: a single line longer than MAX_LINE_CHARS renders plain (pathological
 * regex cost lives in long minified lines); a side longer than
 * MAX_SIDE_CHARS skips the whole hunk. Binary files never reach us (no
 * rows); unknown languages return null upstream.
 */

import type { Hunk, HunkLine } from "@unvibe/shared";

/** Single coloured run inside a code line. */
export interface TokenSeg {
  text: string;
  /** `shk-*` class, or null for default-coloured text (no span needed). */
  cls: string | null;
  bold: boolean;
  italic: boolean;
}

export type LineTokens = TokenSeg[];

/** Lines over this length render plain (minified/generated protection). */
export const MAX_LINE_CHARS = 2000;
/** Sides over this many chars skip the hunk (keeps one hunk from janking). */
export const MAX_SIDE_CHARS = 100_000;

/**
 * Map a Shiki CSS-variable colour to our `shk-*` class. Our theme only ever
 * emits `var(--shk-…)` colours (see `shiki.ts`), so anything else falls back
 * to null (plain) and the caller may use the raw colour as an inline style.
 */
export function classForColor(color: string | undefined): string | null {
  switch (color) {
    case "var(--shk-token-keyword)":
      return "shk-kw";
    case "var(--shk-token-string)":
    case "var(--shk-token-string-expression)":
      return "shk-str";
    case "var(--shk-token-comment)":
      return "shk-com";
    case "var(--shk-token-function)":
      return "shk-fn";
    case "var(--shk-token-constant)":
      return "shk-const";
    case "var(--shk-token-parameter)":
      return "shk-param";
    case "var(--shk-token-link)":
      return "shk-link";
    default:
      return null;
  }
}

export interface RawToken {
  content: string;
  color?: string;
  /** Shiki fontStyle bitmask: 1 = italic, 2 = bold, 4 = underline. */
  fontStyle?: number;
}

/** Convert one Shiki token row to render segments (plain runs stay spanless). */
export function toSegments(row: RawToken[]): LineTokens {
  const out: LineTokens = [];
  for (const t of row) {
    if (!t.content) continue;
    const cls = classForColor(t.color);
    const fs = t.fontStyle ?? 0;
    const bold = (fs & 2) !== 0;
    const italic = (fs & 1) !== 0;
    if (cls === null && !bold && !italic) {
      out.push({ text: t.content, cls: null, bold: false, italic: false });
    } else {
      out.push({ text: t.content, cls, bold, italic });
    }
  }
  return out;
}

/** Old-side (`del`+`ctx`) and new-side (`add`+`ctx`) texts, in hunk order. */
export function splitHunkSides(lines: HunkLine[]): { oldTexts: string[]; newTexts: string[] } {
  const oldTexts: string[] = [];
  const newTexts: string[] = [];
  for (const l of lines) {
    if (l.kind === "del" || l.kind === "ctx") oldTexts.push(l.text);
    if (l.kind === "add" || l.kind === "ctx") newTexts.push(l.text);
  }
  return { oldTexts, newTexts };
}

/**
 * Per-line token rows for one hunk, aligned with `hunk.lines`:
 * `old[i]` covers `del`/`ctx` rows, `new[i]` covers `add`/`ctx` rows,
 * the other side is null. A line over MAX_LINE_CHARS maps to null on both
 * sides (plain). `tokenize` tokenises one side's joined texts and must
 * return exactly one row per input line.
 */
export async function tokenizeHunk(
  hunk: Hunk,
  tokenize: (texts: string[]) => Promise<RawToken[][]>,
): Promise<{ old: (LineTokens | null)[]; new: (LineTokens | null)[] } | null> {
  const { oldTexts, newTexts } = splitHunkSides(hunk.lines);
  const oldChars = oldTexts.reduce((s, t) => s + t.length, 0);
  const newChars = newTexts.reduce((s, t) => s + t.length, 0);
  if (oldChars > MAX_SIDE_CHARS || newChars > MAX_SIDE_CHARS) return null;
  let oldRows: RawToken[][] = [];
  let newRows: RawToken[][] = [];
  try {
    [oldRows, newRows] = await Promise.all([tokenize(oldTexts), tokenize(newTexts)]);
  } catch {
    return null;
  }
  if (oldRows.length !== oldTexts.length || newRows.length !== newTexts.length) return null;
  const oldSegs = oldRows.map(toSegments);
  const newSegs = newRows.map(toSegments);
  const old: (LineTokens | null)[] = [];
  const next: (LineTokens | null)[] = [];
  let oi = 0;
  let ni = 0;
  hunk.lines.forEach((l, i) => {
    void i;
    if (l.kind === "del" || l.kind === "ctx") {
      old.push(l.text.length > MAX_LINE_CHARS ? null : (oldSegs[oi] ?? null));
      oi++;
    } else {
      old.push(null);
    }
    if (l.kind === "add" || l.kind === "ctx") {
      next.push(l.text.length > MAX_LINE_CHARS ? null : (newSegs[ni] ?? null));
      ni++;
    } else {
      next.push(null);
    }
  });
  return { old, new: next };
}

/** Cache key: hunk content + language (hashes ignore line numbers). */
export function cacheKey(contentHash: string, lang: string): string {
  return `${lang}:${contentHash}`;
}
