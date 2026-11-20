/**
 * Required reader-guide shape (issue #430).
 *
 * A live reader turn once stopped after its first card ("The problem")
 * plus its trailing block, and the pipeline stored the one-card guide as
 * done. The required structure is checked here, as pure logic, after the
 * reader reply parses:
 *
 * - a card titled "The problem" with a non-empty body;
 * - a card titled "The central idea" with a non-empty body;
 * - at least 3 Go-deeper directions (`pendingCards` in the trailing data;
 *   the prompt asks for 3–5).
 *
 * It returns exactly what is missing; the pipeline asks for the missing
 * part in its single repair turn, and marks the job degraded when the
 * repair is still incomplete.
 */
import type { Block } from "./entities.js";

/** Minimum Go-deeper directions the reader prompt asks for (3–5). */
export const READER_MIN_GO_DEEPER = 3;

/** One parsed reader card: the title plus its blocks. */
export interface ReaderShapeCard {
  title: string | null;
  blocks: Block[];
}

export interface ReaderShapeResult {
  /** True when nothing is missing. */
  complete: boolean;
  /** True when no "The problem" card with a non-empty body was written. */
  missingProblem: boolean;
  /** True when no "The central idea" card with a non-empty body was written. */
  missingCentral: boolean;
  /** Go-deeper directions present in the trailing data. */
  goDeeperHave: number;
  /**
   * Display names of exactly what is missing, in prompt order:
   * "The problem", "The central idea" and/or
   * "Go deeper directions (N of at least 3)". Empty when complete.
   */
  missing: string[];
}

function normalizeTitle(title: string | null): string {
  return (title ?? "").trim().toLowerCase();
}

function isProblemTitle(title: string | null): boolean {
  return normalizeTitle(title) === "the problem";
}

function isCentralTitle(title: string | null): boolean {
  // "The central change" is the legacy title for the same card (the
  // pipeline's `readerCardId` maps both to `central`); accept it so an
  // older-phrased reply is not flagged as missing its central card.
  const t = normalizeTitle(title);
  return t === "the central idea" || t === "the central change";
}

function textHasContent(html: string | undefined): boolean {
  if (!html) return false;
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length > 0;
}

/**
 * True when the block carries real content. An empty placeholder (an
 * empty paragraph, an empty list, a code fence with no code) does not
 * count: a card with only those is still missing its body.
 */
export function shapeBlockHasContent(block: Block): boolean {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "table":
      return textHasContent(block.type === "paragraph" ? block.text : block.html);
    case "list":
      return block.items.some((i) => textHasContent(i.html));
    case "code":
    case "diagram":
      return (block.type === "code" ? block.code : block.source).trim().length > 0;
    case "aside":
      return block.inner.some(shapeBlockHasContent);
    case "follow-up":
      return block.items.length > 0;
    case "finding-link":
    case "comment-link":
      return true;
  }
}

function cardHasBody(card: ReaderShapeCard): boolean {
  return card.blocks.some(shapeBlockHasContent);
}

/**
 * Check a parsed reader reply against the required shape. Pure: no I/O,
 * no validation against the review — callers pass the parsed cards and
 * the trailing data's `pendingCards` (anything else there is ignored).
 *
 * `requireGoDeeper` mirrors what the reader prompt requested (see
 * `requestedReaderFields` in the pipeline): persona forks whose template
 * omits the directions must not fail the check. The two cards are always
 * required — every reader template writes them.
 */
export function checkReaderShape(
  cards: ReaderShapeCard[],
  pendingCards: unknown,
  opts: { requireGoDeeper?: boolean } = {},
): ReaderShapeResult {
  const requireGoDeeper = opts.requireGoDeeper ?? true;
  const missingProblem = !cards.some((c) => isProblemTitle(c.title) && cardHasBody(c));
  const missingCentral = !cards.some((c) => isCentralTitle(c.title) && cardHasBody(c));
  const goDeeperHave = Array.isArray(pendingCards) ? pendingCards.length : 0;
  const missingGoDeeper = requireGoDeeper && goDeeperHave < READER_MIN_GO_DEEPER;
  const missing: string[] = [];
  if (missingProblem) missing.push("The problem");
  if (missingCentral) missing.push("The central idea");
  if (missingGoDeeper) missing.push(`Go deeper directions (${goDeeperHave} of at least ${READER_MIN_GO_DEEPER})`);
  return {
    complete: missing.length === 0,
    missingProblem,
    missingCentral,
    goDeeperHave,
    missing,
  };
}
