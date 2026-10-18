// DISABLED(#188): pins site asset pin
/**
 * Front-door page checks (issue #150). Fast: pure file reads, no build.
 *
 * 1. The page's install commands match `README.md` (one of them is the
 *    source of truth only by convention — this test keeps them in step).
 * 2. The page loads nothing from third parties: no scripts, no remote
 *    loads of any kind. The only absolute URLs allowed are the
 *    documented ones (the local instance link, the repository links).
 * 3. `site/` stays out of the npm package (served by Pages, not npm).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const siteDir = path.join(root, "site");

function readSite(name: string): string {
  return fs.readFileSync(path.join(siteDir, name), "utf8");
}

/** The commands a user runs from the page; each must read identically in the README. */
const INSTALL_COMMANDS = [
  "npm install -g github:indigoviolet/unvibe#release",
  "unvibe setup",
  "unvibe update <channel>",
  "unvibe setup --uninstall",
  "unvibe doctor",
];

describe("front-door install commands match the README", () => {
  it("every command appears in both files", () => {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    // The page escapes `<channel>` as `&lt;channel&gt;`; compare decoded.
    const page = readSite("index.html")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    expect(page.length).toBeGreaterThan(0);
    for (const cmd of INSTALL_COMMANDS) {
      expect(readme, `README.md misses: ${cmd}`).toContain(cmd);
      expect(page, `site/index.html misses: ${cmd}`).toContain(cmd);
    }
  });

  it("the Open link points at the local instance (no token anywhere)", () => {
    const page = readSite("index.html");
    expect(page).toContain("http://unvibe.localhost:4517");
    expect(page).not.toMatch(/token=[A-Za-z0-9]/);
    expect(page).not.toMatch(/[0-9a-f]{32,}/);
  });
});

describe("front-door loads nothing third-party", () => {
  it("no scripts, no remote loads", () => {
    const html = readSite("index.html");
    const css = readSite("styles.css");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/@import/i);
    expect(css).not.toMatch(/@import/i);
    // Remote URL loads (fetch/WS/script/style/img/import/CSS url).
    for (const [name, text] of [["index.html", html], ["styles.css", css]] as const) {
      for (const m of text.match(/https?:\/\/[^\s"'<>)]+/g) ?? []) {
        expect(
          m,
          `${name}: remote URL ${m}`,
        ).toMatch(/^http:\/\/unvibe\.localhost:4517(\/|$)|^https:\/\/github\.com\/indigoviolet\/unvibe(\/|$)/);
      }
      expect(text, `${name}: remote url()`).not.toMatch(/url\(\s*["']?https?:\/\//i);
      expect(text, `${name}: remote stylesheet`).not.toMatch(/<link[^>]+href\s*=\s*["']https?:\/\//i);
      expect(text, `${name}: remote image`).not.toMatch(/<img[^>]+src\s*=\s*["']https?:\/\//i);
    }
    // No analytics / fonts / CDNs / badges by name, anywhere in site/.
    for (const f of fs.readdirSync(siteDir)) {
      const text = fs.readFileSync(path.join(siteDir, f), "utf8");
      expect(text, f).not.toMatch(/googletagmanager|google-analytics|fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr|shields\.io/i);
    }
  });

  it("images are same-site files", () => {
    const html = readSite("index.html");
    const srcs = [...html.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) {
      expect(src, `remote image: ${src}`).not.toMatch(/^[a-z]+:/i);
      expect(fs.existsSync(path.join(siteDir, src)), `missing image: ${src}`).toBe(true);
    }
  });
});

describe("front-door stays out of the npm package", () => {
  it("the release tree copies no site/ files", () => {
    const release = fs.readFileSync(path.join(root, "scripts", "release.mjs"), "utf8");
    expect(release).not.toMatch(/["']site\//);
  });
});
