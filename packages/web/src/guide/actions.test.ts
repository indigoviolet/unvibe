/**
 * Action funnel against the mock API (`VITE_MOCK=1`, issue #46): the
 * in-flight entry is set synchronously at click time, follows the mock
 * job once the response arrives, and clears when the fill lands, the
 * answer needs no job, or the request throws. Nothing sticks.
 */
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Card, Job, ReviewSnapshot } from "@unvibe/shared";
import { api } from "../api/client.js";
import * as ToastModule from "../floating/Toast.js";
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
    // Fake timers for the mock's 400 ms settle timer (issue #119).
    vi.useFakeTimers();
    try {
      const p = performAction(REVIEW_ID, { kind: "second_opinion", cardId: "central", mode: "blind" });
      expect(useReview.getState().inflight["central"]).toMatchObject({ kind: "second_opinion" });
      const res = await p;
      expect(res.jobId).toBeTruthy();
      // Handed over: the entry follows the running snapshot job.
      expect(useReview.getState().inflight["central"]?.jobId).toBe(res.jobId);
      expect(
        useReview.getState().snapshot?.jobs.find((j) => j.id === res.jobId)?.state,
      ).toBe("running");
      await vi.advanceTimersByTimeAsync(1000);
      expect(useReview.getState().inflight["central"]).toBeUndefined();
      expect(
        useReview.getState().snapshot?.jobs.find((j) => j.id === res.jobId)?.state,
      ).toBe("done");
      // The verdict landed on the card.
      expect(pageCard("central").secondOpinions?.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("follow-up retargets to the answer card and clears on fill", async () => {
    // Fake timers for the mock's 700 ms answer fill (issue #119).
    vi.useFakeTimers();
    try {
      performFollowUp(REVIEW_ID, "g-flow", "b3", 0);
      const chipKey = "followup:g-flow:b3:0";
      expect(useReview.getState().inflight[chipKey]).toMatchObject({ kind: "followup" });
      // The response retargets the chip entry to the answer card…
      await vi.advanceTimersByTimeAsync(0);
      expect(useReview.getState().inflight[chipKey]).toBeUndefined();
      const keys = Object.keys(useReview.getState().inflight);
      const answerKey = keys.find((k) => k.startsWith("ann_"));
      expect(answerKey).toBeTruthy();
      // …and the entry clears when the answer fill lands.
      await vi.advanceTimersByTimeAsync(1000);
      expect(useReview.getState().inflight).toEqual({});
      const card = useReview.getState().snapshot?.annotations.find((a) => a.id === answerKey);
      expect(card?.type).toBe("conversation");
      expect(
        card?.type === "conversation" ? (card.turns?.[0]?.blocks.length ?? 0) : 0,
      ).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
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

  describe("insert settle toast ordering", () => {
    function seedCard(revision: number): void {
      useReview.getState().clear();
      const card = {
        id: "c1",
        pageId: "root",
        title: "Card",
        level: "standard",
        read: false,
        collapsed: false,
        revision,
        blocks: [],
        undoStack: [],
      } as unknown as Card;
      useReview.getState().setSnapshot({
        review: { id: REVIEW_ID, repoId: "r", branch: "b", versions: [], currentVersion: 1, createdAt: 0 },
        version: { n: 1, headSha: "abc", mergeBaseSha: "def", baseRef: "main", fetchedAt: 0, idMapping: {} },
        files: [],
        pages: [{ id: "root", kind: "root", title: "Root", saved: false, cards: [card] }],
        annotations: [],
        hunkStates: [],
        jobs: [],
        contributions: [],
        logTail: [],
        rev: 1,
      } as unknown as ReviewSnapshot);
    }

    function doneJob(): Job {
      return {
        id: "job-x",
        kind: "examples",
        provider: "claude",
        model: "m",
        reviewId: REVIEW_ID,
        priority: 100,
        state: "done",
      } as Job;
    }

    test("done with no revision change still toasts after quiet", async () => {
      vi.useFakeTimers();
      try {
        seedCard(1);
        let resolveAction!: (res: { accepted: boolean; jobId: string }) => void;
        const actionSpy = vi.spyOn(api, "action").mockImplementation(
          () => new Promise((resolve) => { resolveAction = resolve as never; }),
        );
        const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
        try {
          const p = performAction(REVIEW_ID, { kind: "examples", cardId: "c1" });
          resolveAction({ accepted: true, jobId: "job-x" });
          await p;
          // Done event lands with no content patch (repeat adds nothing).
          useReview.getState().applyEvent({ type: "job", job: doneJob() });
          await vi.advanceTimersByTimeAsync(3000);
          expect(toastSpy).toHaveBeenCalledWith("Nothing more to add to this card");
        } finally {
          actionSpy.mockRestore();
          toastSpy.mockRestore();
        }
      } finally {
        vi.useRealTimers();
      }
    });

    test("done arriving before the content patch does not toast", async () => {
      vi.useFakeTimers();
      try {
        seedCard(1);
        let resolveAction!: (res: { accepted: boolean; jobId: string }) => void;
        const actionSpy = vi.spyOn(api, "action").mockImplementation(
          () => new Promise((resolve) => { resolveAction = resolve as never; }),
        );
        const toastSpy = vi.spyOn(ToastModule, "toast").mockImplementation(() => {});
        try {
          const p = performAction(REVIEW_ID, { kind: "examples", cardId: "c1" });
          resolveAction({ accepted: true, jobId: "job-x" });
          await p;
          // Done event first (content patch still queued behind a gap)…
          useReview.getState().applyEvent({ type: "job", job: doneJob() });
          await vi.advanceTimersByTimeAsync(500);
          // …then the revision-bumping patch lands before quiet elapses.
          const snap = useReview.getState().snapshot!;
          const nextPages = JSON.parse(JSON.stringify(snap.pages)) as typeof snap.pages;
          nextPages[0].cards[0].revision = 2;
          useReview.getState().applyEvent({
            type: "patch",
            baseRev: snap.rev,
            headRev: snap.rev + 1,
            ops: [{ op: "replace", path: "/pages", value: nextPages }],
          });
          await vi.advanceTimersByTimeAsync(5000);
          expect(toastSpy).not.toHaveBeenCalledWith("Nothing more to add to this card");
        } finally {
          actionSpy.mockRestore();
          toastSpy.mockRestore();
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });

  test("a thrown request clears the entry", async () => {
    const p = performAction(REVIEW_ID, { kind: "depth", cardId: "no-such-card", direction: "deeper" });
    expect(useReview.getState().inflight["no-such-card"]).toMatchObject({ kind: "depth" });
    await expect(p).rejects.toThrow();
    expect(useReview.getState().inflight["no-such-card"]).toBeUndefined();
  });

  test("update shows until the mock update job settles", async () => {
    // Fake timers for the mock's 100 ms latency + 800 ms settle timer.
    vi.useFakeTimers();
    try {
      const p = performUpdate(REVIEW_ID);
      expect(useReview.getState().inflight["update:demo"]).toMatchObject({ kind: "update" });
      await vi.advanceTimersByTimeAsync(1000);
      await p;
      expect(useReview.getState().inflight["update:demo"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
