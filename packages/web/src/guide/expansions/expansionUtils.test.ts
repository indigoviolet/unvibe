import { describe, expect, it } from "vitest";
import type { Thread } from "@unvibe/shared";
import {
  expansionPreview,
  isAnchorStale,
  isClosedExpansion,
  isExpansionFootnote,
  isNoAgentMessage,
  isOpenExpansion,
  isPromotedLink,
} from "./expansionUtils.js";

function turn(over: Record<string, unknown> = {}): import("@unvibe/shared").Reply {
  return {
    id: "ans_1",
    seq: 1,
    kind: "ask",
    who: "agent",
    question: null,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...over,
  } as import("@unvibe/shared").Reply;
}

function ann(over: Partial<Thread>): Thread {
  return {
    id: "a1",
    type: "thread",
    anchor: {
      host: { kind: "block", blockId: "b1" },
      quotedText: "q",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    pinned: false,
    replies: [],
    post: false,
    ...over,
  } as Thread;
}

describe("conversation card utils", () => {
  it("classifies open/closed/promoted cards", () => {
    expect(isOpenExpansion(ann({ open: true }))).toBe(true);
    expect(isClosedExpansion(ann({ open: false }))).toBe(true);
    expect(isPromotedLink(ann({ type: "link" as never, promotedToPage: "p-1" }))).toBe(true);
    expect(isPromotedLink(ann({ open: false, promotedToPage: "p-1" }))).toBe(true);
  });

  it("detects anchor-stale", () => {
    expect(isAnchorStale(ann({ anchorStale: true }))).toBe(true);
    expect(isAnchorStale(ann({}))).toBe(false);
  });

  it("previews the first paragraph", () => {
    const a = ann({
      replies: [
        turn({
          blocks: [{ type: "paragraph", id: "b1", text: { standard: "<code>x</code> hello world" }, citations: [] }],
        }),
      ],
    });
    expect(expansionPreview(a)).toContain("hello world");
  });

  it("excludes comment threads from expansion footnotes (#374)", () => {
    const comment = (open: boolean): Thread =>
      ann({ open, replies: [{ ...turn({ kind: "comment", who: "you" }), question: "note" }] });
    // Closed comment threads are not closed expansions for footnote
    // purposes — GuideThreads + the margin pill own them.
    expect(isExpansionFootnote(comment(false))).toBe(false);
    expect(isExpansionFootnote(comment(true))).toBe(false);
    expect(isExpansionFootnote(ann({ open: false }))).toBe(true);
    expect(isExpansionFootnote(ann({ open: true }))).toBe(false);
    expect(isExpansionFootnote(ann({ open: false, promotedToPage: "p-1" }))).toBe(true);
  });

  it("detects the no-agent message", () => {
    expect(isNoAgentMessage("no agent configured: set UNVIBE_AGENT")).toBe(true);
    expect(isNoAgentMessage("boom")).toBe(false);
  });
});
