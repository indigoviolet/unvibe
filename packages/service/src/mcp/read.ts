/**
 * Narrow read interface over review state (PRD §10).
 *
 * The supervisor wires this to the review-state module after merge; the
 * MCP server only ever reads through it (plus the worktree path for
 * `get_code`). Shapes are structural and minimal so the adapter is small.
 */
import type { CommandRunner } from "../exec/index.js";

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

/** Why a `code:` slice could not be resolved. */
export type CodeSliceError = "not-found" | "out-of-range" | "binary";

/**
 * Raw text of `relPath` lines [start, end] at `rev`, via
 * `git show <rev>:<relPath>` — the single content-at-revision source the
 * `get_code` tool serves and pin persistence reuses. Never throws: git
 * failures, missing files, past-EOF ranges and binary blobs come back as
 * `{ error }`. Callers check the path stays inside the repo first
 * (`McpRegistry.checkPathInRepo`).
 */
export async function readCodeSlice(
  commands: CommandRunner,
  cwd: string,
  rev: string,
  relPath: string,
  start: number,
  end: number,
): Promise<{ text: string } | { error: CodeSliceError }> {
  let stdout: string;
  try {
    const res = await commands.run("git", { args: ["show", `${rev}:${relPath}`], cwd });
    if (res.code !== 0) return { error: "not-found" };
    stdout = res.stdout;
  } catch {
    return { error: "not-found" };
  }
  if (stdout.includes("\0")) return { error: "binary" };
  const all = stdout.split("\n");
  if (start < 1 || end > all.length) return { error: "out-of-range" };
  return { text: all.slice(start - 1, end).join("\n") };
}
