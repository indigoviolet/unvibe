/**
 * Browser render pass: feed every saved candidate-A (mermaid) output RAW
 * (link tokens intact, as the app would render) through mermaid.render.
 * Usage: node src/validate-mmd.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const ROOT = process.cwd();
const files = fs.readdirSync("out/rel").filter((f) => /-(A)-\d\.txt$/.test(f));
const sources = {};
for (const f of files) {
  const text = fs.readFileSync(path.join("out/rel", f), "utf8");
  const m = text.match(/```mermaid\s*\n([\s\S]*?)```/);
  sources[f] = m ? m[1].trim() : null;
}

const pageHtml = `<!doctype html><html><body><div id="t"></div><script type="module">
import mermaid from "/nm/mermaid/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: false });
const SOURCES = ${JSON.stringify(sources)};
const out = {};
for (const [k, src] of Object.entries(SOURCES)) {
  if (!src) { out[k] = "NO-BLOCK"; continue; }
  try {
    const { svg } = await mermaid.render("id-" + k.replace(/[^a-z0-9]/gi, ""), src);
    out[k] = "OK bytes=" + svg.length + " srclen=" + (src ? src.length : -1);
  } catch (e) { out[k] = "RENDER-ERR " + String((e && e.message) || e).slice(0, 220); }
}
document.title = "DONE";
await fetch("/report", { method: "POST", body: JSON.stringify(out) });
</script></body></html>`;

let report = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/report" && req.method === "POST") {
    let b = "";
    req.on("data", (d) => { b += d; });
    req.on("end", () => { report = JSON.parse(b); res.writeHead(200); res.end("ok"); });
    return;
  }
  if (url.pathname.startsWith("/nm/")) {
    const f = path.join(ROOT, "node_modules", url.pathname.slice(4));
    fs.readFile(f, (e, d) => { res.writeHead(e ? 404 : 200, { "Content-Type": "text/javascript" }); res.end(e ? "nf" : d); });
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(pageHtml);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.title === "DONE", { timeout: 120000 }).catch(() => {});
await browser.close();
server.close();
console.log(`checked ${Object.keys(sources).length} mermaid outputs`);
let ok = 0;
for (const [k, v] of Object.entries(report ?? {})) {
  console.log(k, v, "| srchead:", JSON.stringify((sources[k]||"").slice(0,60)));
  if (v.startsWith("OK")) ok++;
}
console.log(`render-ok ${ok}/${Object.keys(sources).length}`);
fs.writeFileSync("out/rel/mmd-render.json", JSON.stringify(report, null, 2));
if (errs.length) console.log("pageerrors:", errs.slice(0, 3));
