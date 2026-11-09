/** tour-matrix rules (#362): slim by default, full on demand, keeps consistent. */
import { describe, expect, it } from "vitest";
import { NAMED_KEEPS, SLIM_SCENES, fullMatrix, tourCombos } from "../e2e/tour-matrix.js";

const FULL = [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "960-light", width: 960, dark: false },
  { name: "960-dark", width: 960, dark: true },
] as const;

describe("tourCombos", () => {
  it("runs the slim list by default", () => {
    expect(tourCombos("main", FULL).map((c) => c.name)).toEqual(["1440-light", "1440-dark"]);
    expect(tourCombos("gutterE2", FULL).map((c) => c.name)).toEqual(["1440-light"]);
  });

  it("runs the full matrix with UNVIBE_TOUR_MATRIX=full", () => {
    const prev = process.env["UNVIBE_TOUR_MATRIX"];
    process.env["UNVIBE_TOUR_MATRIX"] = "full";
    try {
      expect(fullMatrix()).toBe(true);
      expect(tourCombos("main", FULL)).toHaveLength(FULL.length);
    } finally {
      if (prev === undefined) delete process.env["UNVIBE_TOUR_MATRIX"];
      else process.env["UNVIBE_TOUR_MATRIX"] = prev;
    }
  });

  it("unknown scenes default to their first combo", () => {
    expect(tourCombos("nope", FULL).map((c) => c.name)).toEqual(["1440-light"]);
  });

  it("every named keep is in its scene's slim list", () => {
    for (const keep of NAMED_KEEPS) {
      const slim = SLIM_SCENES[keep.scene];
      expect(slim, `scene ${keep.scene} missing from SLIM_SCENES`).toBeDefined();
      for (const combo of keep.combos) {
        expect(slim, `${keep.scene}: keep ${combo} not slim`).toContain(combo);
      }
      expect(keep.reason.length).toBeGreaterThan(0);
    }
  });
});
