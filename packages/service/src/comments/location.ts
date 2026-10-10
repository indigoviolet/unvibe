/**
 * Where a For-PR thread lands on GitHub (PRD 4.8, 4.12).
 *
 * - A diff-line thread -> that path + line + side.
 * - A guide-block thread -> the first `diff:` citation of its host block.
 * - Otherwise a general PR comment (goes into the review body).
 *
 * Handles multi-line ranges, lines GitHub will reject because they are
 * outside the diff context (fall back to the nearest commentable line in
 * the same hunk and say so in the text, or to the review body),
 * deleted-side lines, and renamed files.
 *
 * Pure: takes a snapshot + thread, returns the location.
 */

import type {
  Annotation,
  ReviewFile,
  ReviewSnapshot,
  SubmitCommentLocation,
} from "@unvibe/shared";
import { parseId } from "@unvibe/shared";
import { threadPostText } from "./threads.js";

export interface LocatedComment {
  thread: Annotation;
  location: SubmitCommentLocation;
  /** Exact text to post (draft + fallback note when we moved the line). */
  text: string;
}

function fileByKey(snapshot: ReviewSnapshot, fileKey: string): ReviewFile | null {
  return (snapshot.files ?? []).find((f) => f.fileKey === fileKey) ?? null;
}

function findBlockCitations(snapshot: ReviewSnapshot, blockId: string): string[] {
  for (const page of snapshot.pages ?? []) {
    for (const card of page.cards ?? []) {
      for (const block of card.blocks ?? []) {
        const b = block as { id?: string; citations?: Array<{ target: string }> };
        if (b.id === blockId) {
          return (b.citations ?? []).map((c) => c.target);
        }
        const inner = (block as { inner?: Array<{ id?: string; citations?: Array<{ target: string }> }> })
          .inner;
        if (Array.isArray(inner)) {
          for (const ib of inner) {
            if (ib.id === blockId) return (ib.citations ?? []).map((c) => c.target);
          }
        }
      }
    }
  }
  return [];
}

interface CommentableIndex {
  right: Map<number, number>;
  left: Map<number, number>;
}

function buildCommentable(file: ReviewFile): CommentableIndex {
  const right = new Map<number, number>();
  const left = new Map<number, number>();
  file.hunks.forEach((hunk, hi) => {
    for (const row of hunk.lines) {
      if ((row.kind === "add" || row.kind === "ctx") && row.newLine !== undefined) {
        if (!right.has(row.newLine)) right.set(row.newLine, hi);
      }
      if (row.kind === "del" && row.oldLine !== undefined) {
        if (!left.has(row.oldLine)) left.set(row.oldLine, hi);
      }
    }
  });
  return { right, left };
}

function hunkForNewLine(file: ReviewFile, line: number): number {
  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    if (line >= h.newStart && line <= Math.max(h.newEnd, h.newStart)) return i;
  }
  return -1;
}

function hunkForOldLine(file: ReviewFile, line: number): number {
  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    if (line >= h.oldStart && line <= Math.max(h.oldEnd, h.oldStart)) return i;
  }
  return -1;
}

function nearestInHunk(
  file: ReviewFile,
  hi: number,
  line: number,
): { line: number; side: "LEFT" | "RIGHT" } | null {
  const hunk = file.hunks[hi];
  if (!hunk) return null;
  let best: { line: number; side: "LEFT" | "RIGHT"; dist: number } | null = null;
  for (const row of hunk.lines) {
    if ((row.kind === "add" || row.kind === "ctx") && row.newLine !== undefined) {
      const dist = Math.abs(row.newLine - line);
      if (!best || dist < best.dist) best = { line: row.newLine, side: "RIGHT", dist };
    } else if (row.kind === "del" && row.oldLine !== undefined) {
      const dist = Math.abs(row.oldLine - line);
      if (!best || dist < best.dist) best = { line: row.oldLine, side: "LEFT", dist };
    }
  }
  return best ? { line: best.line, side: best.side } : null;
}

function resolveNewSideLine(
  file: ReviewFile,
  index: CommentableIndex,
  line: number,
): { line: number; side: "LEFT" | "RIGHT"; fallbackNote?: string } | null {
  if (index.right.has(line)) return { line, side: "RIGHT" };
  if (index.left.has(line)) return { line, side: "LEFT" };
  const hi = hunkForNewLine(file, line);
  if (hi < 0) return null;
  const near = nearestInHunk(file, hi, line);
  if (!near) return null;
  return {
    ...near,
    fallbackNote: `Note: line ${line} is outside the diff context; posting on the nearest commentable line ${near.line} in the same hunk.`,
  };
}

function resolveOldSideLine(
  file: ReviewFile,
  index: CommentableIndex,
  line: number,
): { line: number; side: "LEFT" | "RIGHT"; fallbackNote?: string } | null {
  if (index.left.has(line)) return { line, side: "LEFT" };
  if (index.right.has(line)) return { line, side: "RIGHT" };
  const hi = hunkForOldLine(file, line);
  if (hi < 0) return null;
  const near = nearestInHunk(file, hi, line);
  if (!near) return null;
  return {
    ...near,
    fallbackNote: `Note: line ${line} is outside the diff context; posting on the nearest commentable line ${near.line} in the same hunk.`,
  };
}

