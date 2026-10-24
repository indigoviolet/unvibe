/**
 * Spike #268 screenshot script (branch-only, never merged).
 *
 * Serves the web app with Vite (mock mode, no service) and captures the
 * threads mock-up at 1440/960 wide in light/dark (default theme):
 *  - thread-*: the flat thread with three replies (ask, explain, comment)
 *  - replylink-*: after clicking the in-thread reply link (scroll+flash)
 *  - collapsed-*: header control collapsed every thread to one row
 *  - one-expanded-*: one row expanded again
 *
 * Run: `node spike268-shots.mjs [--port N]` from packages/web.
 * Output: docs/spikes/268-threads/*.png
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../docs/spikes/268-threads");
const portArg = process.argv.find((a) => a.startsWith("--port="));
const PORT = portArg ? Number(portArg.split("=")[1]) : 5431;
const BASE = `http://127.0.0.1:${PORT}`;
const URL = `${BASE}/spike/268-threads`;

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() - start > timeoutMs) return reject(new Error(`vite never came up at ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
  cwd: here,
  env: {
    ...process.env,
    VITE_MOCK: "1",
    PATH: `${path.resolve(here, "../../node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
vite.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
vite.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));

let failed = false;
try {
  await waitForServer(`${BASE}/`);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 960]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          colorScheme: theme,
        });
        const page = await context.newPage();
        await page.goto(URL, { waitUntil: "networkidle" });
        await page.waitForSelector("#th-featured", { timeout: 15000 });
        await page.evaluate((t) => {
          document.documentElement.setAttribute("data-ui-theme", "default");
          document.documentElement.setAttribute("data-theme", t);
        }, theme);
        await page.waitForTimeout(600);

        const shot = (name) =>
          page.screenshot({ path: path.join(outDir, `${name}-${width}-${theme}.png`), fullPage: true });

        await shot("thread");
        await page.click('[data-replylink="r2"]');
        await page.waitForTimeout(1000);
          await shot("replylink");
          // Let the reply flash clear so the collapsed frames start clean.
          await page.waitForTimeout(2600);
        await page.click('[data-testid="collapse-threads"]');
        await page.waitForTimeout(500);
        await shot("collapsed");
        await page.click('[data-row="th-featured"]');
        await page.waitForTimeout(500);
        await shot("one-expanded");
        await context.close();
        console.log(`done ${width}/${theme}`);
      }
    }
  } finally {
    await browser.close();
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  vite.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 1000));
  try {
    vite.kill("SIGKILL");
  } catch {
    // already gone
  }
}
process.exit(failed ? 1 : 0);
