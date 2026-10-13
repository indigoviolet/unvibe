/**
 * Unit tests for expand-by-lines region math (issue #133, stage 1).
 */
import { describe, expect, it } from "vitest";
import type { Hunk, ReviewFile } from "@unvibe/shared";
import {
  expandRegions,
  hiddenIn,
  isRegionFull,
  mapNewToOld,
  maxLineDigits,
  mergeRanges,
  planExpandAll,
  planExpandDown,
  planExpandUp,
} from "./expandLines.js";

function hunk(newStart: number, newEnd: number, oldStart: number, oldEnd: number): Hunk {
  return {
    contentHash: `h${newStart}`,
    header: "@@",
    newStart,
    newEnd,
    oldStart,
    oldEnd,
    added: 1,
    removed: 1,
    lines: [],
  };
}

function file(hunks: Hunk[], extra?: Partial<ReviewFile>): ReviewFile {
  return { fileKey: "f", path: "f.py", category: "source", hunks, ...extra };
}

describe("expandRegions", () => {
  it("finds the top, gaps and bottom", () => {
    const f = file([hunk(77, 113, 77, 82), hunk(647, 654, 616, 622)]);
    expect(expandRegions(f, 760)).toEqual([
      { key: "top", start: 1, end: 76 },
      { key: "gap-0", start: 114, end: 646 },
      { key: "bottom", start: 655, end: 760 },
    ]);
  });

  it("omits the bottom while the total is unknown and skips empty gaps", () => {
    const f = file([hunk(1, 5, 1, 5), hunk(6, 10, 6, 10)]);
    expect(expandRegions(f, null)).toEqual([]);
    expect(expandRegions(f, 10)).toEqual([]);
  });

  it("expands old-side numbers for deleted files", () => {
    const f = file([hunk(1, 0, 10, 20)], { isDeleted: true });
    expect(expandRegions(f, 30)).toEqual([
      { key: "top", start: 1, end: 9 },
      { key: "bottom", start: 21, end: 30 },
    ]);
  });
});

describe("hidden/revealed math", () => {
  const region = { key: "gap-0", start: 114, end: 646 };

  it("merges adjacent intervals", () => {
    expect(
      mergeRanges([
        { start: 120, end: 130 },
        { start: 114, end: 119 },
        { start: 200, end: 210 },
      ]),
    ).toEqual([
      { start: 114, end: 130 },
      { start: 200, end: 210 },
    ]);
  });

  it("plans steps outward from the hunk edge", () => {
    // Below hunk 0 (ends at 113): first step takes the gap's head.
    expect(planExpandDown(113, region, [])).toEqual({ start: 114, end: 133 });
    // Above hunk 1 (starts at 647): first step takes the gap's tail.
    expect(planExpandUp(647, region, [])).toEqual({ start: 627, end: 646 });
    // Second step continues outward.
    const revealed = [{ start: 114, end: 133 }];
    expect(planExpandDown(113, region, revealed)).toEqual({ start: 134, end: 153 });
    // Nothing left: null.
    const full = [{ start: 114, end: 646 }];
    expect(planExpandDown(113, region, full)).toBeNull();
    expect(planExpandUp(647, region, full)).toBeNull();
    expect(isRegionFull(region, full)).toBe(true);
    expect(isRegionFull(region, revealed)).toBe(false);
  });

  it("chunks show-all fetches by the route cap", () => {
    expect(planExpandAll(region, [], 200)).toEqual([
      { start: 114, end: 313 },
      { start: 314, end: 513 },
      { start: 514, end: 646 },
    ]);
    expect(planExpandAll(region, [{ start: 114, end: 313 }], 200)).toEqual([
      { start: 314, end: 513 },
      { start: 514, end: 646 },
    ]);
  });

  it("hides nothing outside the region", () => {
    expect(hiddenIn(region, [{ start: 1, end: 1000 }])).toEqual([]);
  });
});

describe("mapNewToOld", () => {

  const f = file([hunk(77, 113, 77, 82), hunk(647, 654, 616, 622)]);
  it("maps by offset per region", () => {
    expect(mapNewToOld(f, 76)).toBe(76);
    expect(mapNewToOld(f, 114)).toBe(83);
    expect(mapNewToOld(f, 646)).toBe(615);
    expect(mapNewToOld(f, 655)).toBe(623);
  });
  it("returns null inside hunks and for new files", () => {
    expect(mapNewToOld(f, 80)).toBeNull();
    expect(mapNewToOld(file([hunk(1, 3, 0, 0)], { isNew: true }), 5)).toBeNull();
  });
});

describe("maxLineDigits", () => {
  it("widens past the hunks when revealed lines carry more digits", () => {
    expect(maxLineDigits([])).toBe(1);
    expect(
      maxLineDigits([
        { oldLine: 76, newLine: 76 },
        { oldLine: 615, newLine: 646 },
      ]),
    ).toBe(3);
    expect(maxLineDigits([{ oldLine: 1170, newLine: 1200 }])).toBe(4);
    expect(maxLineDigits([{ oldLine: 12, newLine: null }])).toBe(2);
  });
});
