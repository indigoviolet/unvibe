/**
 * Action funnel against the mock API (`VITE_MOCK=1`, issue #46): the
 * in-flight entry is set synchronously at click time, follows the mock
 * job once the response arrives, and clears when the fill lands, the
 * answer needs no job, or the request throws. Nothing sticks.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Card } from "@unvibe/shared";
import { api } from "../api/client.js";
import { resetMockState } from "../mock/index.js";
import { useReview } from "../state/store.js";
import { performAction, performFollowUp, performUpdate } from "./actions.js";

const REVIEW_ID = "demo";

function pageCard(cardId: string): Card {
  const snap = useReview.getState().snapshot;
  const card = snap?.pages.flatMap((p) => p.cards).find((c) => c.id === cardId);
  if (!card) throw new Error(`no card ${cardId} in snapshot`);
  return card;
}

beforeEach(async () => {
  vi.useRealTimers();
  resetMockState();
  useReview.getState().clear();
  useReview.getState().setSnapshot(await api.review(REVIEW_ID));
});

describe("performAction in-flight funnel", () => {
  test("depth shows immediately and clears after the instant answer", async () => {
    const before = pageCard("central").level;
    const p = performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "simpler" });
    // Set synchronously, before the request returns.
    expect(useReview.getState().inflight["central"]).toMatchObject({ kind: "depth" });
    const res = await p;
    expect(res.accepted).toBe(true);
    // The mock answers with no job: cleared, nothing stuck.
    expect(useReview.getState().inflight["central"]).toBeUndefined();
    expect(pageCard("central").level).not.toBe(before);
  });

  test("second opinion hands over to the job and clears when it settles", async () => {
    const p = performAction(REVIEW_ID, { kind: "second_opinion", cardId: "central", mode: "blind" });
    expect(useReview.getState().inflight["central"]).toMatchObject({ kind: "second_opinion" });
    const res = await p;
    expect(res.jobId).toBeTruthy();
    // Handed over: the entry follows the running snapshot job.
    expect(useReview.getState().inflight["central"]?.jobId).toBe(res.jobId);
    expect(
      useReview.getState().snapshot?.jobs.find((j) => j.id === res.jobId)?.state,
    ).toBe("running");
    await vi.waitFor(
      () => expect(useReview.getState().inflight["central"]).toBeUndefined(),
      { timeout: 5000 },
    );
    expect(
      useReview.getState().snapshot?.jobs.find((j) => j.id === res.jobId)?.state,
    ).toBe("done");
    // The verdict landed on the card.
    expect(pageCard("central").secondOpinions?.length).toBeGreaterThan(0);
  });

  test("follow-up retargets to the answer expansion and clears on fill", async () => {
    performFollowUp(REVIEW_ID, "g-flow", "b3", 0);
    const chipKey = "followup:g-flow:b3:0";
    expect(useReview.getState().inflight[chipKey]).toMatchObject({ kind: "followup" });
    // The response retargets the chip entry to the answer expansion…
    await vi.waitFor(
      () => expect(useReview.getState().inflight[chipKey]).toBeUndefined(),
      { timeout: 5000 },
    );
    const keys = Object.keys(useReview.getState().inflight);
    const answerKey = keys.find((k) => k.startsWith("ann_"));
    expect(answerKey).toBeTruthy();
    // …and the entry clears when the answer fill lands.
    await vi.waitFor(
      () => expect(useReview.getState().inflight).toEqual({}),
      { timeout: 5000 },
    );
    const expansion = useReview.getState().snapshot?.annotations.find((a) => a.id === answerKey);
    expect(expansion?.type).toBe("expansion");
    expect(
      expansion?.type === "expansion" ? expansion.expansion?.blocks.length : 0,
    ).toBeGreaterThan(0);
  });

  test("a saturated repeat clears instead of sticking", async () => {
    await performAction(REVIEW_ID, { kind: "examples", cardId: "central" });
    expect(useReview.getState().inflight["central"]).toBeUndefined();
    // Second click adds nothing (no job): still nothing stuck.
    await performAction(REVIEW_ID, { kind: "examples", cardId: "central" });
    expect(useReview.getState().inflight["central"]).toBeUndefined();
  });

  test("a stale response never settles a newer entry on the same key", async () => {
    const resolvers: ((res: { accepted: boolean }) => void)[] = [];
    const spy = vi.spyOn(api, "action").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve as never);
        }),
    );
    try {
      const first = performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "deeper" });
      const second = performAction(REVIEW_ID, { kind: "depth", cardId: "central", direction: "deeper" });
      expect(resolvers).toHaveLength(2);
      // The first answer arrives after the second click: it must not wipe
      // the second click's entry.
      resolvers[0]({ accepted: true });
      await first;
      expect(useReview.getState().inflight["central"]).toMatchObject({ kind: "depth" });
      resolvers[1]({ accepted: true });
      await second;
      expect(useReview.getState().inflight["central"]).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  test("a thrown request clears the entry", async () => {
    const p = performAction(REVIEW_ID, { kind: "depth", cardId: "no-such-card", direction: "deeper" });
    expect(useReview.getState().inflight["no-such-card"]).toMatchObject({ kind: "depth" });
    await expect(p).rejects.toThrow();
    expect(useReview.getState().inflight["no-such-card"]).toBeUndefined();
  });

  test("update shows until the mock update job settles", async () => {
    performUpdate(REVIEW_ID);
    expect(useReview.getState().inflight["update:demo"]).toMatchObject({ kind: "update" });
    await vi.waitFor(
      () => expect(useReview.getState().inflight["update:demo"]).toBeUndefined(),
      { timeout: 5000 },
    );
  });
});