function locateDiffTarget(snapshot: ReviewSnapshot, target: string): SubmitCommentLocation | null {
  const parsed = parseId(target);
  if (!parsed || parsed.kind !== "diff") return null;
  const file = fileByKey(snapshot, parsed.fileKey);
  if (!file) return { kind: "general", reason: `unknown file ${parsed.fileKey}` };
  const path = file.path;
  const index = buildCommentable(file);
  const { start, end } = parsed;
  if (start === end) {
    const single =
      resolveNewSideLine(file, index, start) ?? resolveOldSideLine(file, index, start);
    if (!single) return { kind: "general", reason: `${path}:${start} is outside the diff` };
    return {
      kind: "inline",
      path,
      line: single.line,
      side: single.side,
      ...(single.fallbackNote ? { fallbackNote: single.fallbackNote } : {}),
    };
  }
  const first = resolveNewSideLine(file, index, start) ?? resolveOldSideLine(file, index, start);
  const last = resolveNewSideLine(file, index, end) ?? resolveOldSideLine(file, index, end);
  if (!first || !last) {
    return { kind: "general", reason: `${path}:${start}-${end} is outside the diff` };
  }
  const notes = [first.fallbackNote, last.fallbackNote].filter(Boolean);
  return {
    kind: "inline",
    path,
    line: last.line,
    side: last.side,
    startLine: first.line,
    startSide: first.side,
    ...(notes.length > 0 ? { fallbackNote: notes.join(" ") } : {}),
  };
}

function locateDiffLineThread(snapshot: ReviewSnapshot, thread: Annotation): SubmitCommentLocation {
  const host = thread.anchor.host;
  if (host.kind !== "diff-line") return { kind: "general" };
  const file = fileByKey(snapshot, host.fileKey);
  if (!file) return { kind: "general", reason: `unknown file ${host.fileKey}` };
  const path = file.path;
  const index = buildCommentable(file);
  const end = host.endLine ?? host.line;
  if (host.side === "LEFT") {
    if (end === host.line) {
      const at = resolveOldSideLine(file, index, host.line);
      if (!at) return { kind: "general", reason: `${path}:${host.line} is outside the diff` };
      return {
        kind: "inline",
        path,
        line: at.line,
        side: at.side,
        ...(at.fallbackNote ? { fallbackNote: at.fallbackNote } : {}),
      };
    }
    const first = resolveOldSideLine(file, index, host.line);
    const last = resolveOldSideLine(file, index, end);
    if (!first || !last) {
      return { kind: "general", reason: `${path}:${host.line}-${end} is outside the diff` };
    }
    const notes = [first.fallbackNote, last.fallbackNote].filter(Boolean);
    return {
      kind: "inline",
      path,
      line: last.line,
      side: last.side,
      startLine: first.line,
      startSide: first.side,
      ...(notes.length > 0 ? { fallbackNote: notes.join(" ") } : {}),
    };
  }
  if (end === host.line) {
    const at = resolveNewSideLine(file, index, host.line) ?? resolveOldSideLine(file, index, host.line);
    if (!at) return { kind: "general", reason: `${path}:${host.line} is outside the diff` };
    return {
      kind: "inline",
      path,
      line: at.line,
      side: at.side,
      ...(at.fallbackNote ? { fallbackNote: at.fallbackNote } : {}),
    };
  }
  const first =
    resolveNewSideLine(file, index, host.line) ?? resolveOldSideLine(file, index, host.line);
  const last = resolveNewSideLine(file, index, end) ?? resolveOldSideLine(file, index, end);
  if (!first || !last) {
    return { kind: "general", reason: `${path}:${host.line}-${end} is outside the diff` };
  }
  const notes = [first.fallbackNote, last.fallbackNote].filter(Boolean);
  return {
    kind: "inline",
    path,
    line: last.line,
    side: last.side,
    startLine: first.line,
    startSide: first.side,
    ...(notes.length > 0 ? { fallbackNote: notes.join(" ") } : {}),
  };
}

/**
 * Compute where one thread lands. Guide-block threads resolve through the
 * host block's first `diff:` citation; description threads and blocks
 * without a diff citation are general comments.
 */
export function locateThread(snapshot: ReviewSnapshot, thread: Annotation): SubmitCommentLocation {
  const host = thread.anchor.host;
  if (host.kind !== "diff-line") {
    if (host.kind === "block") {
      const citations = findBlockCitations(snapshot, host.blockId);
      const first = citations.find((t) => t.startsWith("diff:"));
      if (!first) return { kind: "general", reason: "guide comment without a diff citation" };
      return locateDiffTarget(snapshot, first) ?? { kind: "general", reason: "unresolvable diff citation" };
    }
    return { kind: "general", reason: "description comment" };
  }
  return locateDiffLineThread(snapshot, thread);
}

/** Locate one thread with its exact post text (fallback note prepended). */
export function locateThreadWithText(snapshot: ReviewSnapshot, thread: Annotation): LocatedComment {
  const location = locateThread(snapshot, thread);
  const base = threadPostText(thread);
  const text =
    location.kind === "inline" && location.fallbackNote ? `${location.fallbackNote}\n\n${base}` : base;
  return { thread, location, text };
}

/**
 * All threads marked For PR (`post`) that have not been posted yet, each
 * with its location + exact text. Posted threads (`postedAt`) are skipped
 * so retries never double-post.
 */
export function locatePendingThreads(snapshot: ReviewSnapshot): LocatedComment[] {
  return (snapshot.annotations ?? [])
    .filter((a) => a.type === "thread" && a.post && !a.postedAt)
    .map((t) => locateThreadWithText(snapshot, t as Annotation));
}

/** Threads already posted (skipped on retry). */
export function postedThreadIds(snapshot: ReviewSnapshot): string[] {
  return (snapshot.annotations ?? [])
    .filter((a) => a.type === "thread" && a.post && a.postedAt)
    .map((a) => a.id);
}
