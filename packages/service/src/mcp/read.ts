/**
 * Narrow read interface over review state (PRD §10).
 *
 * The supervisor wires this to the review-state module after merge; the
 * MCP server only ever reads through it (plus the worktree path for
 * `get_code`). Shapes are structural and minimal so the adapter is small.
 */

export interface McpHunk {
  fileKey: string;
  path: string;
  contentHash: string;
  header: string;
  newStart: number;
  newEnd: number;
  /** Full hunk text: diff body lines (with their +/-/space markers). */
  text: string;
}

export interface McpCard {
  id: string;
  title: string | null;
  /** Plain text of the card (all blocks concatenated by the adapter). */
  text: string;
}

export interface McpAnnotation {
  id: string;
  type: string;
  /** Short human summary of the anchor (file:line, quoted text, …). */
  anchorSummary: string;
  text: string;
}

export interface McpContribution {
  id: string;
  sourceSession: string;
  text: string;
}

export interface McpReviewData {
  reviewId: string;
  headSha: string;
  hunks: McpHunk[];
  cards: McpCard[];
  annotations: McpAnnotation[];
  contributions: McpContribution[];
  description: { id: string; text: string }[];
}

export interface ReviewReader {
  /** Null when the review is unknown (surfaces as an MCP error). */
  getReview(reviewId: string): Promise<McpReviewData | null>;
  /** Absolute worktree path for `get_code`, or null when unavailable. */
  getWorktreePath(reviewId: string): string | null | Promise<string | null>;
}

export interface PinRecord {
  reviewId: string;
  sessionId: string;
  path: string;
  lines: string;
  why: string;
  pinnedAt: number;
}
