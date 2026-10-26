import { describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import {
  outboxThreads,
  pendingCount,
  threadLocationLabel,
  threadPostText,
  threadWhereLabel,
} from "./threads.js";

function mkReply(who: "you" | "agent", text: string, suggested = false): import("@unvibe/shared").Reply {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    id: `ans_${who}_${Math.random().toString(36).slice(2, 6)}`,
    kind: "comment",
    who,
    question: null,
    blocks: [{ type: "paragraph", id: "b1", text: { standard: esc }, citations: [] }],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...(suggested ? { suggested: true } : {}),
  };
}

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_x",
    type: "thread",
    anchor: { host: { kind: "block", blockId: "c#b" }, quotedText: "q", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    pinned: false,
    replies: [],
    post: false,
    ...over,
  };
}

describe("threadPostText", () => {
  test("prefers the Outbox draft", () => {
    const t = thread({ draft: "draft", replies: [mkReply("you", "orig")] });
    expect(threadPostText(t)).toBe("draft");
  });

  test("falls back to the first user message, then the suggestion", () => {
    expect(threadPostText(thread({ replies: [mkReply("you", "hello")] }))).toBe("hello");
    expect(
      threadPostText(thread({ replies: [mkReply("agent", "s", true)] })),
    ).toBe("s");
  });
});

describe("pending counts", () => {
  test("posted threads are never pending", () => {
    const snap = {
      annotations: [
        thread({ id: "a", post: true, replies: [mkReply("you", "x")] }),
        thread({ id: "b", post: true, postedAt: 1, replies: [mkReply("you", "y")] }),
      ],
    } as unknown as ReviewSnapshot;
    expect(outboxThreads(snap).map((t) => t.id)).toEqual(["a"]);
    expect(pendingCount(snap)).toBe(1);
  });

  test("a pending description edit adds one", () => {
    const snap = {
      annotations: [],
      description: { html: "<div></div>", pendingHtml: "<div>e</div>" },
    } as unknown as ReviewSnapshot;
    expect(pendingCount(snap)).toBe(1);
  });
});

describe("description thread labels (finding 22)", () => {
  const descThread = thread({
    anchor: { host: { kind: "description", paragraphId: "d-p1" }, quotedText: "q", prefix: "", suffix: "", position: 0, version: 1 },
  });
  const prSnap = { review: { prNumber: 12 } } as unknown as ReviewSnapshot;
  const branchSnap = { review: {} } as unknown as ReviewSnapshot;

  test("location + where name the PR tab for PR reviews, Commits for branch reviews", () => {
    expect(threadLocationLabel(prSnap, descThread)).toBe("PR description");
    expect(threadWhereLabel(prSnap, descThread)).toBe("PR description");
    expect(threadLocationLabel(branchSnap, descThread)).toBe("Commits");
    expect(threadWhereLabel(branchSnap, descThread)).toBe("Commits");
  });
});
