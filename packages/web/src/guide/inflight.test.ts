/**
 * In-flight helpers (issue #46): fixed labels, rewrite detection, entry
 * keys, and busy resolution (entry first, live job next).
 */
import { describe, expect, test } from "vitest";
import type { Job } from "@unvibe/shared";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import {
  anchorBlockType,
  askKey,
  busyForCard,
  busyForExpansion,
  busyForThread,
  conceptKey,
  diffAnchorForExplainKey,
  explainKey,
  followupEntryForAnchorBlock,
  followupKey,
  inflightForAnchor,
  inflightForBlock,
  inflightLabel,
  isFollowupAnswer,
  isRewriteKind,
  jobLabel,
  liveJobForTarget,
  updateKey,
} from "./inflight.js";
import type { InFlightAction } from "../state/store.js";

function entry(kind: InFlightAction["kind"], targetId = "c1"): InFlightAction {
  return { kind, targetId, startedAt: 0, seq: 1 };
}

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    kind: "depth",
    provider: "claude",
    model: "mock",
    reviewId: "r",
    priority: 100,
    state: "running",
    ...over,
  } as Job;
}

describe("inflight labels", () => {
  test("every kind has a short fixed plain label", () => {
    for (const kind of [
      "depth",
      "examples",
      "diagram",
      "generate",
      "followup",
      "explain",
      "ask",
      "reply",
      "retry",
      "second_opinion",
      "concept",
      "update",
    ] as const) {
      const label = inflightLabel(kind);
      expect(label.length).toBeGreaterThan(0);
      expect(label.length).toBeLessThan(40);
    }
    expect(inflightLabel("depth")).toBe("Rewriting…");
    expect(inflightLabel("examples")).toBe("Adding examples…");
    expect(inflightLabel("diagram")).toBe("Drawing diagram…");
    expect(inflightLabel("second_opinion")).toBe("Getting a second opinion…");
  });

  test("job kinds map to the same labels, unknown kinds to Working…", () => {
    expect(jobLabel("depth")).toBe("Rewriting…");
    expect(jobLabel("go-deeper")).toBe("Writing…");
    expect(jobLabel("second-opinion")).toBe("Getting a second opinion…");
    expect(jobLabel("update-pass")).toBe("Updating…");
    expect(jobLabel("reader")).toBe("Working…");
    expect(jobLabel("hunk-pass")).toBe("Working…");
  });

  test("depth/examples/diagram rewrite; everything else is new content", () => {
    expect(isRewriteKind("depth")).toBe(true);
    expect(isRewriteKind("examples")).toBe(true);
    expect(isRewriteKind("diagram")).toBe(true);
    expect(isRewriteKind("generate")).toBe(false);
    expect(isRewriteKind("explain")).toBe(false);
    expect(isRewriteKind("go-deeper")).toBe(false);
  });
});

describe("busy resolution", () => {
  test("no entry and no job means not busy", () => {
    expect(busyForCard({}, [], "c1")).toBeNull();
    expect(busyForThread({}, [], "t1")).toBeNull();
  });

  test("the in-flight entry wins over the job", () => {
    const busy = busyForCard({ c1: entry("examples") }, [job({ cardId: "c1", state: "done" })], "c1");
    expect(busy).toMatchObject({ label: "Adding examples…", rewriting: true });
  });

  test("a live job is busy with its own label when no entry exists", () => {
    const busy = busyForCard({}, [job({ cardId: "c1", kind: "go-deeper" })], "c1");
    expect(busy).toMatchObject({ label: "Writing…", rewriting: false });
    expect(busyForCard({}, [job({ cardId: "c9", kind: "go-deeper" })], "c1")).toBeNull();
  });

  test("queued and backing-off count as live; done does not", () => {
    expect(liveJobForTarget([job({ cardId: "c1", state: "queued" })], "c1")?.id).toBe("job-1");
    expect(liveJobForTarget([job({ cardId: "c1", state: "backing-off" })], "c1")?.id).toBe("job-1");
    expect(liveJobForTarget([job({ cardId: "c1", state: "done" })], "c1")).toBeUndefined();
    expect(liveJobForTarget([job({ cardId: "c1", state: "cancelled" })], "c1")).toBeUndefined();
  });

  test("jobs match by card or thread id", () => {
    expect(liveJobForTarget([job({ threadId: "t1" })], "t1")?.id).toBe("job-1");
    expect(busyForThread({}, [job({ threadId: "t1", kind: "ask" })], "t1")).toMatchObject({
      label: "Asking…",
      rewriting: false,
    });
  });
});

