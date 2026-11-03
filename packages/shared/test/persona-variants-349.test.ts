/**
 * Persona card selection helpers, issue #349 step 2.
 */
import { describe, expect, it } from "vitest";
import type { Card } from "../src/entities.js";
import { cardHasVersions, cardVariantList, isCardVariant } from "../src/entities.js";

function cardWith(variants: Card["variants"]): Pick<Card, "variants"> {
  return { variants };
}

describe("persona card variants (#349 step 2)", () => {
  it("isCardVariant accepts a stored variant and rejects the guide shape", () => {
    expect(
      isCardVariant({
        personaId: "p1",
        blocks: [],
        level: "standard",
        revision: 1,
        undoStack: [],
      }),
    ).toBe(true);
    expect(isCardVariant({ blocks: [] })).toBe(false);
    expect(isCardVariant({ personaId: "p1", blocks: [], level: "extreme", revision: 1, undoStack: [] })).toBe(false);
    expect(isCardVariant(null)).toBe(false);
  });

  it("cardVariantList returns variants in persona order", () => {
    const list = cardVariantList(
      cardWith({
        b: { personaId: "b", blocks: [], level: "simple", revision: 1, undoStack: [] },
        a: { personaId: "a", blocks: [], level: "deep", revision: 2, undoStack: [] },
      }),
      [{ id: "a" }, { id: "b" }, { id: "missing" }],
    );
    expect(list.map((v) => v.personaId)).toEqual(["a", "b"]);
  });

  it("cardHasVersions is true only when a variant ran", () => {
    expect(cardHasVersions(cardWith(undefined))).toBe(false);
    expect(cardHasVersions(cardWith({}))).toBe(false);
    expect(
      cardHasVersions(cardWith({ a: { personaId: "a", blocks: [], level: "standard", revision: 1, undoStack: [] } })),
    ).toBe(true);
    // A variant whose persona was deleted since still counts as a version.
    expect(
      cardHasVersions(cardWith({ a: { personaId: "a", blocks: [], level: "standard", revision: 1, undoStack: [] } })),
    ).toBe(true);
  });
});
