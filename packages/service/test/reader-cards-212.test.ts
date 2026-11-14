import { describe, expect, it } from "vitest";
import { isDefaultReaderCardId, readerApply, readerCardId } from "../src/pipeline/apply.js";

describe("reader card ids (#212)", () => {
  // Note: `templateBody` filtering is moot below (data is null), so these
  // pass a body naming pendingCards+plotlines like the real prompts do.
  const BODY = `"pendingCards" "plotlines"`;

  it("keeps decisions stable and gives Names its own stable id", () => {
    expect(readerCardId(0)).toBe("problem");
    expect(readerCardId(1)).toBe("central");
    expect(readerCardId(2, [], "Decisions and questions")).toBe("decisions");
    expect(readerCardId(3, [], "Names")).toBe("names");
    expect(readerCardId(4)).toBe("reader-4");
    expect(isDefaultReaderCardId("decisions")).toBe(true);
    expect(isDefaultReaderCardId("names")).toBe(true);
  });

  it("no buildup card: its old title is an ordinary per-plotline card (#405)", () => {
    expect(readerCardId(2, [], "How it's built up")).toBe("reader-2");
    expect(isDefaultReaderCardId("buildup")).toBe(false);
  });

  it("readerApply assigns decisions then names in order", () => {
    const blocks = [] as never[];
    const applied = readerApply(
      [
        { title: "The problem", blocks },
        { title: "The central change", blocks },
        { title: "Decisions and questions", blocks },
        { title: "Names", blocks },
      ],
      null,
      BODY,
    );
    expect(applied.cards.map((c) => [c.id, c.title])).toEqual([
      ["problem", "The problem"],
      ["central", "The central change"],
      ["decisions", "Decisions and questions"],
      ["names", "Names"],
    ]);
  });

  it("multi-plotline: one central card, then per-plotline cards, then the rest (#212)", () => {
    const blocks = [] as never[];
    const applied = readerApply(
      [
        { title: "The problem", blocks },
        { title: "The central idea", blocks },
        { title: "Unfold folded values", blocks },
        { title: "Prove the unfolding works", blocks },
        { title: "Decisions and questions", blocks },
        { title: "Names", blocks },
      ],
      null,
      BODY,
    );
    expect(applied.cards.map((c) => c.id)).toEqual([
      "problem",
      "central",
      "reader-2",
      "reader-3",
      "decisions",
      "names",
    ]);
    expect(applied.cards.filter((c) => c.id === "central")).toHaveLength(1);
  });

  it("explicit cardIds from the reply win over positional defaults", () => {
    expect(readerCardId(3, ["a", "b", "c", "decisions"])).toBe("decisions");
    expect(readerCardId(4, ["a", "b", "c", "decisions", "names"])).toBe("names");
  });
});
