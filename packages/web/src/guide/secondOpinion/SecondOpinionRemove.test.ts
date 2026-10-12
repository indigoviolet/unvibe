/**
 * Remove-during-rerun (issue #76): removing a second opinion while its
 * re-run is in flight drops the late fill — the block stays removed and
 * no working state sticks around. Fake timers make the mock's delayed
 * fill fully deterministic (no sleeps, no timing).
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../api/client.js";
import { resetMockState } from "../../mock/index.js";
import { useReview } from "../../state/store.js";
import { performAction } from "../actions.js";

const REVIEW_ID = "demo";

function opinions(cardId: string): unknown[] {
  const snap = useReview.getState().snapshot;
  const card = snap?.pages.flatMap((p) => p.cards).find((c) => c.id === cardId);
  return card?.secondOpinions ?? [];
}

beforeEach(async () => {
  vi.useRealTimers();
  resetMockState();
  useReview.getState().clear();
  useReview.getState().setSnapshot(await api.review(REVIEW_ID));
});

describe("second-opinion remove during re-run", () => {
  test("a re-run fill landing after Remove stays removed; no stuck spinner", async () => {
    vi.useFakeTimers();
    try {
      // First run completes.
      await performAction(REVIEW_ID, { kind: "second_opinion", cardId: "central", mode: "check" });
      await vi.advanceTimersByTimeAsync(500);
      expect(opinions("central")).toHaveLength(1);
      expect(useReview.getState().inflight["central"]).toBeUndefined();

      // Re-run while the first result is still on the card…
      const rerun = performAction(REVIEW_ID, { kind: "second_opinion", cardId: "central", mode: "check" });
      expect(useReview.getState().inflight["central"]).toMatchObject({ kind: "second_opinion" });
      const res = await rerun;
      expect(res.jobId).toBeTruthy();

      // …Remove lands while it is in flight…
      await performAction(REVIEW_ID, {
        kind: "delete",
        targetId: "second-opinion:central:check",
      });
      expect(opinions("central")).toHaveLength(0);

      // …the late fill is dropped (not resurrected) and the working state clears.
      await vi.advanceTimersByTimeAsync(2000);
      expect(opinions("central")).toHaveLength(0);
      expect(useReview.getState().inflight["central"]).toBeUndefined();
      expect(useReview.getState().snapshot?.jobs.find((j) => j.id === res.jobId)?.state).toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });
});
