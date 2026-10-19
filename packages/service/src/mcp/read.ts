/**
 * Narrow read interface over review state (PRD §10).
 *
 * The supervisor wires this to the review-state module after merge; the
 * MCP server only ever reads through it (plus the worktree path for
 * `get_code`). Shapes are structural and minimal so the adapter is small.
 */
import fs from "node:fs";
import path from "node:path";
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
 * `get_code` tool serves, pin persistence reuses, and the file-slice
 * route (`GET /api/reviews/:id/file`, issue #133) reads through. Never
 * throws: git failures, missing files, past-EOF ranges and binary blobs
 * come back as `{ error }` (out-of-range also carries the file's
 * `totalLines` so callers can clamp without a second read). Callers
 * check the path stays inside the repo first
 * (`McpRegistry.checkPathInRepo`).
 */
/**
 * Whole text at `rev`, or null when git cannot serve it. A working copy
 * that is not a git checkout at all (the bundled demo, #176: its files are
 * materialized from the fixture diff and there is no commit to show) has
 * exactly one content source — the files on disk, which are the head tree
 * by construction — so serve those. A real git worktree never takes this
 * path: when git is present, a failed `git show` stays `not-found`.
 */
async function readTextAtRev(
  commands: CommandRunner,
  cwd: string,
  rev: string,
  relPath: string,
): Promise<{ text: string; fromDisk: boolean } | null> {
  try {
    const res = await commands.run("git", { args: ["show", `${rev}:${relPath}`], cwd });
    if (res.code === 0) return { text: res.stdout, fromDisk: false };
  } catch {
    // Fall through to the on-disk source below.
  }
  try {
    if (fs.existsSync(path.join(cwd, ".git"))) return null;
    return { text: fs.readFileSync(path.join(cwd, relPath), "utf8"), fromDisk: true };
  } catch {
    return null;
  }
}

export async function readCodeSlice(
  commands: CommandRunner,
  cwd: string,
  rev: string,
  relPath: string,
  start: number,
  end: number,
): Promise<{ text: string; totalLines: number } | { error: CodeSliceError; totalLines?: number }> {
  const found = await readTextAtRev(commands, cwd, rev, relPath);
  if (found === null) return { error: "not-found" };
  const stdout = found.text;
  if (stdout.includes("\0")) return { error: "binary" };
  const all = stdout.split("\n");
  // `git show` ends output with a newline: drop the split artifact so a
  // file of N lines reports N, and drop a lone empty artifact for empty
  // files (total 0).
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  const totalLines = all.length;
  if (start < 1 || end > totalLines) return { error: "out-of-range", totalLines };
  const text = all.slice(start - 1, end).join("\n");
  // On-disk materialized files (#176) pad lines the fixture does not know
  // with blanks: a slice with no known line has no content to serve, so
  // it stays `not-found` instead of presenting blanks as real code (the
  // diff's content probe then hides expansion on such reviews, as before).
  if (found.fromDisk && text.trim() === "") return { error: "not-found" };
  return { text, totalLines };
}

/**
 * Whole text of `relPath` at `rev`, via the same `git show` source as
 * `readCodeSlice` above (one content-at-revision family, not a second
 * reader). The outline route parses file content through this; slices
 * keep going through `readCodeSlice`. Never throws: same `{ error }`
 * shapes, without a range to check.
 */
export async function readFileText(
  commands: CommandRunner,
  cwd: string,
  rev: string,
  relPath: string,
): Promise<{ text: string; totalLines: number } | { error: CodeSliceError }> {
  const found = await readTextAtRev(commands, cwd, rev, relPath);
  if (found === null) return { error: "not-found" };
  const stdout = found.text;
  if (stdout.includes("\0")) return { error: "binary" };
  const all = stdout.split("\n");
  if (all.length > 0 && all[all.length - 1] === "") all.pop();
  return { text: all.join("\n"), totalLines: all.length };
}
