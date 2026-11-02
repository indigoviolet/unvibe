/**
 * Issue #339: the Outbox toggle fails with
 * "annotation t-seed is not a thread" on threads that carry comment
 * replies, whatever kind of annotation started the thread.
 *
 * Against the mock API (`VITE_MOCK=1`, the static demo path): toggling
 * `post` on the seeded `t-seed` thread (type `thread`, one comment
 * reply) must succeed, and an Ask-started thread that later gains a
 * reviewer comment reply must toggle the same way. Submit/Outbox still
 * carry only `kind === "comment"` replies.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { api } from "../api/client.js";
import { resetMockState } from "../mock/index.js";
import { useReview } from "../state/store.js";

const REVIEW_ID = "demo";

function thread(id: string) {
  const snap = useReview.getState().snapshot;
  const found = snap?.annotations.find((a) => a.id === id);
  if (!found) throw new Error(`no thread ${id} in snapshot`);
  return found;
}

beforeEach(async () => {
  resetMockState();
  useReview.getState().clear();
  useReview.getState().setSnapshot(await api.review(REVIEW_ID));
});

describe("Outbox toggle on threads with comment replies (#339)", () => {
  test("toggling post on the seeded t-seed thread succeeds", async () => {
    const seed = thread("t-seed");
    expect(seed.type).toBe("thread");
    expect(seed.replies.some((r) => r.kind === "comment")).toBe(true);

    await api.updateComment(REVIEW_ID, "t-seed", { post: true });

    expect(thread("t-seed").post).toBe(true);
    const outbox = await api.outbox(REVIEW_ID);
    expect(outbox.count).toBeGreaterThan(0);
    expect(outbox.markdown).toContain("Does the fast path still catch a fold that uses a bare LF?");
  });

  test("an Ask-started thread with a reviewer comment toggles, and only the comment posts", async () => {
    const asked = await api.action(REVIEW_ID, {
      kind: "ask",
      quote: "raw CRLF",
      anchor: { where: "block", blockId: "b1" },
      message: "Why this?",
    });
    expect(asked.accepted).toBe(true);
    const id = (asked as { annotationId: string }).annotationId;
    await api.replyComment(REVIEW_ID, id, { text: "Reviewer note" });

    await api.updateComment(REVIEW_ID, id, { post: true });

    expect(thread(id).post).toBe(true);
    const { preview } = await api.submitPreview(REVIEW_ID);
    const entry = preview.comments.find((c) => c.threadId === id);
    expect(entry).toBeDefined();
    expect(entry?.text).toContain("Reviewer note");
    expect(entry?.text).not.toContain("Why this?");
  });
});
