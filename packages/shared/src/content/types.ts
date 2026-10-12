/**
 * Structured reply types (PRD §10).
 *
 * Agents write Markdown with inline link tokens and end the reply with one
 * fenced JSON block carrying structured fields. The app removes that block
 * before display. This module defines the split result and the known JSON
 * fields; unknown fields are preserved, never rejected.
 */

export type SplitErrorKind = "missing" | "malformed" | "not-object";

export interface SplitError {
  kind: SplitErrorKind;
  message: string;
}

/**
 * Result of {@link splitReply}. Never throws: a missing or malformed
 * trailing block is returned as a typed error.
 */
export type SplitResult =
  | { ok: true; body: string; data: ReplyData; rawJson: string }
  | { ok: false; body: string; data: null; error: SplitError };

/** Confidence label used on finding pages ("Agent finding · <confidence>"). */
export type FindingConfidence = "low" | "medium" | "high";

/** Structured fields accepted in the trailing JSON block. All optional. */
export interface ReplyData {
  /** Title for a single-card reply (explain/ask/depth/examples/diagram). */
  title?: string;
  /** Stable card-id hint; the app assigns real IDs. */
  cardId?: string;
  /** Finding metadata (critic replies): evidence lives in the Markdown. */
  finding?: {
    confidence?: FindingConfidence | string;
    summary?: string;
    suggestedComment?: { text?: string; diff?: string };
  };
  /** Automatic contribution items (PRD §9.5). At most 1–3 items. */
  contribute?: {
    facts?: { text?: string; citations?: string[] }[];
    corrections?: { text?: string; target?: string; citations?: string[] }[];
    open_questions?: string[] | { text?: string }[];
    reader_notes?: string[] | { text?: string }[];
    replaces?: string;
  };
  /** Depth rewrite marker: which level the Markdown body is written at. */
  depth?: { level?: string; cardId?: string };
  /** Follow-up suggestions (also writable inline; JSON wins on conflict). */
  followUps?: { label?: string; ask?: string }[];
  /** Hidden concept pass entries (reader replies). */
  concepts?: { slug?: string; title?: string; summary?: string }[];
  /** Hunk-pass result for one hunk. */
  hunk?: { summary?: string; hiddenReason?: string | null };
  /** Second-opinion verdict. */
  secondOpinion?: { verdict?: string; reasoning?: string; missed?: string | string[]; model?: string };
  /** Quoted anchor for explain/ask replies (validated as a substring). */
  anchor?: { quote?: string; host?: string };
  /** "Go deeper" placeholder directions (reader replies). */
  pendingCards?: { id?: string; label?: string; why?: string }[];
  /** Anything else the agent sent; kept, never validated. */
  [key: string]: unknown;
}

/** One parsed card: a title plus its blocks. */
export interface ParsedCard {
  /**
   * Null when the reply carried no title (the prompts require one for
   * every page card; the UI shows the shared fallback then — issues
   * #49/#50, `content/titles.ts`).
   */
  title: string | null;
  blocks: import("../entities.js").Block[];
}

export interface ParseOptions {
  /**
   * Prefix prepended to generated block IDs (default `""`).
   * IDs are `b1, b2, …` per card/parse call so re-parsing the same card
   * with appended text keeps every earlier ID stable.
   */
  idPrefix?: string;
  /**
   * Issue #50: when present (even empty), drop each card's leading body
   * line when it exactly echoes one of these strings (the selection, the
   * question, the stored title) or the card's own parsed title, after
   * normalising case, whitespace, surrounding quotes and trailing
   * punctuation. Exact match only. Absent = no stripping.
   */
  echoCandidates?: string[];
}
