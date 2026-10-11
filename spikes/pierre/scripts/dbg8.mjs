import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "dist");
const CSP = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/csp") {
    const idx = await readFile(join(dir, "index.html"), "utf8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(idx.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`));
    return;
  }
  if (p === "/") p = "/index.html";
  try { const st = await stat(join(dir, p)); if (!st.isFile()) throw 0;
    res.writeHead(200, {"Content-Type": "text/javascript"});
    res.end(await readFile(join(dir, p)));
  } catch { const idx = await readFile(join(dir, "index.html")); res.writeHead(200, {"Content-Type":"text/html"}); res.end(idx); }
});
await new Promise(r => srv.listen(5992, "127.0.0.1", r));
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const viol = [];
page.on("console", m => { if (/securitypolicy|violat/i.test(m.text() + m.location())) viol.push(m.text().slice(0,150)); });
page.on("pageerror", e => console.log("[pageerror]", String(e).slice(0,200)));
await page.goto("http://127.0.0.1:5992/csp#/unified");
await page.waitForTimeout(6000);
console.log("shadow hosts under CSP:", await page.evaluate(() => [...document.querySelectorAll("*")].filter(d => d.shadowRoot).length));
console.log("code cells:", await page.evaluate(() => { const h=[...document.querySelectorAll("*")].find(d=>d.shadowRoot); return h.shadowRoot.querySelectorAll("[data-code]").length; }));
console.log("violations:", JSON.stringify(viol.slice(0,5)));
// long-line structure: overflow/white-space
console.log("wrap:", await page.evaluate(() => {
  const h=[...document.querySelectorAll("*")].find(d=>d.shadowRoot);
  const code=h.shadowRoot.querySelector("[data-code]");
  const cs=getComputedStyle(code);
  return { overflowX: cs.overflowX, whiteSpace: cs.whiteSpace, wordBreak: cs.wordBreak };
}));
// line-number click wiring available?
console.log("lineclick:", await page.evaluate(() => {
  const h=[...document.querySelectorAll("*")].find(d=>d.shadowRoot);
  const num=h.shadowRoot.querySelector("[data-column-number]");
  return { tag: num?.tagName, cursor: getComputedStyle(num).cursor };
}));
await browser.close(); srv.close();
