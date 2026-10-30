/**
 * Pure range/window planning for the file tab (#317).
 *
 * Highlighting a whole file at once would block the UI on large files,
 * so the tab tokenises in chunks: the chunk holding the cited range
 * first (it is what the reader is looking at), then the rest ordered by
 * distance to that focus. Every line is covered exactly once.
 */

export interface HighlightWindow {
  /** First line (1-based, inclusive). */
  start: number;
  /** Last line (1-based, inclusive). */
  end: number;
}

export const HIGHLIGHT_CHUNK_LINES = 200;

/** Clamp a cited range to the file; a past-the-end start lands on the last line. */
export function clampCitedRange(
  start: number | undefined,
  end: number | undefined,
  totalLines: number,
): { start: number; end: number } {
  if (totalLines <= 0) return { start: 1, end: 1 };
  const s = Math.min(Math.max(1, start ?? 1), totalLines);
  const e = Math.min(Math.max(s, end ?? s), totalLines);
  return { start: s, end: e };
}

/**
 * Partition `[1, totalLines]` into chunks of at most `chunkLines`,
 * ordered so the chunk containing `[focusStart, focusEnd]` comes first
 * and the rest follow by distance to the focus.
 */
export function planHighlightWindows(
  totalLines: number,
  focusStart: number,
  focusEnd: number,
  opts?: { chunkLines?: number },
): HighlightWindow[] {
  if (totalLines <= 0) return [];
  const chunk = Math.max(1, opts?.chunkLines ?? HIGHLIGHT_CHUNK_LINES);
  const windows: HighlightWindow[] = [];
  for (let s = 1; s <= totalLines; s += chunk) {
    windows.push({ start: s, end: Math.min(totalLines, s + chunk - 1) });
  }
  const dist = (w: HighlightWindow): number => {
    if (w.end < focusStart) return focusStart - w.end;
    if (w.start > focusEnd) return w.start - focusEnd;
    return 0;
  };
  return windows.sort((a, b) => dist(a) - dist(b) || a.start - b.start);
}
