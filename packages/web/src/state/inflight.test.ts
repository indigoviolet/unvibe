/**
 * In-flight action state (issue #46): set on click, handed over to the
 * snapshot job, and cleared on settle — never stuck, never wiped by a
 * resync while still in flight.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Job, ReviewSnapshot } from "@unvibe/shared";
import { INFLIGHT_TTL_MS, inflightExpired, useReview } from "./store.js";

function job(over: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    kind: "depth",
    provider: "claude",
    model: "mock",
    reviewId: "rv_inflight",
    priority: 100,
    state: "running",
    cardId: "c1",
    ...over,
  } as Job;
}

function snap(rev: number, jobs: Job[] = []): ReviewSnapshot {
  return {
    review: { id: "rv_inflight", repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
    version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
    files: [],
    pages: [],
    annotations: [],
    hunkStates: [],
    jobs,
    contributions: [],
    logTail: [],
    rev,
  } as unknown as ReviewSnapshot;
}

beforeEach(() => {
  vi.useRealTimers();
  useReview.getState().clear();
});

describe("in-flight action lifecycle", () => {
  test("begin sets the entry synchronously", () => {
    useReview.getState().beginInflight("c1", "depth");
    const entry = useReview.getState().inflight["c1"];
    expect(entry).toMatchObject({ kind: "depth", targetId: "c1" });
    expect(entry?.jobId).toBeUndefined();
  });

  test("the entry survives a snapshot resync while still in flight", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5));
    api.beginInflight("c1", "depth");
    // A newer confirmed snapshot with no jobs yet: the action is still
    // waiting for its job to appear, so the entry stays.
    useReview.getState().setSnapshot(snap(6));
    expect(useReview.getState().inflight["c1"]).toBeDefined();
    expect(useReview.getState().snapshot?.rev).toBe(6);
  });

  test("attaching a job hands over without clearing while it runs", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5));
    api.beginInflight("c1", "depth");
    api.attachInflightJob("c1", "job-1");
    // The request returned before the job reached the snapshot: unknown
    // job ids never clear the entry.
    useReview.getState().setSnapshot(snap(6));
    expect(useReview.getState().inflight["c1"]?.jobId).toBe("job-1");
    // The job shows up running: still in flight, no flicker.
    useReview.getState().setSnapshot(snap(7, [job()]));
    expect(useReview.getState().inflight["c1"]).toBeDefined();
    // Queued and backing-off are live too.
    useReview.getState().setSnapshot(snap(8, [job({ state: "backing-off" })]));
    expect(useReview.getState().inflight["c1"]).toBeDefined();
  });

  test.each(["done", "error", "cancelled"] as const)(
    "a %s job clears the entry on the next snapshot",
    (state) => {
      const api = useReview.getState();
      api.setSnapshot(snap(5, [job()]));
      api.beginInflight("c1", "depth");
      api.attachInflightJob("c1", "job-1");
      useReview.getState().setSnapshot(snap(6, [job({ state })]));
      expect(useReview.getState().inflight["c1"]).toBeUndefined();
    },
  );

  test("a terminal job clears the entry through patch and job events", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5, [job()]));
    api.beginInflight("c1", "depth");
    api.attachInflightJob("c1", "job-1");
    const done = job({ state: "done" });
    useReview.getState().applyEvent({ type: "job", job: done });
    expect(useReview.getState().inflight["c1"]).toBeUndefined();

    useReview.getState().beginInflight("c2", "generate");
    useReview.getState().attachInflightJob("c2", "job-1");
    useReview.getState().applyEvent({
      type: "patch",
      baseRev: 5,
      headRev: 6,
      ops: [{ op: "replace", path: "/jobs", value: [done] }],
    });
    expect(useReview.getState().inflight["c2"]).toBeUndefined();
  });

  test("job events upsert jobs created after the snapshot was fetched", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5));
    api.beginInflight("c1", "depth");
    api.attachInflightJob("c1", "job-1");
    // The service's job events are the only channel carrying the new job:
    // the client must adopt it, not drop it, or the entry sticks.
    useReview.getState().applyEvent({ type: "job", job: job({ state: "running" }) });
    expect(useReview.getState().snapshot?.jobs.map((j) => j.id)).toEqual(["job-1"]);
    expect(useReview.getState().inflight["c1"]).toBeDefined();
    useReview.getState().applyEvent({ type: "job", job: job({ state: "done" }) });
    expect(useReview.getState().inflight["c1"]).toBeUndefined();
  });

  test("attaching to an already-settled job clears immediately", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(5, [job({ state: "done" })]));
    api.beginInflight("c1", "depth");
    // The fill finished before the response was processed: no waiting.
    api.attachInflightJob("c1", "job-1");
    expect(useReview.getState().inflight["c1"]).toBeUndefined();
  });

  test("begins assign distinct generations for stale-response guards", () => {
    const api = useReview.getState();
    api.beginInflight("c1", "depth");
    const first = useReview.getState().inflight["c1"]?.seq;
    api.beginInflight("c1", "depth");
    const second = useReview.getState().inflight["c1"]?.seq;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  test("retarget moves an anchor entry to its server id", () => {
    const api = useReview.getState();
    api.beginInflight("explain:block:b1", "explain");
    api.retargetInflight("explain:block:b1", "ann_1");
    expect(useReview.getState().inflight["explain:block:b1"]).toBeUndefined();
    expect(useReview.getState().inflight["ann_1"]).toMatchObject({ kind: "explain" });
  });

  test("attach and clear on unknown ids are no-ops", () => {
    const api = useReview.getState();
    api.attachInflightJob("missing", "job-9");
    api.clearInflight("missing");
    api.retargetInflight("missing", "elsewhere");
    expect(useReview.getState().inflight).toEqual({});
  });

  test("a lingering entry expires via the TTL even with no store events", () => {
    vi.useFakeTimers();
    try {
      useReview.getState().beginInflight("c1", "depth");
      expect(useReview.getState().inflight["c1"]).toBeDefined();
      vi.advanceTimersByTime(INFLIGHT_TTL_MS + 1000);
      expect(useReview.getState().inflight["c1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("an entry attached to a live job outlives the TTL", () => {
    vi.useFakeTimers();
    try {
      const api = useReview.getState();
      api.setSnapshot(snap(5, [job({ state: "running" })]));
      api.beginInflight("c1", "depth");
      api.attachInflightJob("c1", "job-1");
      // Well past the TTL: the running job holds the entry (timer
      // re-arms, resyncs reap nothing).
      vi.advanceTimersByTime(INFLIGHT_TTL_MS * 3);
      expect(useReview.getState().inflight["c1"]?.jobId).toBe("job-1");
      useReview.getState().setSnapshot(snap(6, [job({ state: "running" })]));
      expect(useReview.getState().inflight["c1"]).toBeDefined();
      // Settles when the job does, however late.
      useReview.getState().setSnapshot(snap(7, [job({ state: "done" })]));
      expect(useReview.getState().inflight["c1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("an entry with an unknown job still lapses via the TTL", () => {
    vi.useFakeTimers();
    try {
      const api = useReview.getState();
      api.setSnapshot(snap(5));
      api.beginInflight("c1", "depth");
      // The response attached a job id the snapshot never learns: the
      // wait lapses instead of sticking forever.
      api.attachInflightJob("c1", "job-ghost");
      vi.advanceTimersByTime(INFLIGHT_TTL_MS + 1000);
      expect(useReview.getState().inflight["c1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stale TTL timer never clears a newer entry", () => {
    vi.useFakeTimers();
    try {
      const api = useReview.getState();
      api.beginInflight("c1", "depth");
      // Re-begin just before the first TTL lapses: the first timer fires
      // while the newer entry is still fresh.
      vi.advanceTimersByTime(INFLIGHT_TTL_MS - 1000);
      api.clearInflight("c1");
      api.beginInflight("c1", "examples");
      vi.advanceTimersByTime(2000);
      expect(useReview.getState().inflight["c1"]).toMatchObject({ kind: "examples" });
      vi.advanceTimersByTime(INFLIGHT_TTL_MS);
      expect(useReview.getState().inflight["c1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("clear wipes in-flight state", () => {
    const api = useReview.getState();
    api.beginInflight("c1", "depth");
    api.clear();
    expect(useReview.getState().inflight).toEqual({});
  });

  describe("inflightExpired", () => {
    const entry = (over: Partial<import("./store.js").InFlightAction> = {}) => ({
      kind: "depth" as const,
      targetId: "c1",
      startedAt: 1000,
      seq: 1,
      ...over,
    });
    const old = INFLIGHT_TTL_MS + 1;

    test("young entries never lapse", () => {
      expect(inflightExpired(entry(), [], 1000 + INFLIGHT_TTL_MS)).toBe(false);
    });

    test("old entries without a job lapse", () => {
      expect(inflightExpired(entry(), [], 1000 + old)).toBe(true);
    });

    test("old entries with an unknown job lapse", () => {
      expect(
        inflightExpired(entry({ jobId: "job-ghost" }), [job({ id: "job-1" })], 1000 + old),
      ).toBe(true);
    });

    test("old entries with a live job stay", () => {
      for (const state of ["queued", "running", "backing-off"] as const) {
        expect(
          inflightExpired(entry({ jobId: "job-1" }), [job({ id: "job-1", state })], 1000 + old),
        ).toBe(false);
      }
    });

    test("old entries with a terminal job lapse", () => {
      for (const state of ["done", "error", "cancelled"] as const) {
        expect(
          inflightExpired(entry({ jobId: "job-1" }), [job({ id: "job-1", state })], 1000 + old),
        ).toBe(true);
      }
    });
  });

  test("text events no longer accumulate stream state", () => {
    const api = useReview.getState();
    api.setSnapshot(snap(1));
    useReview.getState().applyEvent({ type: "text", jobId: "job-1", cardId: "c1", delta: "Thinking…" });
    expect(useReview.getState().snapshot?.jobs).toEqual([]);
    expect("streams" in useReview.getState()).toBe(false);
  });
});
