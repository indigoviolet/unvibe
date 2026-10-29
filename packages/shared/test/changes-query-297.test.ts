import { describe, expect, it } from "vitest";
import {
  CHANGES_DEFAULT_LIMIT,
  CHANGES_MAX_LIMIT,
  decodeChangesCursor,
  encodeChangesCursor,
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

describe("normalizeChangesAuthor (#297, #310)", () => {
  it("trims, and reads blank as absent", () => {
    expect(normalizeChangesAuthor("alice")).toBe("alice");
    expect(normalizeChangesAuthor("  alice  ")).toBe("alice");
    expect(normalizeChangesAuthor("")).toBeNull();
    expect(normalizeChangesAuthor("   ")).toBeNull();
    expect(normalizeChangesAuthor(undefined)).toBeNull();
    expect(normalizeChangesAuthor(null)).toBeNull();
    expect(normalizeChangesAuthor(42)).toBeNull();
  });

  it("rejects anything that is not a login shape (#310: the value lands in a search string)", () => {
    expect(normalizeChangesAuthor("alice-1")).toBe("alice-1");
    expect(normalizeChangesAuthor("x state:closed")).toBeNull();
    expect(normalizeChangesAuthor("a/b")).toBeNull();
    expect(normalizeChangesAuthor("-alice")).toBeNull();
    expect(normalizeChangesAuthor("alice-")).toBeNull();
    expect(normalizeChangesAuthor("a".repeat(40))).toBeNull();
    expect(normalizeChangesAuthor("a".repeat(39))).toBe("a".repeat(39));
  });
});

describe("changes cursor codec (#310)", () => {
  it("round-trips per-search cursors, keeping absent apart from null", () => {
    const token = encodeChangesCursor({ authoring: "a1", direct: null, team: "t9" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = decodeChangesCursor(token);
    expect(back).toEqual({ authoring: "a1", direct: null, team: "t9" });
    // Missing keys stay missing (unfetched), explicit nulls stay null (done).
    expect(decodeChangesCursor(encodeChangesCursor({}))).toEqual({});
    expect(decodeChangesCursor(encodeChangesCursor({ direct: "d" }))).toEqual({ direct: "d" });
  });

  it("reads garbage as nothing fetched yet", () => {
    expect(decodeChangesCursor(undefined)).toEqual({});
    expect(decodeChangesCursor("")).toEqual({});
    expect(decodeChangesCursor("!!!not-base64!!!")).toEqual({});
    expect(decodeChangesCursor({ direct: "d" })).toEqual({});
    // Base64 of '["a"]' (an array, not a cursor object).
    expect(decodeChangesCursor("WyJhIl0")).toEqual({});
  });
});
