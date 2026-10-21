import { describe, expect, it } from "vitest";
import { minutesToMs, msToMinutes } from "./LimitsSection.js";
describe("limits duration units", () => {
  it("edits cache lifetime in minutes and saves ms", () => {
    expect(msToMinutes(300000)).toBe(5);
    expect(minutesToMs(5)).toBe(300000);
    expect(minutesToMs(2.5)).toBe(150000);
  });
});
