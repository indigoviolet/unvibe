/**
 * Issue #364 follow-up (found by the 218 tour): margin icons less than
 * one icon apart share a bucket instead of stacking pixel-on-pixel.
 */
import { describe, expect, test } from "vitest";
import type { Thread } from "@unvibe/shared";
import { bucketsFor, marginLabel } from "./ThreadMarginOverlay.js";

function thread(id: string): Thread {
  return {
    id,
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "c#b1" },
      quotedText: "q",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    replies: [],
    open: false,
    pinned: false,
    post: false,
  };
}

describe("bucketsFor", () => {
  test("one icon per vertical bucket; close lines share, distant lines split", () => {
    const ts = [thread("a"), thread("b"), thread("c"), thread("d")];
    const tops = { a: 0, b: 10, c: 100, d: 115 };
    const buckets = bucketsFor(ts, tops);
    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(buckets[0]!.top).toBe(0);
    expect(buckets[1]!.threads.map((t) => t.id)).toEqual(["c", "d"]);
  });

  test("unmeasured threads are skipped, never stacked at the top", () => {
    const ts = [thread("a"), thread("ghost")];
    const buckets = bucketsFor(ts, { a: 40 });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.threads.map((t) => t.id)).toEqual(["a"]);
  });

  test("empty input renders nothing", () => {
    expect(bucketsFor([], {})).toEqual([]);
  });

  test("buckets partition the measured threads, so the pill counts add up (#374)", () => {
    const ts = [thread("a"), thread("b"), thread("c")];
    const buckets = bucketsFor(ts, { a: 0, b: 10, c: 100 });
    // One bucket per line group; the pill on each shows its own count.
    expect(buckets.map((b) => b.threads.length)).toEqual([2, 1]);
    expect(buckets.flatMap((b) => b.threads).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("marginLabel", () => {
  test("names the single computed thread count (#374)", () => {
    expect(marginLabel(1)).toBe("1 thread");
    expect(marginLabel(2)).toBe("2 threads");
    expect(marginLabel(12)).toBe("12 threads");
  });
});
