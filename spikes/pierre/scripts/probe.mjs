// Functional probe battery for issue #22. Writes out/probe.json.
// Usage: node scripts/probe.mjs
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const spikeDir = join(here, "..");
const spikeDist = join(spikeDir, "dist");
const outDir = join(spikeDir, "out");
const results = {};
const note = (k, v) => {
  results[k] = v;
  console.log(`### ${k}:`, JSON.stringify(v).slice(0, 400));
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const CSP = "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

function serve(port, { csp = false } = {}) {
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/csp") {
      const idx = await readFile(join(spikeDist, "index.html"), "utf8");
      const withMeta = idx.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(withMeta);
      return;
    }
    if (p === "/") p = "/index.html";
    try {
      const st = await stat(join(spikeDist, p));
      if (!st.isFile()) throw 0;
      res.writeHead(200, { "Content-Type": MIME[extname(p)] ?? "application/octet-stream" });
      res.end(await readFile(join(spikeDist, p)));
    } catch {
      const idx = await readFile(join(spikeDist, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(idx);
    }
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const srv = await serve(5999);
  const browser = await chromium.launch();
  const nonLocal = [];
  try {
    // ---------- 2. annotations: state survival ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
      await page.goto("http://127.0.0.1:5999/?theme=light#/annotations");
      await page.waitForSelector("[data-thread]", { timeout: 20000 });
      const threads = await page.locator("[data-thread]").count();
      const t3 = await page.locator('[data-thread="t3"]').count(); // deletions side
      // type into t1 textarea
      const ta = page.locator('[data-textarea="t1"]').first();
      await ta.click();
      await ta.press("End");
      await ta.type("hello-persist");
      const before = await ta.inputValue();
      // force parent re-render: flip app theme (options object identity changes)
      await page.evaluate(() => window.__setSpikeTheme("dark"));
      await sleep(2500);
      const after = await ta.inputValue().catch(() => "DETACHED");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute?.("data-textarea") ?? document.activeElement?.tagName);
      note("annotations.state", { threads, deletionsSideT3: t3, before: before.slice(-20), after: after.slice(-20), survived: after.includes("hello-persist"), focusedAfter: focused });
      // close one thread
      await page.locator('[data-thread="t2"] [data-act="close"]').first().click();
      await sleep(500);
      note("annotations.close", { t2count: await page.locator('[data-thread="t2"]').count(), t2textareas: await page.locator('[data-thread="t2"] textarea').count() });
      await ctx.close();
    }
    // ---------- 2b. split annotations ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/annotations-split");
      await page.waitForSelector("[data-thread]", { timeout: 20000 }).catch(() => {});
      note("annotations.split", { threads: await page.locator("[data-thread]").count() });
      await ctx.close();
    }
    // ---------- 3. gutter ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/annotations");
      await page.waitForSelector("[data-thread]", { timeout: 20000 });
      // hover a code line inside shadow DOM: find a line-number cell position
      const pos = await page.evaluate(() => {
        const hosts = [...document.querySelectorAll("*")].filter((d) => d.shadowRoot);
        const info = [];
        for (const h of hosts) {
          const sr = h.shadowRoot;
          const num = sr.querySelector("[data-column-number], [data-line-number], td.n, [data-gutter]");
          info.push({ host: h.tagName + "." + h.className, hasShadow: !!sr, numFound: !!num, slots: sr.querySelectorAll("slot").length, slotNames: [...sr.querySelectorAll("slot")].map((s) => s.getAttribute("name")) });
        }
        return info.slice(0, 8);
      });
      note("gutter.shadowStructure", pos);
      // does the custom + button exist in light DOM (slot content)?
      note("gutter.plusButtons", { count: await page.locator("[data-gutter-plus]").count() });
      await ctx.close();
    }
    // ---------- 4. selection inside shadow DOM ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/unified");
      await sleep(4000);
      const sel = await page.evaluate(() => {
        const out = { shadowHosts: 0, selectedText: "", selectionVisibleInDocument: false, hasGetComposedRanges: false, anchorInfo: null };
        const hosts = [...document.querySelectorAll("*")].filter((d) => d.shadowRoot);
        out.shadowHosts = hosts.length;
        const sr = hosts[0]?.shadowRoot;
        if (!sr) return { ...out, error: "no shadow root" };
        const code = sr.querySelector("[data-code], [data-line], .code, code");
        const textNode = (n) => {
          const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
          let t;
          while ((t = w.nextNode())) if (t.data.trim().length > 3) return t;
          return null;
        };
        const tn = textNode(sr);
        if (!tn) return { ...out, error: "no text node", codeFound: !!code };
        const range = document.createRange();
        range.setStart(tn, 0);
        range.setEnd(tn, Math.min(tn.data.length, 12));
        const s = document.getSelection();
        s.removeAllRanges();
        s.addRange(range);
        out.selectedText = s.toString().slice(0, 60);
        out.selectionVisibleInDocument = !s.isCollapsed;
        out.hasGetComposedRanges = typeof s.getComposedRanges === "function";
        if (out.hasGetComposedRanges) {
          try {
            const cr = s.getComposedRanges(sr);
            out.composedRanges = cr.length;
          } catch (e) {
            out.composedError = String(e).slice(0, 120);
          }
        }
        // can we map anchor to file+line via composed range / data attrs?
        const anchorEl = tn.parentElement;
        out.anchorInfo = { tag: anchorEl?.tagName, dataLine: anchorEl?.closest?.("[data-line]")?.getAttribute?.("data-line") ?? null };
        return out;
      });
      note("selection.shadow", sel);
      await ctx.close();
    }
    // ---------- 1/6. theming + fonts + header + hunk separators ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/unified");
      await sleep(4000);
      const light = await page.evaluate(() => {
        const h = [...document.querySelectorAll("*")].find((d) => d.shadowRoot);
        const sr = h.shadowRoot;
        const tok = sr.querySelector("[data-token], span[style*='color'], [style*='--hls']");
        const code = sr.querySelector("[data-code], [data-line]");
        const cs = code ? getComputedStyle(code) : null;
        return {
          headerText: document.body.textContent.slice(0, 0),
          headerFile: !!sr.querySelector("[data-diffs-header], header, [data-header]"),
          separators: sr.querySelectorAll("*").length,
          fontFamily: cs?.fontFamily ?? null,
          fontSize: cs?.fontSize ?? null,
        };
      });
      const headers = await page.evaluate(() => [...document.querySelectorAll("*")].filter((d) => d.shadowRoot).length);
      await page.goto("http://127.0.0.1:5999/?theme=dark#/unified");
      await sleep(4000);
      const darkBg = await page.evaluate(() => {
        const h = [...document.querySelectorAll("*")].find((d) => d.shadowRoot);
        const code = h.shadowRoot.querySelector("[data-code], [data-line]");
        return code ? getComputedStyle(code).color + " / " + getComputedStyle(h).backgroundColor : null;
      });
      note("theming", { light, shadowHosts: headers, darkSample: darkBg });
      await ctx.close();
    }
    // ---------- 9. CSP + network ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      const reqs = [];
      page.on("request", (r) => {
        const u = r.url();
        if (!u.startsWith("http://127.0.0.1:5999/") && !u.startsWith("data:")) reqs.push(u.slice(0, 120));
      });
      const violations = [];
      page.on("console", (m) => {
        if (/Content Security Policy|CSP|wasm-unsafe|unsafe-eval/i.test(m.text())) violations.push(m.text().slice(0, 200));
      });
      await page.goto("http://127.0.0.1:5999/csp#/unified");
      await sleep(5000);
      note("csp.network", { nonLocalRequests: [...new Set(reqs)], cspViolations: violations, threadsRendered: await page.locator("body").count() });
      await ctx.close();
    }
    // ---------- 8. perf: large diff ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/perf");
      await page.waitForSelector("[data-perf]", { timeout: 60000 });
      await sleep(6000);
      const perf = await page.evaluate(() => ({
        perfText: document.querySelector("[data-perf]")?.textContent ?? null,
        shadowHosts: [...document.querySelectorAll("*")].filter((d) => d.shadowRoot).length,
        memory: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + "MB" : "n/a",
      }));
      // scroll to bottom, check for blanking/errors
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(2500);
      const after = await page.evaluate(() => ({
        shadowHosts: [...document.querySelectorAll("*")].filter((d) => d.shadowRoot).length,
        errors: document.body.textContent.includes("Error") ? "has-error-text" : "none",
      }));
      note("perf.large", { ...perf, afterScroll: after });
      await ctx.close();
    }
    // ---------- 11. keyboard/a11y ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto("http://127.0.0.1:5999/?theme=light#/annotations");
      await page.waitForSelector("[data-thread]", { timeout: 20000 });
      await page.keyboard.press("Tab");
      await sleep(300);
      const focus1 = await page.evaluate(() => document.activeElement?.tagName + "#" + (document.activeElement?.id ?? "") + "." + (document.activeElement?.className ?? ""));
      // tab until textarea
      let focusedTextarea = false;
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        await sleep(80);
        const t = await page.evaluate(() => document.activeElement?.getAttribute?.("data-textarea") ?? null);
        if (t) {
          focusedTextarea = true;
          break;
        }
      }
      note("a11y.keyboard", { firstFocus: focus1, canTabToAnnotationTextarea: focusedTextarea });
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  // ---------- 10. sizes (node-side) ----------
  {
    const { readdir, readFile: rf, stat: st } = await import("node:fs/promises");
    const assets = await readdir(join(spikeDist, "assets"));
    let totalRaw = 0;
    let totalGzip = 0;
    const big = [];
    for (const a of assets) {
      const buf = await rf(join(spikeDist, "assets", a));
      totalRaw += buf.length;
      const g = gzipSync(buf).length;
      totalGzip += g;
      if (buf.length > 100000) big.push(`${a}: raw=${Math.round(buf.length / 1024)}KB gzip=${Math.round(g / 1024)}KB`);
    }
    big.sort();
    // ours
    const oursJs = await readdir(join(spikeDir, "..", "..", "packages/web/dist/assets"));
    let oursRaw = 0, oursGzip = 0;
    for (const a of oursJs) {
      const buf = await rf(join(spikeDir, "..", "..", "packages/web/dist/assets", a));
      oursRaw += buf.length;
      oursGzip += gzipSync(buf).length;
    }
    note("size.build", { spikeAssets: assets.length, spikeRawKB: Math.round(totalRaw / 1024), spikeGzipKB: Math.round(totalGzip / 1024), biggest: big, oursRawKB: Math.round(oursRaw / 1024), oursGzipKB: Math.round(oursGzip / 1024) });
  }
  await writeFile(join(outDir, "probe.json"), JSON.stringify(results, null, 2));
  console.log("wrote probe.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
