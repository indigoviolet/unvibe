/**
 * Tiny static file server for the static-demo specs (issue #334).
 *
 * Serves a build directory (the `demo:build` output) over loopback with
 * correct content types. Extensionless non-file paths fall back to
 * `index.html` (harmless under hash routing, and it keeps deep links
 * working); unknown extensions 404.
 */
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export interface StaticServer {
  origin: string;
  stop: () => Promise<void>;
}

export async function startStaticServer(dir: string): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
      let file = path.join(dir, safe);
      if (pathname.endsWith("/") || !path.extname(safe)) {
        const index = path.join(file, "index.html");
        if (existsSync(index)) file = index;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("error");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("static server did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
