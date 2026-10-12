/**
 * Card titles and echo stripping (issues #49, #50).
 *
 * - #49: every page card has a title. The prompts require one, but an
 *   older reply (or a model that ignores the instruction) may still omit
 *   it — there is no retry or repair turn. Instead the UI derives a
 *   fallback once, here, so the card header, the Contents entry and the
 *   card hover preview all agree: the first sentence or clause of the
 *   body as plain text, cut on a word boundary with an ellipsis, never
 *   mid-word. Expansions and threads already show their own header (the
 *   quoted selection), so they never use this — it applies to page cards
 *   only.
 * - #50: replies must not repeat what the reader already sees. The
 *   prompts say so, and as a backstop the parser drops a leading body
 *   line that exactly echoes the selection, the question or the card
 *   title. Exact match only (after normalisation): a line that merely
 *   starts with the selection, or that carries more than the echoed
 *   text (e.g. citations), is kept.
 *
 * The two must not fight: the strip step only ever matches the *real*
 * title/selection/question, never the derived fallback, and the fallback
 * is derived from the post-strip blocks — so a fallback can never cause
 * the strip to delete the body's first sentence.
 */
import type { Block } from "../entities.js";
import type { ParsedCard } from "./types.js";

/** Fallback titles cut here (word boundary + ellipsis beyond it). */
export const CARD_TITLE_FALLBACK_MAX = 70;

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Plain text of a block for title/echo purposes. Stored blocks hold
 * rendered HTML (tokens already stripped into `citations`); this reads
 * the display text back out.
 */
export function blockPlainText(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return collapse(decodeEntities(stripTags(block.text.standard)));
    case "list":
      return collapse(block.items.map((it) => decodeEntities(stripTags(it.html))).join(" "));
    case "table":
      return collapse(decodeEntities(stripTags(block.html)));
    case "code": {
      const first = block.code
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l !== "");
      return first ?? "";
    }
    case "diagram":
      return block.caption ? collapse(decodeEntities(stripTags(block.caption))) : "";
    case "aside": {
      for (const inner of block.inner) {
        const text = blockPlainText(inner);
        if (text) return text;
      }
      return "";
    }
    case "follow-up":
      return block.items[0]?.label.trim() ?? "";
    case "finding-link":
    case "comment-link":
      return "";
  }
}

// Abbreviations whose trailing stop must not end the fallback title.
const ABBREV = new Set([
  "e.g",
  "i.e",
  "etc",
  "vs",
  "mr",
  "mrs",
  "ms",
  "dr",
  "st",
  "fig",
  "eq",
  "ex",
  "cf",
  "al",
  "ed",
  "vol",
  "pp",
  "ch",
  "sec",
]);

/** Very short fragments are never a whole title ("No.", "e.g."). */
const MIN_SENTENCE = 12;

/**
 * The first sentence of `text`, when it ends within `max` (terminator
 * included). Returns null when the first sentence runs longer — the
 * caller then cuts on a word boundary instead.
 */
function firstSentence(text: string, max: number): string | null {
  const re = /[.!?](\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + 1;
    if (end > max) return null;
    const candidate = text.slice(0, end);
    if (candidate.length < MIN_SENTENCE) continue;
    const word = (candidate.slice(0, -1).split(/\s/).pop() ?? "").toLowerCase();
    if (ABBREV.has(word)) continue;
    return candidate.trim();
  }
  return null;
}

function cutTitle(text: string): string {
  const t = collapse(text);
  if (!t) return "";
  if (t.length <= CARD_TITLE_FALLBACK_MAX) return t;
  const sentence = firstSentence(t, CARD_TITLE_FALLBACK_MAX);
  if (sentence) return sentence;
  const slice = t.slice(0, CARD_TITLE_FALLBACK_MAX);
  const cut = slice.includes(" ") ? slice.slice(0, slice.lastIndexOf(" ")).trimEnd() : slice.trimEnd();
  return `${cut}…`;
}

/**
 * Fallback title for a card's blocks: the first sentence or clause of
 * the body as plain text, cut on a word boundary with an ellipsis.
 * `""` when the card has no text (callers then show nothing).
 */
export function fallbackCardTitle(blocks: Block[]): string {
  for (const block of blocks) {
    const text = blockPlainText(block);
    if (text) return cutTitle(text);
  }
  return "";
}

/**
 * The title the UI shows for a page card: the real title when present,
 * else the #49 fallback. `""` only when the card has neither.
 */
export function displayCardTitle(title: string | null | undefined, blocks: Block[]): string {
  const real = title?.trim();
  if (real) return real;
  return fallbackCardTitle(blocks);
}

/**
 * Normalise a line for echo comparison (#50): case, whitespace,
 * surrounding quotes and trailing punctuation are ignored.
 */
export function normalizeEchoLine(s: string): string {
  const collapsed = collapse(s).toLowerCase();
  const unquoted = collapsed.replace(/^\s*["'«»“”‘’`´]+|["'«»“”‘’`´]+\s*$/g, "").trim();
  return unquoted.replace(/[.!?;:,]+$/g, "").trim();
}

/**
 * Drop leading paragraph blocks whose plain text exactly matches one of
 * `echoes` (the selection, the question, …) after normalisation. Exact
 * match only: a block that merely starts with an echo, that carries
 * citations (it holds more than the echoed text), or that is not a
 * paragraph is kept. Repeats while the new first block matches, so a
 * stacked quote-echo + title-echo both go.
 */
export function stripLeadingEcho(blocks: Block[], echoes: (string | null | undefined)[]): Block[] {
  const wants = new Set(echoes.map((e) => normalizeEchoLine(e ?? "")).filter((e) => e !== ""));
  if (wants.size === 0) return blocks;
  const out = [...blocks];
  while (out.length > 0) {
    const first = out[0];
    if (first.type !== "paragraph") break;
    if (first.citations.length > 0) break;
    if (!wants.has(normalizeEchoLine(blockPlainText(first)))) break;
    out.shift();
  }
  return out;
}

/**
 * Apply {@link stripLeadingEcho} to every card of a parsed reply. Each
 * card is additionally matched against its own parsed title, so callers
 * only pass the context echoes (selection, question, stored title).
 */
export function stripEchoFromCards(cards: ParsedCard[], echoes: (string | null | undefined)[]): ParsedCard[] {
  return cards.map((card) => ({
    ...card,
    blocks: stripLeadingEcho(card.blocks, [...echoes, card.title ?? undefined]),
  }));
}
