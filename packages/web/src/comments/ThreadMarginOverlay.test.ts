/**
 * Issue #364 follow-up (found by the 218 tour): margin icons less than
 * one icon apart share a bucket instead of stacking pixel-on-pixel.
 */
import { describe, expect, test } from "vitest";
import type { Thread } from "@unvibe/shared";
import { bucketKeyFor, bucketsFor, marginLabel } from "./ThreadMarginOverlay.js";

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
  test("one pill per block: same-line and distant lines in one block share (#374)", () => {
    const ts = [thread("a"), thread("b")];
    const buckets = bucketsFor(ts, { a: 0, b: 100 });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.threads.map((t) => t.id)).toEqual(["a", "b"]);
    // Aligned to the block's first highlighted line.
    expect(buckets[0]!.top).toBe(0);
  });

  test("singleBucket merges every block into one card pill", () => {
    const other = (id: string): Thread => ({ ...thread(id), anchor: { ...thread(id).anchor, host: { kind: "block", blockId: "c#other" } } });
    const buckets = bucketsFor([thread("a"), other("b")], { a: 0, b: 50 }, true);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(buckets[0]!.top).toBe(0);
  });

  test("threads on different blocks get their own pills", () => {
    const other = (id: string): Thread => ({ ...thread(id), anchor: { ...thread(id).anchor, host: { kind: "block", blockId: "c#other" } } });
    const buckets = bucketsFor([thread("a"), other("b")], { a: 0, b: 0 });
    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.threads.map((t) => t.id))).toEqual([["a"], ["b"]]);
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
    // One bucket for the whole block; the pill shows its full count.
    expect(buckets.map((b) => b.threads.length)).toEqual([3]);
    expect(buckets.flatMap((b) => b.threads).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("bucketKeyFor", () => {
  test("card#block and bare block ids share a block; description paragraphs stand alone", () => {
    const bare: Thread = { ...thread("x"), anchor: { ...thread("x").anchor, host: { kind: "block", blockId: "b1" } } };
    expect(bucketKeyFor(bare)).toBe(bucketKeyFor(thread("a")));
    const desc: Thread = { ...thread("y"), anchor: { ...thread("y").anchor, host: { kind: "description", paragraphId: "d-1" } } };
    expect(bucketKeyFor(desc)).toBe("desc:d-1");
  });
});

describe("marginLabel", () => {
  test("names the single computed thread count (#374)", () => {
    expect(marginLabel(1)).toBe("1 thread");
    expect(marginLabel(2)).toBe("2 threads");
    expect(marginLabel(12)).toBe("12 threads");
  });
});
