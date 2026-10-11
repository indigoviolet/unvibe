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
 * - dynamic (needs `mise run build` first; skipped visibly otherwise, like
 *   the D2 specs): `--print-notices` output covers every bundled web
 *   package, every shipped font asset, and every fixture file, with the
 *   licence texts that require inclusion.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..", "..", "..");
const RELEASE_SCRIPT = path.join(ROOT, "scripts", "release.mjs");
const WEB_META = path.join(ROOT, "packages", "web", "dist", "web-meta.json");
const SERVICE_META = path.join(ROOT, "packages", "service", "dist", "meta.json");
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

/** `name` for a `node_modules/...` module id (same rule as release.mjs). */
function pkgOfModuleId(id: string): string {
  const last = id.split("node_modules/").pop() ?? id;
  const segs = last.split("/");
  return last.startsWith("@") ? `${segs[0]}/${segs[1]}` : segs[0];
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

const hasBuild = fs.existsSync(WEB_META) && fs.existsSync(SERVICE_META);

describe.skipIf(!hasBuild)("third-party notices match the current build", () => {
  function notices(): string {
    const r = spawnSync(process.execPath, [RELEASE_SCRIPT, "--print-notices"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(r.status).toBe(0);
    return r.stdout ?? "";
  }

  it("covers every npm package compiled into the web build", () => {
    const text = notices();
    const meta = JSON.parse(read(WEB_META)) as { inputs?: Record<string, object> };
    const pkgs = new Map<string, string>();
    for (const id of Object.keys(meta.inputs ?? {})) {
      if (!id.includes("node_modules/")) continue;
      pkgs.set(pkgOfModuleId(id), id);
    }
    expect(pkgs.size).toBeGreaterThan(0);
    for (const [name] of pkgs) {
      const pj = JSON.parse(read(path.join(ROOT, "node_modules", name, "package.json"))) as {
        version?: string;
        license?: string;
      };
      expect(text).toContain(`| ${name} | ${pj.version ?? "?"} | ${pj.license ?? "?"} |`);
      expect(text).toContain("web dist/assets");
    }
  });

  it("includes the licence texts that require inclusion", () => {
    const text = notices();
    const meta = JSON.parse(read(WEB_META)) as { inputs?: Record<string, object> };
    const names = new Set<string>();
    for (const id of Object.keys(meta.inputs ?? {})) {
      if (id.includes("node_modules/")) names.add(pkgOfModuleId(id));
    }
    const licences = new Map<string, string>();
    for (const name of names) {
      const pj = JSON.parse(read(path.join(ROOT, "node_modules", name, "package.json"))) as { license?: string };
      licences.set(name, pj.license ?? "?");
    }
    // New licences fail here on purpose: extending the bundle with a
    // licence the notices do not reproduce must be a conscious decision.
    const handled = new Set(["MIT", "OFL-1.1", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
    for (const [name, licence] of licences) {
      expect(handled.has(licence), `${name} uses ${licence}: extend the notices`).toBe(true);
    }
    for (const [name, licence] of licences) {
      if (licence === "MIT") {
        expect(text).toContain(`${name}@`);
        expect(text).toContain("## Web bundle MIT licences");
      }
      if (licence === "OFL-1.1") {
        expect(text).toContain("## Web fonts (SIL Open Font License 1.1)");
      }
    }
    expect(text).toContain("SIL OPEN FONT LICENSE");
    expect(text).toContain("Copyright 2019 IBM Corp");
    expect(text).toContain("Copyright 2017 IBM Corp");
    expect(text).toContain("Google Inc.");
  });

  it("lists every shipped font asset", () => {
    const text = notices();
    const assets = fs
      .readdirSync(path.join(ROOT, "packages", "web", "dist", "assets"))
      .filter((e) => e.endsWith(".woff") || e.endsWith(".woff2"))
      .sort();
    expect(assets.length).toBeGreaterThan(0);
    for (const a of assets) {
      expect(text).toContain(`packages/web/dist/assets/${a}`);
    }
  });

  it("lists every fixture file with attribution and the urllib3 licence", () => {
    const text = notices();
    for (const f of listRecursive(FIXTURE)) {
      expect(text).toContain(`fixtures/urllib3-5020/${f}`);
    }
    expect(text).toContain("https://github.com/urllib3/urllib3/pull/5020");
    expect(text).toContain("Copyright (c) 2008-2020 Andrey Petrov and contributors.");
    // D2-embedded subsets + Unvibe's own licence pointer.
    expect(text).toContain("Source Sans Pro");
    expect(text).toContain("Reserved Font Name 'Source'");
    expect(text).toContain("Unvibe's own licence");
  });
});