describe("entry keys", () => {
  test("anchors key explains and asks distinctly", () => {
    const anchor = { where: "block", blockId: "b1" } as const;
    expect(explainKey(anchor)).not.toBe(askKey(anchor));
    const inflight = { [explainKey(anchor)]: entry("explain") };
    expect(inflightForAnchor(inflight, anchor)?.kind).toBe("explain");
    expect(inflightForAnchor({}, anchor)).toBeUndefined();
  });

  test("blocks match bare and card-qualified spellings", () => {
    const bare = { [explainKey({ where: "block", blockId: "b1" })]: entry("explain") };
    expect(inflightForBlock(bare, "c1", "b1")?.kind).toBe("explain");
    const qualified = {
      [explainKey({ where: "block", blockId: "c1#b1" })]: entry("explain"),
    };
    expect(inflightForBlock(qualified, "c1", "b1")?.kind).toBe("explain");
    expect(inflightForBlock({}, "c1", "b1")).toBeUndefined();
  });

  test("follow-up, concept and update keys", () => {
    expect(followupKey("c1", "b1", 0)).toBe("followup:c1:b1:0");
    expect(followupKey("c1", "b1", 0)).not.toBe(followupKey("c1", "b1", 1));
    expect(conceptKey("obs-fold")).toBe("concept:obs-fold");
    expect(updateKey("demo")).toBe("update:demo");
  });

  test("follow-up entries match by anchor block, bare or qualified", () => {
    const inflight = { "followup:c1:b-f:0": entry("followup", "followup:c1:b-f:0") };
    expect(followupEntryForAnchorBlock(inflight, "b-f")?.kind).toBe("followup");
    expect(followupEntryForAnchorBlock(inflight, "c1#b-f")?.kind).toBe("followup");
    expect(followupEntryForAnchorBlock(inflight, "b-other")).toBeUndefined();
    expect(followupEntryForAnchorBlock({}, "b-f")).toBeUndefined();
    // Other kinds never match, even on the same block.
    const wrong = { "explain:block:b-f": entry("explain", "explain:block:b-f") };
    expect(followupEntryForAnchorBlock(wrong, "b-f")).toBeUndefined();
  });

  test("answer expansions are detected by their anchor block", () => {
    const answer = {
      id: "ann_ans",
      type: "expansion",
      anchor: { host: { kind: "block", blockId: "b-f" }, quotedText: "Why?" },
    } as unknown as Annotation;
    const snap = {
      pages: [
        {
          cards: [
            { id: "c1", blocks: [{ id: "b-f", type: "follow-up" }] },
          ],
        },
      ],
      annotations: [],
    } as unknown as ReviewSnapshot;
    expect(isFollowupAnswer(snap, answer)).toBe(true);
    expect(anchorBlockType(snap, "c1#b-f")).toBe("follow-up");
    const plain = { ...answer, anchor: { host: { kind: "block", blockId: "b-p" } } } as unknown as Annotation;
    expect(isFollowupAnswer(snap, plain)).toBe(false);
    const thread = { ...answer, type: "thread" } as unknown as Annotation;
    expect(isFollowupAnswer(snap, thread)).toBe(false);
  });

  test("busyForExpansion prefers the anchor entry and labels answers", () => {
    const answer = {
      id: "ann_ans",
      type: "expansion",
      anchor: { host: { kind: "block", blockId: "b-f" }, quotedText: "Why?" },
    } as unknown as Annotation;
    const snap = {
      pages: [{ cards: [{ id: "c1", blocks: [{ id: "b-f", type: "follow-up" }] }] }],
      annotations: [],
    } as unknown as ReviewSnapshot;
    // Chip key still set (answer rendered before the response retargets).
    const chip = { "followup:c1:b-f:0": entry("followup", "followup:c1:b-f:0") };
    expect(busyForExpansion(chip, [], snap, answer)).toMatchObject({ label: "Writing answer…" });
    // Direct entry wins with its own label.
    const direct = { ann_ans: entry("retry", "ann_ans") };
    expect(busyForExpansion(direct, [], snap, answer)).toMatchObject({ label: "Retrying…" });
    // Job-derived ask fill on an answer reads as its answer…
    const jobs = [job({ kind: "ask", threadId: "ann_ans" })];
    expect(busyForExpansion({}, jobs, snap, answer)).toMatchObject({ label: "Writing answer…" });
    // …but not on ordinary expansions.
    const plain = { ...answer, anchor: { host: { kind: "block", blockId: "b-p" } } } as unknown as Annotation;
    expect(busyForExpansion({}, jobs, snap, plain)).toMatchObject({ label: "Asking…" });
    expect(busyForExpansion({}, [], snap, plain)).toBeNull();
  });

  test("diff anchors parse back out of explain keys", () => {
    expect(diffAnchorForExplainKey("explain:diff:src-conn.py:80")).toEqual({
      fileKey: "src-conn.py",
      line: 80,
    });
    // File keys containing colons still parse (line is the numeric suffix).
    expect(diffAnchorForExplainKey("explain:diff:a:b.py:12")).toEqual({ fileKey: "a:b.py", line: 12 });
    expect(diffAnchorForExplainKey("ask:diff:src-conn.py:80")).toBeNull();
    expect(diffAnchorForExplainKey("explain:block:b1")).toBeNull();
    expect(diffAnchorForExplainKey("explain:diff:no-line")).toBeNull();
  });
});
