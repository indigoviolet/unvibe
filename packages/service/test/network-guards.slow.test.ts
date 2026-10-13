/**
 * Static network guard on the built web app (PRD §16 Privacy, issue #119).
 *
 * Slow suite only: scans `packages/web/dist` (after `mise run build`) for
 * fetchable `http(s)://` URLs to non-local hosts — the check that keeps
 * `@sentry/react` out of the build. FAILS when dist is missing or stale,
 * never skips: the slow suite always builds first.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..");
const webRoot = path.resolve(serviceRoot, "..", "web");
const publicRoot = path.join(webRoot, "public");
const distRoot = path.join(webRoot, "dist");

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/** Remote-load patterns: fetch/WS targets, remote scripts/styles/imports, CSS url(). */
const REMOTE_LOAD_RES = [
  /fetch\s*\(\s*["']https?:\/\/(?!127\.0\.0\.1|localhost)/,
  /new\s+(WebSocket|EventSource)\s*\(\s*["'](?:https?|wss?):\/\/(?!127\.0\.0\.1|localhost)/,
  /<script[^>]+src\s*=\s*["']https?:\/\/(?!127\.0\.0\.1|localhost)/i,
  /<link[^>]+href\s*=\s*["']https?:\/\/(?!127\.0\.0\.1|localhost)/i,
  /\bimport\s*\(\s*["']https?:\/\/(?!127\.0\.0\.1|localhost)/,
  /\bfrom\s+["']https?:\/\/(?!127\.0\.0\.1|localhost)/,
  /url\(\s*["']?https?:\/\/(?!127\.0\.0\.1|localhost)/i,
];

function remoteLoads(text: string): string[] {
  return REMOTE_LOAD_RES.filter((re) => re.test(text)).map((re) => String(re));
}

/** Newest mtime (ms) under `dir`, or 0 when unreadable/empty. */
export function newestMtimeMs(dir: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          const t = fs.statSync(full).mtimeMs;
          if (t > newest) newest = t;
        }
      } catch {
        // unreadable entry: ignore
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * True when `dist/index.html` is older than the newest web source file
 * (`src/` or `public/`): a merge can leave a `dist/` that no longer
 * reflects the sources, and scanning it would blame the wrong code.
 */
export function isDistStale(distIndex: string, srcDir: string, publicDir: string): boolean {
  let distMtime = 0;
  try {
    distMtime = fs.statSync(distIndex).mtimeMs;
  } catch {
    return false;
  }
  return Math.max(newestMtimeMs(srcDir), newestMtimeMs(publicDir)) > distMtime;
}

describe("static network guards (built app)", () => {
  it("dist/ (built and fresh) has no remote loads", () => {
    const indexFile = path.join(distRoot, "index.html");
    // The slow suite always builds first: missing or stale is a failure.
    if (!fs.existsSync(indexFile)) {
      throw new Error(`web dist not built: ${indexFile} missing (run \`mise run build\` first)`);
    }
    if (isDistStale(indexFile, path.join(webRoot, "src"), publicRoot)) {
      throw new Error("web dist is older than its sources (stale after a merge; rebuild first)");
    }
    const files = listFiles(distRoot, [".html", ".js", ".css"]);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const hits = remoteLoads(text);
      if (hits.length > 0) offenders.push(`${path.relative(webRoot, f)}: ${hits.join(", ")}`);
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text)) {
        offenders.push(`${path.relative(webRoot, f)}: google fonts reference`);
      }
      // Sentry is dev-server only (issue #29): neither SDK nor DSN is built in.
      if (/sentry/i.test(text)) offenders.push(`${path.relative(webRoot, f)}: sentry reference`);
    }
    expect(offenders, "remote loads in packages/web/dist").toEqual([]);
  });

  it("isDistStale detects a dist older than its sources", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unvibe-dist-stale-"));
    try {
      const src = path.join(root, "src");
      const pub = path.join(root, "public");
      const dist = path.join(root, "dist");
      fs.mkdirSync(src, { recursive: true });
      fs.mkdirSync(pub, { recursive: true });
      fs.mkdirSync(dist, { recursive: true });
      const indexFile = path.join(dist, "index.html");
      fs.writeFileSync(indexFile, "<html></html>");
      // Dist newer than everything: fresh.
      expect(isDistStale(indexFile, src, pub)).toBe(false);
      // A newer source file makes the dist stale.
      const later = new Date(Date.now() + 5000);
      fs.writeFileSync(path.join(src, "app.tsx"), "x");
      fs.utimesSync(path.join(src, "app.tsx"), later, later);
      expect(isDistStale(indexFile, src, pub)).toBe(true);
      // Rebuilt dist (touched newer) is fresh again.
      const newest = new Date(Date.now() + 10_000);
      fs.utimesSync(indexFile, newest, newest);
      expect(isDistStale(indexFile, src, pub)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
