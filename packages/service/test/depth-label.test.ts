import { describe, expect, it } from "vitest";
import type { ReviewSnapshot } from "@unvibe/shared";
import { cardTitle } from "../src/pipeline/actions/events.js";

function snapshot(): ReviewSnapshot {
  return {
    pages: [
      {
        id: "root",
        kind: "root",
        cards: [
          { id: "c-titled", title: "The central change", blocks: [] },
          { id: "c-untitled", title: null, blocks: [] },
        ],
      },
    ],
    annotations: [
      {
        id: "ann_quoted",
        type: "expansion",
        anchor: { host: { kind: "block", blockId: "c-titled#b1" }, quotedText: "folded headers" },
      },
      {
        id: "ann_empty",
        type: "expansion",
        anchor: { host: { kind: "block", blockId: "c-titled#b1" }, quotedText: "  " },
      },
    ],
  } as unknown as ReviewSnapshot;
}

describe("cardTitle (issue #80)", () => {
  it("prefers the card title", () => {
    expect(cardTitle(snapshot(), "c-titled")).toBe("The central change");
  });
  it("never falls through to a raw id", () => {
    const snap = snapshot();
    expect(cardTitle(snap, "c-untitled")).toBe("untitled card");
    expect(cardTitle(snap, "ann_quoted")).toBe("folded headers");
    expect(cardTitle(snap, "ann_empty")).toBe("explanation");
    expect(cardTitle(snap, "ann_2efb149158bf")).toBe("untitled card");
  });
});
