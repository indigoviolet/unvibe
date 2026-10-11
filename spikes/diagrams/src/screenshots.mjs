/**
 * Serve the gallery on 127.0.0.1 (in-process server, killed on exit) and
 * screenshot every candidate section with Playwright, light + dark.
 * Records: console errors, non-local request attempts, CSP violations
 * (under a strict policy), and per-candidate render stats from the page.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json", ".wasm": "application/wasm" };

function serve(csp) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file;
    if (url.pathname.startsWith("/nm/")) file = path.join(ROOT, "node_modules", url.pathname.slice(4));
    else if (url.pathname === "/excalidraw-bundle.js") file = path.join(ROOT, "out/excalidraw-bundle.js");
    else file = path.join(ROOT, "out", url.pathname.slice(1));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end("nf"); return; }
      const h = { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" };
      if (file.endsWith(".html") && csp) h["Content-Security-Policy"] = STRICT_CSP;
      res.writeHead(200, h);
      res.end(data);
    });
  });
}

const SECTIONS = ["proto-flow", "proto-fold", "b-flow", "b-panels", "b-seq", "d2-flow", "d2-fold",
  "d2-seq", "gv-flow", "mmd-flow", "mmd-fold", "mmd-seq", "exc-flow-hand", "exc-flow-clean", "preview-400"];

const mode = process.argv[2] ?? "all"; // all | strict
const cspModes = mode === "strict" ? ["strict"] : ["open", "strict"];

for (const csp of cspModes) {
  const server = serve(csp === "strict");
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  console.log(`== server 127.0.0.1:${port} csp=${csp}`);
  const browser = await chromium.launch();
  const results = {};
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 820, height: 900 }, deviceScaleFactor: 2 });
    const nonLocal = [];
    const cspHits = [];
    page.on("console", (m) => {
      if (m.type() === "error") results[`console-${theme}`] = (results[`console-${theme}`] ?? "") + m.text().slice(0, 200) + "\n";
    });
    page.on("pageerror", (e) => { results[`pageerror-${theme}`] = String(e).slice(0, 300); });
    page.on("request", (req) => {
      const u = new URL(req.url());
      if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") nonLocal.push(`${req.method()} ${u.origin}${u.pathname}`);
    });
    await page.exposeFunction("__csp", (v) => cspHits.push(v));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__csp(`${e.violatedDirective}|${(e.blockedURI || "").slice(0, 80)}|${(e.sample || "").slice(0, 60)}`);
      });
    });
    await page.goto(`http://127.0.0.1:${port}/gallery.${theme}.html`);
    try {
      await page.waitForFunction(() => window.__done === true, { timeout: 90000 });
    } catch { results[`timeout-${theme}`] = "render did not finish"; }
    await page.waitForTimeout(800);
    const metas = await page.$$eval("[data-meta-for]", (els) => els.map((e) => `${e.dataset.metaFor}: ${e.textContent}`));
    results[`meta-${theme}`] = metas;
    results[`csp-${theme}`] = cspHits;
    results[`nonlocal-${theme}`] = [...new Set(nonLocal)];
    fs.mkdirSync("out", { recursive: true });
    for (const s of SECTIONS) {
      const loc = page.locator(`#${s}`);
      if ((await loc.count()) === 0) continue;
      await loc.screenshot({ path: `out/${s}.${theme}${csp === "strict" ? ".strict" : ""}.png` });
    }
    await page.close();
  }
  await browser.close();
  await new Promise((r) => server.close(r));
  fs.writeFileSync(`out/measurements.${csp}.json`, JSON.stringify(results, null, 2));
  console.log(`wrote out/measurements.${csp}.json`);
  for (const k of Object.keys(results)) {
    if (k.startsWith("meta-")) { console.log(`--- ${k} (csp=${csp})`); for (const m of results[k]) console.log("  " + m); }
    else console.log(`${k}:`, JSON.stringify(results[k]).slice(0, 600));
  }
}
