/** #322: deep-link parser + extension origin allowlist (pure). */
import { describe, expect, it } from "vitest";
import {
  PINNED_EXTENSION_ID,
  extensionOrigin,
  isAllowedExtensionOrigin,
  isExtensionId,
  openPrPath,
  parseOpenPrUrl,
} from "../src/extension.js";

describe("parseOpenPrUrl", () => {
  it("parses a canonical PR URL", () => {
    expect(parseOpenPrUrl("https://github.com/acme/app/pull/123")).toEqual({
      owner: "acme",
      name: "app",
      prNumber: 123,
      url: "https://github.com/acme/app/pull/123",
    });
  });
  it("ignores PR subpaths like /files", () => {
    expect(parseOpenPrUrl("https://github.com/acme/app/pull/7/files").prNumber).toBe(7);
    expect(parseOpenPrUrl("https://github.com/acme/app/pull/7/commits/abc").url).toBe(
      "https://github.com/acme/app/pull/7",
    );
  });
  it("rejects non-PR inputs", () => {
    for (const bad of [
      "",
      "   ",
      "https://github.com/acme/app",
      "https://github.com/acme/app/issues/3",
      "https://evil.example/acme/app/pull/3",
      "https://github.com/acme/app/pull/0",
      "https://github.com/acme/app/pull/abc",
      "not a url",
    ]) {
      expect(() => parseOpenPrUrl(bad), bad).toThrow();
    }
    expect(() => parseOpenPrUrl(null)).toThrow();
    expect(() => parseOpenPrUrl(undefined)).toThrow();
  });
});

describe("extension origin allowlist", () => {
  it("the pinned id is a well-formed extension id", () => {
    expect(isExtensionId(PINNED_EXTENSION_ID)).toBe(true);
    expect(extensionOrigin(PINNED_EXTENSION_ID)).toBe(
      `chrome-extension://${PINNED_EXTENSION_ID}`,
    );
  });
  it("accepts only the exact allowlisted origin", () => {
    const good = extensionOrigin(PINNED_EXTENSION_ID);
    expect(isAllowedExtensionOrigin(good, [PINNED_EXTENSION_ID])).toBe(true);
    expect(isAllowedExtensionOrigin([good], [PINNED_EXTENSION_ID])).toBe(true);
    for (const bad of [
      "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "chrome-extension://*",
      `${good}/`,
      `${good}/page.html`,
      `https://${PINNED_EXTENSION_ID}`,
      good.toUpperCase(),
      "",
      undefined,
    ]) {
      expect(isAllowedExtensionOrigin(bad, [PINNED_EXTENSION_ID]), String(bad)).toBe(false);
    }
    // A well-formed but unlisted id, and an empty allowlist, both fail.
    expect(
      isAllowedExtensionOrigin(good, ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]),
    ).toBe(false);
    expect(isAllowedExtensionOrigin(good, [])).toBe(false);
    expect(isExtensionId("not-an-id")).toBe(false);
    expect(isExtensionId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
  });
});

describe("openPrPath", () => {
  it("encodes the PR URL", () => {
    expect(openPrPath("https://github.com/acme/app/pull/7")).toBe(
      "/open?pr=https%3A%2F%2Fgithub.com%2Facme%2Fapp%2Fpull%2F7",
    );
  });
});
