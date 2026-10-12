/**
 * In-flight helpers (issue #46): fixed labels, rewrite detection, entry
 * keys, and busy resolution (entry first, live job next).
 */
import { describe, expect, test } from "vitest";
import type { Job } from "@unvibe/shared";
import {
  askKey,
  busyForCard,
  busyForThread,
  conceptKey,
  diffAnchorForExplainKey,
  explainKey,
  followupKey,
  inflightForAnchor,
  inflightForBlock,
  inflightLabel,
  isRewriteKind,
  jobLabel,
  liveJobForTarget,
  updateKey,
} from "./inflight.js";
import type { InFlightAction } from "../state/store.js";

function entry(kind: InFlightAction["kind"], targetId = "c1"): InFlightAction {
  return { kind, targetId, startedAt: 0 };
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
