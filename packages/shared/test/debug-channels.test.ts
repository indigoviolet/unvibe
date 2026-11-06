/**
 * Debug-channel helpers shared by service and web (issue #356).
 */
import { describe, expect, it } from "vitest";
import { debugChannelFor, isDebugChannel } from "../src/api.js";

describe("debug channels (shared)", () => {
  it("recognises debug refs", () => {
    expect(isDebugChannel("release-debug")).toBe(true);
    expect(isDebugChannel("preview/feat-x-debug")).toBe(true);
    expect(isDebugChannel("release")).toBe(false);
    expect(isDebugChannel("preview/feat-x")).toBe(false);
    expect(isDebugChannel("preview/debug")).toBe(false);
    expect(isDebugChannel("")).toBe(false);
  });

  it("maps a lean channel to its debug install ref", () => {
    expect(debugChannelFor("release")).toBe("release-debug");
    expect(debugChannelFor("preview/feat-x")).toBe("preview/feat-x-debug");
    expect(debugChannelFor("release-debug")).toBe("release-debug");
    expect(debugChannelFor("preview/feat-x-debug")).toBe("preview/feat-x-debug");
    expect(debugChannelFor(null)).toBe("release-debug");
  });
});
