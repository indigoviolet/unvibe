import { describe, expect, it } from "vitest";
import type { Annotation } from "@unvibe/shared";
import {
  expansionPreview,
  isAnchorStale,
  isClosedExpansion,
  isNoAgentMessage,
  isOpenExpansion,
  isPromotedLink,
} from "./expansionUtils.js";

function turn(over: Record<string, unknown> = {}): import("@unvibe/shared").Turn {
  return {
    id: "ans_1",
    question: null,
    blocks: [],
    level: "standard",
    revision: 1,
    undoStack: [],
    ...over,
  } as import("@unvibe/shared").Turn;
}

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: "a1",
    type: "conversation",
    anchor: {
      host: { kind: "block", blockId: "b1" },
      quotedText: "q",
      prefix: "",
      suffix: "",
      position: 0,
      version: 1,
    },
    open: true,
    messages: [],
    post: false,
    note: false,
    ...over,
  } as Annotation;
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
      turns: [
        turn({
          blocks: [{ type: "paragraph", id: "b1", text: { standard: "<code>x</code> hello world" }, citations: [] }],
        }),
      ],
    });
    expect(expansionPreview(a)).toContain("hello world");
  });

  it("detects the no-agent message", () => {
    expect(isNoAgentMessage("no agent configured: set UNVIBE_AGENT")).toBe(true);
    expect(isNoAgentMessage("boom")).toBe(false);
  });
});
