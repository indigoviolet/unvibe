import { describe, expect, test } from "vitest";
import type { Annotation, ReviewSnapshot } from "@unvibe/shared";
import {
  forPrThreads,
  pendingCount,
  threadLocationLabel,
  threadPostText,
  threadWhereLabel,
} from "./threads.js";

function thread(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann_x",
    type: "thread",
    anchor: { host: { kind: "block", blockId: "c#b" }, quotedText: "q", prefix: "", suffix: "", position: 0, version: 1 },
    open: true,
    messages: [],
    post: false,
    note: true,
    ...over,
  };
}

describe("threadPostText", () => {
  test("prefers the For-PR draft", () => {
    const t = thread({ draft: "draft", messages: [{ who: "you", text: "orig" }] });
    expect(threadPostText(t)).toBe("draft");
  });

  test("falls back to the first user message, then the suggestion", () => {
    expect(threadPostText(thread({ messages: [{ who: "you", text: "hello" }] }))).toBe("hello");
    expect(
      threadPostText(thread({ messages: [{ who: "ai", text: "s", suggested: true }] })),
    ).toBe("s");
  });
});

describe("pending counts", () => {
  test("posted threads are never pending", () => {
    const snap = {
      annotations: [
        thread({ id: "a", post: true, messages: [{ who: "you", text: "x" }] }),
        thread({ id: "b", post: true, postedAt: 1, messages: [{ who: "you", text: "y" }] }),
      ],
    } as unknown as ReviewSnapshot;
    expect(forPrThreads(snap).map((t) => t.id)).toEqual(["a"]);
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
