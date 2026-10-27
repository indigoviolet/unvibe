import { describe, expect, it } from "vitest";
import {
  CHANGES_DEFAULT_LIMIT,
  CHANGES_MAX_LIMIT,
  normalizeChangesAuthor,
  normalizeChangesLimit,
} from "../src/api.js";

describe("normalizeChangesLimit (#297)", () => {
  it("defaults to 30 when absent or unreadable", () => {
    expect(normalizeChangesLimit(undefined)).toBe(CHANGES_DEFAULT_LIMIT);
    expect(normalizeChangesLimit(null)).toBe(CHANGES_DEFAULT_LIMIT);
    expect(normalizeChangesLimit("")).toBe(CHANGES_DEFAULT_LIMIT);
    expect(normalizeChangesLimit("many")).toBe(CHANGES_DEFAULT_LIMIT);
    expect(normalizeChangesLimit(NaN)).toBe(CHANGES_DEFAULT_LIMIT);
    expect(normalizeChangesLimit({})).toBe(CHANGES_DEFAULT_LIMIT);
  });

  it("reads plain and string numbers, floored", () => {
    expect(normalizeChangesLimit(60)).toBe(60);
    expect(normalizeChangesLimit("60")).toBe(60);
    expect(normalizeChangesLimit(60.9)).toBe(60);
  });

  it("clamps onto [1, max]", () => {
    expect(normalizeChangesLimit(0)).toBe(1);
    expect(normalizeChangesLimit(-5)).toBe(1);
    expect(normalizeChangesLimit(100000)).toBe(CHANGES_MAX_LIMIT);
    expect(normalizeChangesLimit(Infinity)).toBe(CHANGES_DEFAULT_LIMIT);
  });
});

describe("normalizeChangesAuthor (#297)", () => {
  it("trims, and reads blank as absent", () => {
    expect(normalizeChangesAuthor("alice")).toBe("alice");
    expect(normalizeChangesAuthor("  alice  ")).toBe("alice");
    expect(normalizeChangesAuthor("")).toBeNull();
    expect(normalizeChangesAuthor("   ")).toBeNull();
    expect(normalizeChangesAuthor(undefined)).toBeNull();
    expect(normalizeChangesAuthor(null)).toBeNull();
    expect(normalizeChangesAuthor(42)).toBeNull();
  });
});
