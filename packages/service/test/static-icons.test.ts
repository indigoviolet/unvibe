/**
 * Served-icon wiring (issue #299): the favicon set linked from the app
 * shell must be servable without a token (tab/subwindow icon requests
 * carry no token), and every icon-ish allowlist entry must match a real
 * file in packages/web/public. Fast: asserts on the exported set + the
 * checked-in files, no app boot.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_STATIC_EXACT } from "../src/server.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..");
const publicRoot = path.resolve(serviceRoot, "..", "web", "public");
const webIndex = path.resolve(serviceRoot, "..", "web", "index.html");

describe("served icons", () => {
  it("allowlist contains the favicon set (SVG + 32px + apple-touch)", () => {
    for (const p of ["/icon.svg", "/icon-32.png", "/apple-touch-icon.png"]) {
      expect(PUBLIC_STATIC_EXACT.has(p), p).toBe(true);
    }
  });

  it("every linked icon in the allowlist has a real file in web/public", () => {
    // /favicon.ico is deliberately excluded: it is allowlisted for the
    // browser's default request (pre-existing), not linked from the shell.
    const missing: string[] = [];
    for (const p of PUBLIC_STATIC_EXACT) {
      if (!p.startsWith("/icon") && !p.startsWith("/apple-touch")) continue;
      if (!fs.existsSync(path.join(publicRoot, p.slice(1)))) missing.push(p);
    }
    expect(missing, "allowlisted icons with no file").toEqual([]);
  });

  it("every absolute icon href in web/index.html is allowlisted (loads tokenless)", () => {
    const html = fs.readFileSync(webIndex, "utf8");
    const hrefs = [...html.matchAll(/<link[^>]+rel="(?:icon|apple-touch-icon)"[^>]+href="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(hrefs.length).toBeGreaterThan(0);
    const blocked = hrefs.filter((h) => h.startsWith("/") && !PUBLIC_STATIC_EXACT.has(h.split("?")[0]));
    expect(blocked, "icon hrefs the service would 401").toEqual([]);
  });

  it("keeps the shell and API gated", () => {
    for (const p of ["/", "/index.html", "/api/health"]) {
      expect(PUBLIC_STATIC_EXACT.has(p), p).toBe(false);
    }
  });
});
