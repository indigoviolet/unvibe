/**
 * Unit tests for expand-by-lines region math (issue #133, stage 1).
 */
import { describe, expect, it } from "vitest";
import type { Hunk, ReviewFile } from "@unvibe/shared";
import {
  collapseRangeAbove,
  collapseRangeBelow,
  expandRegions,
  hiddenIn,
  isRegionFull,
  mapNewToOld,
  maxLineDigits,
  mergeRanges,
  optimisticBottomRegion,
  partitionGap,
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

  it("offers one optimistic step below the last hunk while the total is unknown (#288)", () => {
    const f = file([hunk(77, 113, 77, 82), hunk(647, 654, 616, 622)]);
    expect(optimisticBottomRegion(f)).toEqual({ key: "bottom", start: 655, end: 674 });
    expect(optimisticBottomRegion(file([]))).toBeNull();
    const del = file([hunk(1, 0, 10, 20)], { isDeleted: true });
    expect(optimisticBottomRegion(del)).toEqual({ key: "bottom", start: 21, end: 40 });
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
    // Third step keeps going (issue #308: repeated expansion).
    const revealed2 = [
      { start: 114, end: 133 },
      { start: 134, end: 153 },
    ];
    expect(planExpandDown(113, region, revealed2)).toEqual({ start: 154, end: 173 });
    // Steps from both ends meet in the middle: each side stops where
    // the other side's lines begin.
    const bothEnds = [
      { start: 114, end: 133 },
      { start: 627, end: 646 },
    ];
    expect(planExpandDown(113, region, bothEnds)).toEqual({ start: 134, end: 153 });
    expect(planExpandUp(647, region, bothEnds)).toEqual({ start: 607, end: 626 });
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

describe("collapseRangeAbove/Below (issue #308)", () => {
  const gap = { key: "gap-0", start: 114, end: 646 };
  const top = { key: "top", start: 1, end: 76 };
  const bottom = { key: "bottom", start: 655, end: 760 };

  it("spans back to the hunk edge from the region edge", () => {
    // Nothing revealed yet: the windows still span the whole side.
    expect(collapseRangeAbove(top, 77, 77)).toEqual({ start: 1, end: 76 });
    expect(collapseRangeBelow(bottom, 654, 655)).toEqual({ start: 655, end: 760 });
  });

  it("stops a gap side at the partition split (the other side survives)", () => {
    // Upper hunk revealed the head [114..133] (split 134), lower the
    // tail [627..646] (split 627): collapsing the tail keeps the head.
    expect(collapseRangeAbove(gap, 647, 627)).toEqual({ start: 627, end: 646 });
    expect(collapseRangeBelow(gap, 113, 134)).toEqual({ start: 114, end: 133 });
  });

  it("covers the whole gap after show-all (collapsing reopens it)", () => {
    expect(collapseRangeAbove(gap, 647, 114)).toEqual({ start: 114, end: 646 });
    expect(collapseRangeBelow(gap, 113, 647)).toEqual({ start: 114, end: 646 });
  });

  it("returns null when the window is empty", () => {
    // Split past the hunk edge: nothing of this side revealed.
    expect(collapseRangeAbove(gap, 647, 647)).toBeNull();
    expect(collapseRangeBelow(gap, 113, 114)).toBeNull();
  });
});

describe("partitionGap", () => {
  const lines = (ns: number[]): { line: number }[] => ns.map((line) => ({ line }));
  const nums = (ls: { line: number }[]): number[] => ls.map((l) => l.line);

  it("reads the head under the earlier hunk and the tail atop the later one", () => {
    const { upper, lower } = partitionGap(lines([114, 115, 644, 645, 646]), 627);
    expect(nums(upper)).toEqual([114, 115]);
    expect(nums(lower)).toEqual([644, 645, 646]);
  });

  it("shows a fully revealed gap once: all upper or all lower", () => {
    const all = lines([10, 11, 12, 13]);
    expect(nums(partitionGap(all, 14).upper)).toEqual([10, 11, 12, 13]);
    expect(partitionGap(all, 14).lower).toEqual([]);
    expect(partitionGap(all, 10).upper).toEqual([]);
    expect(nums(partitionGap(all, 10).lower)).toEqual([10, 11, 12, 13]);
  });

  it("defaults past the end (everything reads under the earlier hunk)", () => {
    const region = { key: "gap-0", start: 114, end: 646 };
    const { upper, lower } = partitionGap(lines([114, 646]), region.end + 1);
    expect(nums(upper)).toEqual([114, 646]);
    expect(lower).toEqual([]);
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
