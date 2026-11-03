/**
 * Issue #350: the shipped extension's version is stamped from Unvibe's
 * version at build time (`scripts/release.mjs` + `extension-version-lib.mjs`).
 * Derivation-rule units plus the guard that the source manifest keeps its
 * `0.0.0` placeholder (no hand-edited version, no version_name — the build
 * stamps both). No network, no git runs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extensionVersion,
  fnv1a32,
  isChromeExtensionVersion,
} from "../../../scripts/extension-version-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("isChromeExtensionVersion", () => {
  it("accepts 1–4 dot-separated integers in range", () => {
    for (const v of ["0", "1", "0.0.15", "0.0.0", "1.2.3.4", "0.0.15.65535", "65535.65535.65535.65535"]) {
      expect(isChromeExtensionVersion(v), v).toBe(true);
    }
  });
  it("rejects non-Chrome shapes", () => {
    for (const v of ["", "0.2.0-preview", "0.0.15-preview.main-rc.abc1234", "1.2.3.4.5", "1.2.65536", "01.2.3", "v1.2.3", "1..2", "a.b.c"]) {
      expect(isChromeExtensionVersion(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe("extensionVersion", () => {
  it("maps a release version through unchanged", () => {
    expect(extensionVersion("0.0.15")).toEqual({ version: "0.0.15", version_name: "0.0.15" });
    expect(extensionVersion("1.2.3")).toEqual({ version: "1.2.3", version_name: "1.2.3" });
  });
  it("maps a preview version to base + deterministic numeric fourth part", () => {
    const full = "0.0.15-preview.main-rc.abc1234";
    const got = extensionVersion(full);
    expect(got.version_name).toBe(full);
    expect(isChromeExtensionVersion(got.version)).toBe(true);
    expect(got.version).toMatch(/^0\.0\.15\.\d+$/);
    expect(got.version).toBe(`0.0.15.${(fnv1a32(full) % 65534) + 1}`);
    // Deterministic: same input, same output.
    expect(extensionVersion(full)).toEqual(got);
  });
  it("sorts any preview above its base release and separates distinct previews", () => {
    const base = extensionVersion("0.0.15").version;
    const a = extensionVersion("0.0.15-preview.main-rc.abc1234").version;
    const b = extensionVersion("0.0.15-preview.fix-350-extension-version.def5678").version;
    // Fourth part >= 1 beats the missing fourth part (= 0) of the release.
    for (const v of [a, b]) expect(Number(v.split(".")[3])).toBeGreaterThanOrEqual(1);
    expect(new Set([base, a, b]).size).toBe(3);
  });
  it("maps other prerelease shapes (rc tags) the same way", () => {
    const got = extensionVersion("0.0.16-rc.1");
    expect(got.version_name).toBe("0.0.16-rc.1");
    expect(got.version).toMatch(/^0\.0\.16\.\d+$/);
    expect(isChromeExtensionVersion(got.version)).toBe(true);
  });
  it("edge cases: zero parts, max Chrome part, strips no zeros from the base", () => {
    expect(extensionVersion("0.0.0")).toEqual({ version: "0.0.0", version_name: "0.0.0" });
    expect(extensionVersion("65535.65535.65535")).toEqual({
      version: "65535.65535.65535",
      version_name: "65535.65535.65535",
    });
  });
  it("throws on non-versions and out-of-range base parts", () => {
    for (const bad of ["", "1.2", "1.2.3.4", "v0.0.15", "0.0.15-preview..x", "abc"]) {
      expect(() => extensionVersion(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => extensionVersion("1.2.65536")).toThrow();
    expect(() => extensionVersion("1.2.65536-preview.x.y")).toThrow();
  });
});

describe("source manifest placeholder guard", () => {
  it("source extension/manifest.json keeps the 0.0.0 placeholder with no version_name", () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
    expect(manifest.version).toBe("0.0.0");
    expect(manifest).not.toHaveProperty("version_name");
  });
});
