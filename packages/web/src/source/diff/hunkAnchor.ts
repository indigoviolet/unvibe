/**
 * Hunk-anchor helpers (issue #138): idle summaries are addressed
 * `h:<fileKey>:<contentHash>` (stable while the hunk's content is).
 *
 * - `parseHunkAttr` reads the `data-hunksum` attribute off an idle summary;
 * - `findHunk` resolves it against the snapshot;
 * - `firstChangedLine` is the comment line for a summary: the first added
 *   line on the new side, else the hunk's new-side position (`newStart`,
 *   where a removed-only hunk sits — comments anchor new-side lines);
 * - `hunkCommentAnchor` maps a summary Comment there (it never activates
 *   the summary);
 * - `hunkDiffRange` scopes the GitHub link to the hunk's line range.
 */
import type { ActionAnchor, Hunk, ReviewFile, ReviewSnapshot } from "@unvibe/shared";
import type { DiffRange } from "../../floating/SelectionToolbar.js";

export interface HunkRef {
  fileKey: string;
  contentHash: string;
}

/** Parse `data-hunksum="<fileKey>:<contentHash>"` (hashes never hold colons). */
export function parseHunkAttr(value: string | undefined): HunkRef | null {
  if (!value) return null;
  const sep = value.lastIndexOf(":");
  if (sep <= 0 || sep + 1 >= value.length) return null;
  return { fileKey: value.slice(0, sep), contentHash: value.slice(sep + 1) };
}

export function hunkAttr(ref: HunkRef): string {
  return `${ref.fileKey}:${ref.contentHash}`;
}

export function findHunk(
  snapshot: ReviewSnapshot | null | undefined,
  ref: HunkRef,
): { file: ReviewFile; hunk: Hunk } | null {
  const file = snapshot?.files.find((f) => f.fileKey === ref.fileKey);
  const hunk = file?.hunks.find((h) => h.contentHash === ref.contentHash);
  if (!file || !hunk) return null;
  return { file, hunk };
}

/**
 * First changed line of a hunk for comment placement: the first added
 * line on the new side; for removed-only hunks the new-side position of
 * the removal (`newStart`), since comment slots live on new-side lines.
 */
export function firstChangedLine(hunk: Hunk): number {
  const added = hunk.lines.find((l) => l.kind === "add" && l.newLine !== undefined);
  return added?.newLine ?? hunk.newStart;
}

/** Diff-line anchor for a Comment on a summary (no activation). */
export function hunkCommentAnchor(
  snapshot: ReviewSnapshot | null | undefined,
  ref: HunkRef,
): ActionAnchor | null {
  const found = findHunk(snapshot, ref);
  if (!found) return null;
  return { where: "diff-line", fileKey: found.file.fileKey, line: firstChangedLine(found.hunk) };
}

/** Line range behind a hunk for the GitHub link. */
export function hunkDiffRange(
  snapshot: ReviewSnapshot | null | undefined,
  ref: HunkRef,
): DiffRange | null {
  const found = findHunk(snapshot, ref);
  if (!found) return null;
  const { file, hunk } = found;
  const newLines: number[] = [];
  if (hunk.newEnd >= hunk.newStart) {
    for (let n = hunk.newStart; n <= hunk.newEnd; n++) newLines.push(n);
  }
  const oldLines: number[] = [];
  if (hunk.oldEnd >= hunk.oldStart) {
    for (let n = hunk.oldStart; n <= hunk.oldEnd; n++) oldLines.push(n);
  }
  if (newLines.length === 0 && oldLines.length === 0) return null;
  return { fileKey: file.fileKey, newLines, oldLines };
}
