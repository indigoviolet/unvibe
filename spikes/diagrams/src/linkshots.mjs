/**
 * Screenshot one good link-convention output per kind (light + dark).
 * Usage: node src/linkshots.mjs
 * Reads out/link/shot-<kind>.<light|dark>.svg, screenshots the inline
 * SVG with Playwright chromium into out/link-<kind>.<light|dark>.png
 * (beside the prototype references).
 */
import http from "node:http";
import fs from "node:fs";
import { chromium } from "@playwright/test";

const KINDS = ["flow", "fold", "seq"];
const server = http.createServer((req, res) => {
  const m = req.url.match(/^\/shot-(flow|fold|seq)\.(light|dark)\.svg$/);
  if (!m) { res.writeHead(404); res.end("nf"); return; }
  const svg = fs.readFileSync(`out/link/shot-${m[1]}.${m[2]}.svg`, "utf8");
  const bg = m[2] === "dark" ? "#0d1117" : "#ffffff";
  const html = `<!doctype html><html><body style="margin:0;background:${bg}"><div id="shot" style="width:860px">${svg}</div></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch();
for (const k of KINDS) {
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    await page.goto(`http://127.0.0.1:${port}/shot-${k}.${theme}.svg`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    const el = page.locator("#shot");
    await el.screenshot({ path: `out/link-${k}.${theme}.png` });
    console.log(`out/link-${k}.${theme}.png`, errors.length ? `ERRORS: ${errors.join(";")}` : "ok");
    await page.close();
  }
}
await browser.close();
server.close();
