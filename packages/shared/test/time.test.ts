/**
 * Short relative ages + exact-time tooltips (issue #431).
 */
import { describe, expect, it } from "vitest";
import { exactTime, shortAge } from "../src/time.js";

const NOW = Date.UTC(2026, 10, 18, 14, 32, 0);
const MIN = 60_000;
const HOUR = 3600_000;
const DAY = 86400_000;

describe("shortAge (#431)", () => {
  it("says now under a minute (and for future stamps)", () => {
    expect(shortAge(NOW, NOW)).toBe("now");
    expect(shortAge(NOW - 30_000, NOW)).toBe("now");
    expect(shortAge(NOW + HOUR, NOW)).toBe("now");
  });
  it("minutes, hours, days", () => {
    expect(shortAge(NOW - 5 * MIN, NOW)).toBe("5m");
    expect(shortAge(NOW - 59 * MIN, NOW)).toBe("59m");
    expect(shortAge(NOW - 2 * HOUR, NOW)).toBe("2h");
    expect(shortAge(NOW - 23 * HOUR, NOW)).toBe("23h");
    expect(shortAge(NOW - 3 * DAY, NOW)).toBe("3d");
    expect(shortAge(NOW - 6 * DAY, NOW)).toBe("6d");
  });
  it("weeks, months, years", () => {
    expect(shortAge(NOW - 7 * DAY, NOW)).toBe("1w");
    expect(shortAge(NOW - 21 * DAY, NOW)).toBe("3w");
    expect(shortAge(NOW - 30 * DAY, NOW)).toBe("1mo");
    expect(shortAge(NOW - 60 * DAY, NOW)).toBe("2mo");
    expect(shortAge(NOW - 365 * DAY, NOW)).toBe("1y");
    expect(shortAge(NOW - 800 * DAY, NOW)).toBe("2y");
  });
});

describe("exactTime (#431)", () => {
  it("names day, month, year, hour and minute", () => {
    const text = exactTime(NOW);
    expect(text).toContain("2026");
    expect(text).toContain("18");
    expect(text).toMatch(/14:32|2:32/);
  });
});
