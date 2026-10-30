/** Window planning for file-tab highlighting (#317): cited range first. */
import { describe, expect, it } from "vitest";
import { clampCitedRange, planHighlightWindows } from "./highlightWindow.js";

describe("clampCitedRange", () => {
  it("clamps a past-the-end range to the file", () => {
    expect(clampCitedRange(2, 99, 3)).toEqual({ start: 2, end: 3 });
    expect(clampCitedRange(99, 120, 3)).toEqual({ start: 3, end: 3 });
  });
  it("keeps an in-range citation and defaults a missing start", () => {
    expect(clampCitedRange(5, 7, 100)).toEqual({ start: 5, end: 7 });
    expect(clampCitedRange(undefined, undefined, 100)).toEqual({ start: 1, end: 1 });
  });
});

describe("planHighlightWindows", () => {
  it("covers the whole file exactly once, in chunks", () => {
    const ws = planHighlightWindows(450, 10, 12, { chunkLines: 200 });
    const covered = ws.flatMap((w) => Array.from({ length: w.end - w.start + 1 }, (_, i) => w.start + i));
    expect([...covered].sort((a, b) => a - b)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
    expect(new Set(covered).size).toBe(450);
    for (const w of ws) expect(w.end - w.start + 1).toBeLessThanOrEqual(200);
  });

  it("puts the window containing the cited range first", () => {
    const ws = planHighlightWindows(3000, 2500, 2502, { chunkLines: 200 });
    expect(ws[0].start).toBeLessThanOrEqual(2500);
    expect(ws[0].end).toBeGreaterThanOrEqual(2502);
    // Nearest windows follow: the rest is ordered by distance to the focus.
    const dist = (w: { start: number; end: number }): number =>
      w.end < 2500 ? 2500 - w.end : w.start > 2502 ? w.start - 2502 : 0;
    const ds = ws.map(dist);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it("handles a focus in the first chunk and an empty file", () => {
    expect(planHighlightWindows(50, 5, 5, { chunkLines: 200 })).toEqual([{ start: 1, end: 50 }]);
    expect(planHighlightWindows(0, 1, 1)).toEqual([]);
  });
});
