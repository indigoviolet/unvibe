import { describe, expect, test } from "vitest";
import { DATA_FORMAT, compareDataFormat, dataFormatResetWarning } from "../src/index.js";

describe("data format (#311)", () => {
  test("DATA_FORMAT is a positive integer (1 = flat threads, v0.0.12)", () => {
    expect(Number.isInteger(DATA_FORMAT)).toBe(true);
    expect(DATA_FORMAT).toBe(1);
  });

  test("pre-update comparison: same, changed, unknown", () => {
    expect(compareDataFormat(1, 1)).toBe("same");
    expect(compareDataFormat(1, 2)).toBe("changed");
    expect(compareDataFormat(1, null)).toBe("unknown");
    expect(compareDataFormat(1, undefined)).toBe("unknown");
  });

  test("warning names both formats, the reset and the Outbox", () => {
    const w = dataFormatResetWarning(1, 2);
    expect(w).toContain("1 → 2");
    expect(w).toContain("reset");
    expect(w).toContain("Outbox");
  });
});
