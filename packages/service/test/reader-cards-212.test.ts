import { describe, expect, it } from "vitest";
import { isDefaultReaderCardId, readerApply, readerCardId } from "../src/pipeline/apply.js";

describe("reader card ids (#212)", () => {
  it("keeps decisions stable and gives Names its own stable id", () => {
    expect(readerCardId(0)).toBe("problem");
    expect(readerCardId(1)).toBe("central");
    expect(readerCardId(2)).toBe("buildup");
    expect(readerCardId(3)).toBe("decisions");
    expect(readerCardId(4)).toBe("names");
    expect(readerCardId(5)).toBe("reader-5");
    expect(isDefaultReaderCardId("decisions")).toBe(true);
    expect(isDefaultReaderCardId("names")).toBe(true);
  });

  it("readerApply assigns decisions then names in order", () => {
    const blocks = [] as never[];
    const applied = readerApply(
      [
        { title: "The problem", blocks },
        { title: "The central change", blocks },
        { title: "How it's built up", blocks },
        { title: "Decisions and questions", blocks },
        { title: "Names", blocks },
      ],
      null,
    );
    expect(applied.cards.map((c) => [c.id, c.title])).toEqual([
      ["problem", "The problem"],
      ["central", "The central change"],
      ["buildup", "How it's built up"],
      ["decisions", "Decisions and questions"],
      ["names", "Names"],
    ]);
  });

  it("explicit cardIds from the reply win over positional defaults", () => {
    expect(readerCardId(3, ["a", "b", "c", "decisions"])).toBe("decisions");
    expect(readerCardId(4, ["a", "b", "c", "decisions", "names"])).toBe("names");
  });
});
