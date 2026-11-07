/**
 * Issue #364 follow-up (found by the 218 tour): margin icons less than
 * one icon apart share a bucket instead of stacking pixel-on-pixel.
 */
import { describe, expect, test } from "vitest";
import type { Thread } from "@unvibe/shared";
import { bucketsFor } from "./ThreadMarginOverlay.js";

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
});
