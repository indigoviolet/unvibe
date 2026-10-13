/**
 * Pure expand-by-lines logic (issue #133, stage 1).
 *
 * A file's hunks leave hidden regions: the top (before the first hunk),
 * one gap between each pair of hunks, and the bottom (after the last
 * hunk). Expanding reveals context lines inside those regions in small
 * steps (20 lines from the hunk outward) or, for a gap, all the way —
 * at which point the two hunks read as continuous.
 *
 * All line numbers here are the side being expanded: new-side lines at
 * the head commit, or old-side lines at the base commit for deleted
 * files (which have no new side). Old-side numbers for split/unified
 * rendering derive by offset: regions outside hunks are unchanged, so
 * each region's old and new counts match.
 */

import type { Hunk, ReviewFile } from "@unvibe/shared";

/** Lines revealed per step click. */
export const EXPAND_STEP = 20;

/** One hidden region between (or around) hunks, inclusive on both ends. */
export interface ExpandRegion {
  key: string;
  start: number;
  end: number;
}

/** One revealed line interval, inclusive on both ends. */
export interface RevealedRange {
  start: number;
  end: number;
}

function sideStart(h: Hunk, deleted: boolean): number {
  return deleted ? h.oldStart : h.newStart;
}

function sideEnd(h: Hunk, deleted: boolean): number {
  return deleted ? h.oldEnd : h.newEnd;
}

/**
 * Hidden regions of a file given its total line count on the expanded
 * side (`totalLines`, null when not yet known — then only gaps show).
 * Deleted files expand old-side numbers; every other file new-side.
 */
export function expandRegions(file: Pick<ReviewFile, "hunks" | "isDeleted">, totalLines: number | null): ExpandRegion[] {
  const out: ExpandRegion[] = [];
  const deleted = file.isDeleted === true;
  const hunks = file.hunks;
  if (hunks.length === 0) return out;
  const first = sideStart(hunks[0], deleted);
  if (first > 1) out.push({ key: "top", start: 1, end: first - 1 });
  for (let i = 0; i + 1 < hunks.length; i++) {
    const start = sideEnd(hunks[i], deleted) + 1;
    const end = sideStart(hunks[i + 1], deleted) - 1;
    if (start <= end) out.push({ key: `gap-${i}`, start, end });
  }
  if (totalLines !== null) {
    const last = sideEnd(hunks[hunks.length - 1], deleted);
    if (last < totalLines) out.push({ key: "bottom", start: last + 1, end: totalLines });
  }
  return out;
}

/** Merge overlapping/adjacent intervals, sorted. */
export function mergeRanges(ranges: RevealedRange[]): RevealedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: RevealedRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) {
      last.end = Math.max(last.end, r.end);
    } else {
      out.push({ start: r.start, end: r.end });
    }
  }
  return out;
}

/** Hidden parts of `region` given the revealed intervals. */
export function hiddenIn(region: ExpandRegion, revealed: RevealedRange[]): RevealedRange[] {
  const out: RevealedRange[] = [];
  let cursor = region.start;
  for (const r of mergeRanges(revealed)) {
    if (r.end < cursor) continue;
    if (r.start > region.end) break;
    if (r.start > cursor) out.push({ start: cursor, end: Math.min(r.start - 1, region.end) });
    cursor = Math.max(cursor, r.end + 1);
    if (cursor > region.end) break;
  }
  if (cursor <= region.end) out.push({ start: cursor, end: region.end });
  return out;
}

/** Lines of `region` already revealed. */
export function revealedIn(region: ExpandRegion, revealed: RevealedRange[]): RevealedRange[] {
  const out: RevealedRange[] = [];
  for (const r of mergeRanges(revealed)) {
    const start = Math.max(r.start, region.start);
    const end = Math.min(r.end, region.end);
    if (start <= end) out.push({ start, end });
  }
  return out;
}

/** True when every line of `region` is revealed. */
export function isRegionFull(region: ExpandRegion, revealed: RevealedRange[]): boolean {
  return hiddenIn(region, revealed).length === 0;
}

/**
 * Up-to-`step` hidden lines immediately above `line` (a hunk edge)
 * inside `region`: the next step click's fetch range, or null when
 * nothing above is hidden.
 */
export function planExpandUp(
  line: number,
  region: ExpandRegion,
  revealed: RevealedRange[],
  step: number = EXPAND_STEP,
): RevealedRange | null {
  const hidden = hiddenIn(region, revealed).filter((r) => r.start < line);
  if (hidden.length === 0) return null;
  const last = hidden[hidden.length - 1];
  const end = Math.min(last.end, line - 1);
  const start = Math.max(last.start, end - step + 1);
  return { start, end };
}

/**
 * Up-to-`step` hidden lines immediately below `line` (a hunk edge)
 * inside `region`, or null when nothing below is hidden.
 */
export function planExpandDown(
  line: number,
  region: ExpandRegion,
  revealed: RevealedRange[],
  step: number = EXPAND_STEP,
): RevealedRange | null {
  const hidden = hiddenIn(region, revealed).filter((r) => r.end > line);
  if (hidden.length === 0) return null;
  const first = hidden[0];
  const start = Math.max(first.start, line + 1);
  const end = Math.min(first.end, start + step - 1);
  return { start, end };
}

/**
 * Every hidden part of `region` in ≤`cap`-line chunks (the route's
 * per-request limit): the "show all" fetch plan.
 */
export function planExpandAll(region: ExpandRegion, revealed: RevealedRange[], cap: number): RevealedRange[] {
  const out: RevealedRange[] = [];
  for (const h of hiddenIn(region, revealed)) {
    for (let s = h.start; s <= h.end; s += cap) {
      out.push({ start: s, end: Math.min(s + cap - 1, h.end) });
    }
  }
  return out;
}

/**
 * Old-side line for a revealed new-side line. Regions outside hunks are
 * unchanged, so each region maps by offset. Null for new files (no old
 * side) and for lines inside hunks (never revealed).
 */

export function mapNewToOld(file: Pick<ReviewFile, "hunks" | "isNew">, newLine: number): number | null {
  if (file.isNew === true) return null;
  const hunks = file.hunks;
  if (hunks.length === 0) return null;
  if (newLine < hunks[0].newStart) return newLine - hunks[0].newStart + hunks[0].oldStart;
  for (let i = 0; i + 1 < hunks.length; i++) {
    if (newLine > hunks[i].newEnd && newLine < hunks[i + 1].newStart) {
      return newLine - hunks[i].newEnd + hunks[i].oldEnd;
    }
  }
  const last = hunks[hunks.length - 1];
  if (newLine > last.newEnd) return newLine - last.newEnd + last.oldEnd;
  return null;
}

/**
 * Digit width of revealed line numbers, for the shared `--lnw` number
 * column (#140): a revealed range can carry more digits than the hunks
 * (a 4-digit file with 3-digit hunks), so revealed lines widen it too.
 */
export function maxLineDigits(lines: { newLine: number | null; oldLine: number | null }[]): number {
  let max = 1;
  for (const l of lines) {
    max = Math.max(max, String(l.newLine ?? l.oldLine ?? 0).length);
  }
  return max;
}
