// DISABLED(#188): pins notices coverage pin
/**
 * Third-party notices staleness guard (issue #14).
 *
 * `scripts/release.mjs` generates `THIRD-PARTY-NOTICES.md` at release time.
 * These tests fail when the web build or the demo fixture gains a
 * dependency or asset the notices do not cover, so the file cannot
 * silently go stale:
 *
 * - static (always runs, no build needed): the release script generates
 *   the web rows from the Vite/Rollup module list (`web-meta.json`, never
 *   a hand-kept list); every file in `fixtures/urllib3-5020/` falls into a
 *   category the notices enumerate (top-level doc/snapshot files,
 *   `recordings/*.md`, `diagrams/*.svg`); the script covers fonts, the
 *   fixture, D2 subsets and Unvibe's own licence.
 * - dynamic (slow suite, `release-notices.slow.test.ts`, needs
 *   `mise run build` first): `--print-notices` output covers every bundled
 *   web package, every shipped font asset, and every fixture file, with
 *   the licence texts that require inclusion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const RELEASE_SCRIPT = path.join(ROOT, "scripts", "release.mjs");
const FIXTURE = path.join(ROOT, "fixtures", "urllib3-5020");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

/** All files under `dir`, as posix-style paths relative to `dir`. */
function listRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

describe("third-party notices coverage", () => {
  it("web rows come from the build module list, not a hand-kept list", () => {
    const script = read(RELEASE_SCRIPT);
    expect(script).toContain("web-meta.json");
    expect(script).toContain("@fontsource");
    // The web bundle label the table uses.
    expect(script).toContain("web dist/assets");
    const vite = read(path.join(ROOT, "packages", "web", "vite.config.ts"));
    expect(vite).toContain("web-meta.json");
    expect(vite).toContain("getModuleIds");
  });

  it("every fixture file falls into a notices-enumerated category", () => {
    const files = listRecursive(FIXTURE);
    expect(files.length).toBeGreaterThan(0);
    const bad = files.filter((f) => {
      if (/^[^/]+\.(md|json)$/.test(f)) return false; // top-level doc/snapshot files
      if (/^recordings\/[^/]+\.md$/.test(f)) return false;
      if (/^diagrams\/[^/]+\.svg$/.test(f)) return false;
      return true;
    });
    expect(bad, `fixture files outside the notices categories: ${bad.join(", ")}`).toEqual([]);
  });

  it("release script covers fonts, fixture, D2 subsets and Unvibe's licence", () => {
    const script = read(RELEASE_SCRIPT);
    // (a) web deps + (b) fonts.
    expect(script).toContain("SIL OPEN FONT LICENSE");
    // (c) fixture attribution + urllib3 licence as it actually is (MIT).
    expect(script).toContain("urllib3/urllib3/pull/5020");
    expect(script).toContain("Andrey Petrov");
    // (d) D2-embedded subsets.
    expect(script).toContain("Source Sans Pro");
    expect(script).toContain("Adobe Systems Incorporated");
    // (e) Unvibe's own MIT LICENCE, shipped separately.
    expect(script).toContain("Unvibe's own licence");
    expect(script).toContain("LICENSE");
  });
});