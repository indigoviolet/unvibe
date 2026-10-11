/**
 * D2 browser CSP probe: import the 11MB browser build under a strict CSP
 * (no wasm-unsafe-eval) and under a permissive one; record violations,
 * network requests, and whether compile+render works.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const STRICT = "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";
const WASM_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; font-src 'self' data:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'";

const pageHtml = `<!doctype html><html><body><p id="meta">pending</p><script type="module" src="/d2-probe.js"></` + `script></body></html>`;

for (const [name, csp] of [["strict", STRICT], ["wasm-allow", WASM_CSP]]) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/nm/")) {
      const f = path.join(ROOT, "node_modules", url.pathname.slice(4));
      fs.readFile(f, (e, d) => { res.writeHead(e ? 404 : 200, { "Content-Type": "text/javascript" }); res.end(e ? "nf" : d); });
      return;
    }
    if (url.pathname === "/d2-probe.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(fs.readFileSync(path.join(ROOT, "out/d2-probe.js")));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": csp });
    res.end(pageHtml);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const hits = [];
  const nonLocal = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window.__v = window.__v || []).push(`${e.violatedDirective}|${(e.blockedURI || "").slice(0, 40)}`);
    });
  });
  page.on("request", (q) => {
    const u = new URL(q.url());
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") nonLocal.push(u.origin + u.pathname);
  });
  page.on("pageerror", (e) => hits.push("pageerror:" + String(e).slice(0, 150)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => document.getElementById("meta").textContent !== "pending", { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(`== ${name}:`, await page.$eval("#meta", (e) => e.textContent));
  console.log(`   csp:`, JSON.stringify(await page.evaluate(() => window.__v || [])));
  console.log(`   nonlocal:`, JSON.stringify([...new Set(nonLocal)]));
  console.log(`   extra:`, JSON.stringify(hits.slice(0, 4)));
  await browser.close();
  await new Promise((r) => server.close(r));
}
