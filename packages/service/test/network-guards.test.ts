/**
 * Static network guards (PRD §16 Privacy).
 *
 * 1. Shipped web assets contain no fetchable `http(s)://` URL to a
 *    non-local host: `public/` always, plus `packages/web/dist` after a
 *    build (skipped when dist is absent — run `mise run build` first — or
 *    when dist is older than its sources, i.e. stale after a merge, so
 *    `mise run check` never depends on a stale build).
 *    Only remote-*load* patterns fail (fetch/WS/script/style/import/CSS
 *    url); data strings (React error URLs, mock GitHub link data shown as
 *    user-clicked navigations) are covered by the Playwright network guard.
 * 2. No `fetch`/`http`/`https`/`net`/`tls`/`dgram`/`dns`/WebSocket-client
 *    use in `packages/service/src` outside the explicit allowlist below
 *    (loopback clients, the 127.0.0.1-only server, ACP stdio adapters).
 *    Each entry carries its reason.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(here, "..");
const srcRoot = path.join(serviceRoot, "src");
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
 * reflects the sources, and scanning it would blame the wrong code. Callers
 * skip the dist scan (with a warning) when this returns true, so
 * `mise run check` never depends on a stale build; CI builds first, so the
 * scan still runs on fresh output there.
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

describe("static network guards", () => {
  it("public/ has no remote loads (fonts self-hosted, no CDN)", () => {
    const files = listFiles(publicRoot, [".html", ".js", ".webmanifest", ".svg"]);
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      const hits = remoteLoads(text);
      if (hits.length > 0) offenders.push(`${path.relative(webRoot, f)}: ${hits.join(", ")}`);
      // No Google Fonts (or any remote stylesheet) anywhere in public/.
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text)) {
        offenders.push(`${path.relative(webRoot, f)}: google fonts reference`);
      }
    }
    expect(offenders, "remote loads in packages/web/public").toEqual([]);
  });

  it("dist/ (when built and fresh) has no remote loads", () => {
    const indexFile = path.join(distRoot, "index.html");
    if (!fs.existsSync(indexFile)) {
      console.warn("skip: web dist not built (run `mise run build` first)");
      return;
    }
    if (isDistStale(indexFile, path.join(webRoot, "src"), publicRoot)) {
      console.warn("skip: web dist is older than its sources (stale after a merge; rebuild first)");
      return;
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

  it("service src uses network APIs only on the allowlist", () => {    // file (relative to src) → allowed import/use patterns + reason.
    const allowlist: { file: string; patterns: RegExp[]; reason: string }[] = [
      {
        file: "cli/doctor.ts",
        patterns: [/node:net/, /node:http/],
        reason: "loopback port check (net.connect to 127.0.0.1) + service diagnostics fetch (http.get to 127.0.0.1 /api/diagnostics only, issue #20)",
      },
      {
        file: "cli/lock.ts",
        patterns: [/node:http/],
        reason: "loopback health probe (http.get to 127.0.0.1 /api/health only)",
      },
      {
        file: "update/helper-entry.ts",
        patterns: [/node:http/],
        reason: "switch helper's loopback health probe (http.get to 127.0.0.1 /api/health only, same as cli/lock.ts)",
      },
      {
        file: "mcp/registry.ts",
        patterns: [/node:http/],
        reason: "MCP server handler types only (listens via Fastify on 127.0.0.1; no client)",
      },
      {
        file: "server.ts",
        patterns: [/fastify/, /@fastify\/websocket/],
        reason: "HTTP+WS server bound to 127.0.0.1 only (listens; no client)",
      },
      {
        file: "agent/acp/connection.ts",
        patterns: [/@agentclientprotocol\/sdk/],
        reason: "ACP stdio subprocesses (adapters spawn claude/codex CLIs; no sockets)",
      },
    ];
    const NETWORK_RE =
      /node:(http|https|net|tls|dgram|dns)|from ["']ws["']|require\(["']ws["']|@agentclientprotocol\/|fastify|@fastify\/|[^._a-zA-Z]fetch\s*\(/;
    const offenders: string[] = [];
    for (const f of listFiles(srcRoot, [".ts"])) {
      // ACP adapters are subprocesses by design (allowed as a directory).
      if (f.includes(`${path.sep}agent${path.sep}acp${path.sep}`)) continue;
      const rel = path.relative(srcRoot, f);
      const text = fs.readFileSync(f, "utf8");
      // Code lines only: skip comments and type-only imports (no runtime
      // network). Mentions in doc comments (e.g. "@agentclientprotocol")
      // and `import type { FastifyInstance }` carry no runtime.
      const codeLines = text.split("\n").filter((line) => {
        const t = line.trim();
        if (t.startsWith("*") || t.startsWith("//")) return false;
        if (/^\s*import\s+type\b/.test(line)) return false;
        return true;
      });
      const code = codeLines.join("\n");
      if (!NETWORK_RE.test(code)) continue;
      const entry = allowlist.find((a) => a.file === rel);
      if (!entry) {
        offenders.push(`${rel}: network API outside the allowlist`);
        continue;
      }
      // Every network-looking token in code must match an allowed pattern.
      codeLines.forEach((line, i) => {
        if (NETWORK_RE.test(line) && !entry.patterns.some((p) => p.test(line))) {
          offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders, "network API use outside the allowlist (see reasons in this test)").toEqual([]);
    // The allowlist itself is the documentation; assert it is non-empty.
    expect(allowlist.length).toBeGreaterThan(0);
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
