/**
 * Code-block language fallback (issue #255): fence tags map to the shipped
 * Shiki set, everything else stays plain text.
 */
import { afterEach, describe, expect, it } from "vitest";
import { normalizeCodeLanguage } from "./language.js";
import { highlightCodeBlock, resetHighlightForTests } from "./shiki.js";

afterEach(() => resetHighlightForTests());

describe("normalizeCodeLanguage", () => {
  it("maps fence tags and aliases to shipped languages", () => {
    expect(normalizeCodeLanguage("python")).toBe("python");
    expect(normalizeCodeLanguage("py")).toBe("python");
    expect(normalizeCodeLanguage("js")).toBe("javascript");
    expect(normalizeCodeLanguage("javascript")).toBe("javascript");
    expect(normalizeCodeLanguage("ts")).toBe("typescript");
    expect(normalizeCodeLanguage("tsx")).toBe("tsx");
    expect(normalizeCodeLanguage("jsx")).toBe("jsx");
    expect(normalizeCodeLanguage("json")).toBe("json");
    expect(normalizeCodeLanguage("sh")).toBe("bash");
    expect(normalizeCodeLanguage("bash")).toBe("bash");
    expect(normalizeCodeLanguage("yml")).toBe("yaml");
    expect(normalizeCodeLanguage("md")).toBe("markdown");
    expect(normalizeCodeLanguage("css")).toBe("css");
    expect(normalizeCodeLanguage("html")).toBe("html");
    expect(normalizeCodeLanguage("toml")).toBe("toml");
  });

  it("is case-insensitive and trims", () => {
    expect(normalizeCodeLanguage("Python")).toBe("python");
    expect(normalizeCodeLanguage("  TS  ")).toBe("typescript");
  });

  it("returns null for missing or unknown languages (plain render)", () => {
    expect(normalizeCodeLanguage(undefined)).toBeNull();
    expect(normalizeCodeLanguage("")).toBeNull();
    expect(normalizeCodeLanguage("text")).toBeNull();
    expect(normalizeCodeLanguage("go")).toBeNull();
    expect(normalizeCodeLanguage("rust")).toBeNull();
    expect(normalizeCodeLanguage("diff")).toBeNull();
    expect(normalizeCodeLanguage("mermaid")).toBeNull();
  });
});

describe("highlightCodeBlock fallback", () => {
  it("highlights a shipped language and stays plain otherwise", async () => {
    const out = await highlightCodeBlock("python", 'def main():\n    return 1\n');
    expect(out).not.toBeNull();
    expect(out!.some((r) => r !== null)).toBe(true);

    expect(await highlightCodeBlock("go", "package main\n")).toBeNull();
    expect(await highlightCodeBlock(undefined, "some code\n")).toBeNull();
    expect(await highlightCodeBlock("", "some code\n")).toBeNull();
  });
});
