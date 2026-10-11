// Screenshots: ours (built service, replay demo) vs theirs (spike harness).
// Usage: node scripts/shots.mjs  (starts + stops everything itself by PID)
// Output: out/*.png
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const spikeDist = join(here, "..", "dist");
const outDir = join(here, "..", "out");
const SERVICE_ENTRY = join(root, "packages/service/dist/index.js");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

function serveStatic(dir, port) {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const f = join(dir, p);
      const st = await stat(f).catch(() => null);
      if (!st || !st.isFile()) {
        const idx = await readFile(join(dir, "index.html"));
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(idx);
        return;
      }
      res.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
      res.end(await readFile(f));
    } catch (e) {
      res.writeHead(500);
      res.end(String(e));
    }
  });
  return new Promise((resolve) => srv.listen(port, "127.0.0.1", () => resolve(srv)));
}

async function startService() {
  const dataDir = mkdtempSync(join(tmpdir(), "pierre-spike-"));
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  const proc = spawn(process.execPath, [SERVICE_ENTRY], {
    env: { ...env, UNVIBE_DATA_DIR: dataDir, UNVIBE_PORT: "0", UNVIBE_REPO_ROOTS: "", UNVIBE_AGENT: "replay" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log("service pid:", proc.pid);
  let out = "";
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("service did not start: " + out)), 30000);
    proc.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/Unvibe listening on (http:\/\/127\.0\.0\.1:\d+)\/\?token=(\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    proc.stderr.on("data", () => {});
    proc.on("error", reject);
  });
  return { proc, ...(await started) };
}

async function createDemoReview(origin, token) {
  const r = await fetch(`${origin}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ repoId: "demo" }),
  });
  const j = await r.json();
  return j.review.id;
}

const shot = (page, p) => page.screenshot({ path: p });

async function openDiff(page) {
  // Source pane starts hidden behind the top-bar "Source" toggle on a fresh profile.
  await page.locator("#right").waitFor({ state: "attached", timeout: 30000 });
  const right = page.locator("#right");
  for (let i = 0; i < 3 && !(await right.isVisible().catch(() => false)); i++) {
    const src = page.getByRole("button", { name: "Source" });
    if ((await src.count()) === 0) break;
    await src.first().click();
    await page.waitForTimeout(500);
  }
  await right.waitFor({ state: "visible", timeout: 30000 });
  const diffTab = page.getByRole("tab", { name: "Diff" });
  await diffTab.waitFor({ state: "visible", timeout: 30000 });
  if ((await diffTab.getAttribute("aria-selected")) !== "true") {
    await diffTab.click();
  }
  await page.waitForSelector("text=Hunk 1 of", { timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function main() {
  const staticSrv = await serveStatic(spikeDist, 5998);
  console.log("static pid: self, port 5998");
  const svc = await startService();
  console.log("service:", svc.origin, "pid:", svc.proc.pid);
  const reviewId = await createDemoReview(svc.origin, svc.token);
  console.log("review:", reviewId);

  const browser = await chromium.launch();
  try {
    // ---- OURS, 1440 light ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await openDiff(page);
      await shot(page, join(outDir, "ours-1440-light.png"));
      // Diff pane element (~600px source pane)
      const pane = page.locator("#right");
      if ((await pane.count()) > 0) await pane.screenshot({ path: join(outDir, "ours-pane-600-light.png") });
      await ctx.close();
    }
    // ---- OURS, 1440 dark ----
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
      const page = await ctx.newPage();
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await openDiff(page);
      await shot(page, join(outDir, "ours-1440-dark.png"));
      await ctx.close();
    }
    // ---- OURS, 800px ----
    {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await openDiff(page);
      await shot(page, join(outDir, "ours-800-light.png"));
      await ctx.close();
    }
    // ---- THEIRS ----
    const theirs = [
      ["#/unified", "light", { width: 1440, height: 900 }, "theirs-unified-1440-light.png"],
      ["#/split", "light", { width: 1440, height: 900 }, "theirs-split-1440-light.png"],
      ["#/annotations", "light", { width: 1440, height: 900 }, "theirs-annotations-1440-light.png"],
      ["#/trees", "light", { width: 1440, height: 900 }, "theirs-trees-1440-light.png"],
      ["#/shiki", "light", { width: 1440, height: 900 }, "theirs-shiki-1440-light.png"],
    ];
    for (const [hash, theme, vp, name] of theirs) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: theme });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:5998/?theme=${theme}${hash}`);
      await page.waitForTimeout(4000);
      await shot(page, join(outDir, name));
      await ctx.close();
    }
    // theirs dark + 800
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:5998/?theme=dark#/unified`);
      await page.waitForTimeout(4000);
      await shot(page, join(outDir, "theirs-unified-1440-dark.png"));
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 800, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`http://127.0.0.1:5998/?theme=light#/unified`);
      await page.waitForTimeout(4000);
      await shot(page, join(outDir, "theirs-unified-800-light.png"));
      await ctx.close();
    }
  } finally {
    await browser.close();
    svc.proc.kill("SIGTERM");
    staticSrv.close();
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
