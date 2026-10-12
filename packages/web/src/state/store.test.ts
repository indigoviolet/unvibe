/**
 * WS patch ordering against the live pipeline (the `comments-service`
 * flake): when a review is created the pipeline streams dozens of
 * `ReviewStore.mutate` patches in the first seconds. A comment created in
 * that window must still appear, and a slow snapshot fetch must never
 * clobber newer WS state or wedge the client at an old rev.
 *
 * Each test below fails on the pre-fix store (stale `setSnapshot` reverted
 * state; `baseRev` mismatches were dropped with no resync, so everything
 * after the gap — including the just-created thread — never applied).
 */
import { beforeEach, describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import { applyOp, useReview } from "./store.js";

function thread(id: string, text: string): Annotation {
  return {
    id,
    type: "thread",
    anchor: {
      host: { kind: "diff-line", fileKey: "src-app.py", line: 2 },
      quotedText: "return 2",
      prefix: "",
      suffix: "",
      position: 2,
      version: 1,
    },
    open: true,
    messages: [{ who: "you", text }],
    post: false,
    note: false,
  } as unknown as Annotation;
}

function snap(rev: number, annotations: Annotation[] = []): ReviewSnapshot {
  return {
    review: { id: "rv_race", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations,
    hunkStates: [],
    jobs: [],
    contributions: [],
    logTail: [],
    rev,
  } as unknown as ReviewSnapshot;
}

beforeEach(() => {
  useReview.getState().clear();
});

describe("review store patch ordering", () => {
  test("a stale snapshot fetch never clobbers newer WS state", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5));
    // Two pipeline patches stream in.
    api.applyEvent({
      type: "patch",
      baseRev: 5,
      headRev: 6,
      ops: [{ op: "add", path: "/annotations/0", value: thread("ann_a", "Why 2 and not 3?") }],
    });
    api.applyEvent({
      type: "patch",
      baseRev: 6,
      headRev: 7,
      ops: [{ op: "replace", path: "/jobs", value: [] }],
    });
    expect(useReview.getState().snapshot?.rev).toBe(7);
    // A slow fetch started before the patches resolves with rev 5.
    useReview.getState().setSnapshot(snap(5));
    const after = useReview.getState().snapshot!;
    expect(after.rev).toBe(7);
    expect(after.annotations.map((a) => a.id)).toEqual(["ann_a"]);
  });

  test("a missed patch queues a resync instead of wedging the client", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(10));
    // Patch 10->11 never arrives (pre-snapshot drop / socket gap); 11->12 does.
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 11,
      headRev: 12,
      ops: [{ op: "add", path: "/annotations/0", value: thread("ann_b", "pipeline note") }],
    });
    // Still at rev 10, but a resync was requested — not a silent drop.
    expect(useReview.getState().snapshot?.rev).toBe(10);
    expect(useReview.getState().pending).toHaveLength(1);
    expect(useReview.getState().resyncSeq).toBe(1);
    // The resync fetch returns the confirmed server snapshot (rev 12 with
    // both the missed and the queued change); the queue drains into it.
    const t = thread("ann_b", "pipeline note");
    useReview.getState().setSnapshot(snap(12, [t]));
    const after = useReview.getState().snapshot!;
    expect(after.rev).toBe(12);
    expect(after.annotations.map((a) => a.id)).toEqual(["ann_b"]);
    expect(useReview.getState().pending).toHaveLength(0);
  });

  test("a comment patch that arrives before its pipeline predecessor still applies", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(20));
    const comment = thread("ann_c", "Why 2 and not 3?");
    // Comment mutation committed as 21->22; its WS patch arrives first.
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 21,
      headRev: 22,
      ops: [{ op: "add", path: "/annotations/0", value: comment }],
    });
    expect(useReview.getState().snapshot?.rev).toBe(20);
    // The pipeline's 20->21 patch arrives next: it applies, then the queued
    // comment patch drains. The thread is visible — the e2e's exact failure.
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 20,
      headRev: 21,
      ops: [{ op: "replace", path: "/jobs", value: [] }],
    });
    const after = useReview.getState().snapshot!;
    expect(after.rev).toBe(22);
    expect(after.annotations.map((a) => a.id)).toEqual(["ann_c"]);
    expect(useReview.getState().pending).toHaveLength(0);
  });

  test("patches received before the first snapshot queue until the fetch lands", () => {
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 1,
      headRev: 2,
      ops: [{ op: "add", path: "/annotations/0", value: thread("ann_d", "early") }],
    });
    expect(useReview.getState().snapshot).toBeNull();
    expect(useReview.getState().pending).toHaveLength(1);
    useReview.getState().setSnapshot(snap(1));
    const after = useReview.getState().snapshot!;
    expect(after.rev).toBe(2);
    expect(after.annotations.map((a) => a.id)).toEqual(["ann_d"]);
  });

  test("stale duplicate patches are dropped without a resync", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(7, [thread("ann_a", "Why 2 and not 3?")]));
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 5,
      headRev: 6,
      ops: [{ op: "replace", path: "/jobs", value: [] }],
    });
    expect(useReview.getState().snapshot?.rev).toBe(7);
    expect(useReview.getState().pending).toHaveLength(0);
    expect(useReview.getState().resyncSeq).toBe(0);
  });
});

describe("switching reviews", () => {
  test("another review's snapshot replaces the stored one even at a lower rev", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(40));
    const other = { ...snap(3), review: { ...snap(3).review, id: "rv_other" } } as ReviewSnapshot;
    api.setSnapshot(other);
    expect(useReview.getState().snapshot?.review.id).toBe("rv_other");
    expect(useReview.getState().snapshot?.rev).toBe(3);

    // Same through the WS snapshot event.
    api.applyEvent({ type: "snapshot", snapshot: snap(1) });
    expect(useReview.getState().snapshot?.review.id).toBe("rv_race");
  });
});

describe("applyOp", () => {
  test("array ops throw out of bounds instead of corrupting state", () => {
    const root = { annotations: [thread("ann_a", "x")] };
    expect(() =>
      applyOp(root, { op: "replace", path: "/annotations/5", value: thread("ann_b", "y") }),
    ).toThrow(/out of bounds/);
    expect(() => applyOp(root, { op: "remove", path: "/annotations/3" })).toThrow(/out of bounds/);
    expect(() => applyOp(root, { op: "add", path: "/annotations/9", value: 1 })).toThrow(
      /out of bounds/,
    );
    // The root is untouched (clone-on-write only clones on success paths).
    expect((root.annotations as unknown[]).length).toBe(1);
  });

  test("valid ops still apply", () => {
    const root = { annotations: [thread("ann_a", "x")] };
    const next = applyOp(root, {
      op: "add",
      path: "/annotations/1",
      value: thread("ann_b", "y"),
    }) as { annotations: Annotation[] };
    expect(next.annotations.map((a) => a.id)).toEqual(["ann_a", "ann_b"]);
  });
});
