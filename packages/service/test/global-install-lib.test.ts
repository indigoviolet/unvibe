/**
 * Global-install check helpers (issue #157): the bundled-platform-binary
 * assertion must name the current platform's packages (simulated here by
 * injecting platform/arch, so macOS is covered from a Linux runner), and
 * the grammar check must distinguish a real parser load from the
 * heuristic fallback. Pure `scripts/global-install-lib.mjs` units.
 */
import { describe, expect, it } from "vitest";
import { isParserOutline, platformBinaryPackages } from "../../../scripts/global-install-lib.mjs";

describe("platformBinaryPackages (issue #157)", () => {
  it("names the macOS packages on darwin, not the Linux ones", () => {
    expect(platformBinaryPackages("darwin", "arm64")).toEqual([
      "@openai/codex-darwin-arm64",
      "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    ]);
    expect(platformBinaryPackages("darwin", "x64")).toEqual([
      "@openai/codex-darwin-x64",
      "@anthropic-ai/claude-agent-sdk-darwin-x64",
    ]);
  });

  it("names the Linux and Windows packages on those platforms", () => {
    expect(platformBinaryPackages("linux", "x64")).toEqual([
      "@openai/codex-linux-x64",
      "@anthropic-ai/claude-agent-sdk-linux-x64",
    ]);
    expect(platformBinaryPackages("win32", "x64")).toEqual([
      "@openai/codex-win32-x64",
      "@anthropic-ai/claude-agent-sdk-win32-x64",
    ]);
  });

  it("defaults to the running platform", () => {
    expect(platformBinaryPackages()).toEqual(platformBinaryPackages(process.platform, process.arch));
  });
});

describe("isParserOutline (issue #157)", () => {
  it("accepts only a parser chain, never the fallback", () => {
    expect(isParserOutline({ how: "parser", chain: [{ kind: "function_definition", name: "get", start: 4, end: 5 }] })).toBe(true);
    expect(isParserOutline({ how: "heuristic", chain: [{ kind: "block", name: "", start: 3, end: 4 }] })).toBe(false);
    expect(isParserOutline({ how: "parser", chain: [] })).toBe(false);
    expect(isParserOutline({ how: "none", chain: [] })).toBe(false);
    expect(isParserOutline(null)).toBe(false);
    expect(isParserOutline("parser")).toBe(false);
  });
});
