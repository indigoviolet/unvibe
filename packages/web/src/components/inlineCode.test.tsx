import { describe, expect, it } from "vitest";
import { stripCodeSpans } from "./inlineCode.js";

describe("stripCodeSpans", () => {
  it("drops the backticks around code spans", () => {
    expect(stripCodeSpans("Add the `some_guard` for retries")).toBe("Add the some_guard for retries");
  });
  it("leaves text without spans alone", () => {
    expect(stripCodeSpans("Retry failed uploads")).toBe("Retry failed uploads");
  });
  it("leaves an unclosed backtick alone", () => {
    expect(stripCodeSpans("Add the `some_guard")).toBe("Add the `some_guard");
  });
});
