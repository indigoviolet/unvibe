/**
 * Spike #286 screenshot pass: renders each SVG (service light/dark output,
 * post-processed) inside the app's .dg-d2 styles for all four theme combos
 * (Default/Studio x light/dark via prototype.css variables) and screenshots.
 * Usage: node shots.mjs  (reads ../out/*.svg, writes ../out/shots/*.png)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const ROOT = path.join(process.cwd(), "spikes/d2-features");
const OUT = path.join(ROOT, "out");
const SHOTS = path.join(OUT, "shots");
const CSS = fs.readFileSync(path.join(process.cwd(), "packages/web/src/styles/prototype.css"), "utf8");

// Representative set: full 4-theme matrix for these, light+dark Default only for the rest.
const FULL_MATRIX = ["01-baseline", "16-containers", "19-sql-class", "26-animated-edge", "probe-05-md-label", "icon-allowed", "probe-boards-before", "anim-boards"];
const LIGHT_ONLY_OK = false;

function page(svgText, uiTheme, mode) {
  return `<!DOCTYPE html><html data-ui-theme="${uiTheme}" data-theme="${mode}"><head><meta charset="utf8"><style>${CSS}
  body{background:var(--bg);color:var(--ink);font-family:sans-serif}
  .dg-d2 .dg-svg > svg{display:block;width:100%;height:auto;max-width:900px;margin:0 auto}</style></head>
  <body><div class="dg dg-d2"><div class="dg-view"><div class="dg-doc"><div class="dg-svg">${svgText}</div></div></div></div></body></html>`;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".svg") && !f.startsWith("probe-cap")).sort();
  const exe = path.join(os.homedir(), ".cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell");
  const browser = await chromium.launch({ executablePath: exe });
  const done = [];
  for (const f of files) {
    const base = f.replace(/\.svg$/, "");
    const isDarkFile = base.endsWith(".dark");
    const stem = base.replace(/\.(light|dark)$/, "");
    const full = FULL_MATRIX.includes(stem);
    const svg = fs.readFileSync(path.join(OUT, f), "utf8");
    const isLightFile = base.endsWith(".light");
    const combos = full
      ? (isLightFile ? [["default", "light"], ["studio", "light"]] : isDarkFile ? [["default", "dark"], ["studio", "dark"]] : [["default", "light"], ["default", "dark"], ["studio", "light"], ["studio", "dark"]])
      : isDarkFile ? [["default", "dark"]] : [["default", "light"]];
    // pair light file with light themes, dark file with dark themes
    for (const [ui, mode] of combos) {
      if (!full) {
        if (isDarkFile && mode !== "dark") continue;
        if (!isDarkFile && !base.startsWith("probe-") && !base.startsWith("icon-") && !base.startsWith("anim-") && mode !== "light") continue;
      }
      const pg = await browser.newPage({ viewport: { width: 1000, height: 700 } });
      await pg.setContent(page(svg, ui, mode), { waitUntil: "load" });
      await pg.waitForTimeout(400);
      const el = pg.locator(".dg-svg");
      const name = `${base}.${ui}.${mode}.png`;
      try {
        await el.screenshot({ path: path.join(SHOTS, name) });
      } catch (e) {
        await pg.screenshot({ path: path.join(SHOTS, name) });
      }
      await pg.close();
      done.push(name);
    }
  }
  await browser.close();
  console.log(`wrote ${done.length} shots`);
}

void main();
