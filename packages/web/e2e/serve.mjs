// Minimal static server for e2e: serves packages/web/dist with SPA fallback.
// Portable (macOS + Linux): only node:http, node:fs, node:path.
/* global process: readonly, URL: readonly, console: readonly */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.E2E_PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let file = path.normalize(path.join(root, url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) file = path.join(file, "index.html");
    if (err || !stat?.isFile()) {
      // SPA fallback: client routes render from index.html.
      if (req.method === "GET" && !path.extname(url.pathname)) {
        file = path.join(root, "index.html");
      } else {
        res.writeHead(404);
        res.end("not found");
        return;
      }
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      res.end(data);
    });
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`e2e server on http://127.0.0.1:${port}/ serving ${root}`);
});
