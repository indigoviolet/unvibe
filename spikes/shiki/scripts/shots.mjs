/**
 * Screenshots for issue #23. Writes spikes/shiki/out/*.png.
 *
 * Matrix: unified + split, light + dark (via the app's own data-theme),
 * 1440px + 800px widths; Python, TypeScript, TSX, Markdown, JSON, shell,
 * and an unshipped language (rst); before (?nohl=1) + after each.
 * Clipped to the diff pane (#right) to keep files small.
 *
 * The service + repo are created by this script (PIDs recorded, killed by
 * PID); no other worktree is touched.
 */
import { chromium } from "@playwright/test";
import {
  OUT,
  createBranchReview,
  killPid,
  makeMultiLangRepo,
  rmdir,
  startService,
  tmpdir,
} from "./lib.mjs";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SHOTS = [];
const shot = (name, spec) => SHOTS.push({ name, ...spec });

for (const file of ["app.py", "index.ts", "widget.tsx", "README.md", "config.json", "run.sh", "notes.rst"]) {
  const short = file.replace(/[^A-Za-z0-9]+/g, "-");
  shot(`after-unified-1440-light-${short}`, { file, view: "unified", width: 1440, theme: "light", nohl: false });
  shot(`before-unified-1440-light-${short}`, { file, view: "unified", width: 1440, theme: "light", nohl: true });
}
shot("after-unified-1440-dark-app-py", { file: "app.py", view: "unified", width: 1440, theme: "dark", nohl: false });
shot("before-unified-1440-dark-app-py", { file: "app.py", view: "unified", width: 1440, theme: "dark", nohl: true });
shot("after-split-1440-light-app-py", { file: "app.py", view: "split", width: 1440, theme: "light", nohl: false });
shot("before-split-1440-light-app-py", { file: "app.py", view: "split", width: 1440, theme: "light", nohl: true });
shot("after-split-1440-dark-widget-tsx", { file: "widget.tsx", view: "split", width: 1440, theme: "dark", nohl: false });
shot("after-unified-800-light-app-py", { file: "app.py", view: "unified", width: 800, theme: "light", nohl: false });
shot("before-unified-800-light-app-py", { file: "app.py", view: "unified", width: 800, theme: "light", nohl: true });
shot("after-unified-800-dark-index-ts", { file: "index.ts", view: "unified", width: 800, theme: "dark", nohl: false });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const dataDir = tmpdir("unvibe-shiki-shots-data-");
  const { origin, token, pid } = await startService(dataDir);
  const repoDir = await makeMultiLangRepo();
  const browser = await chromium.launch();
  try {
    const reviewId = await createBranchReview(origin, token, repoDir, "feature");
    for (const s of SHOTS) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: 900 } });
      const page = await ctx.newPage();
      const q = `?token=${token}${s.nohl ? "&nohl=1" : ""}`;
      await page.goto(`${origin}/review/${reviewId}${q}`);
      // Narrow windows hide the source pane (guide takes full width):
      // the top-bar "Source" button opens it as an overlay.
      const pane = page.locator("#right");
      await page.waitForTimeout(1500);
      if (!(await pane.isVisible().catch(() => false))) {
        await page.getByRole("button", { name: "Source" }).click();
      }
      await page.locator('[id^="F-"]').first().waitFor({ timeout: 60000 });
      // Theme via the app's own setting (explicit data-theme wins).
      await page.evaluate((theme) => {
        if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
        else document.documentElement.setAttribute("data-theme", "light");
      }, s.theme);
      if (s.view === "split") await page.getByRole("button", { name: "Split" }).click();
      // Show every hunk including docs/config (README) for coverage.
      const hide = page.getByRole("button", { name: "Hide uninteresting" });
      if ((await hide.getAttribute("aria-pressed")) === "true") await hide.click();
      // Jump to the file, wait for its body, then for highlight (after).
      const fileId = await page.evaluate((file) => {
        const els = [...document.querySelectorAll(".dfile")];
        const hit = els.find((el) => (el.textContent ?? "").includes(file));
        if (!hit) return null;
        hit.scrollIntoView({ block: "start" });
        return hit.id;
      }, s.file);
      if (!fileId) throw new Error(`file not found: ${s.file}`);
      await page.waitForTimeout(600);
      if (!s.nohl) {
        await page.locator(`[id="${fileId}"] td.c .shk-kw, [id="${fileId}"] td.c .shk-str`).first().waitFor({ timeout: 30000 }).catch(() => null);
        // Exception: unshipped languages never highlight (plain by design).
        await page.waitForTimeout(1200);
      } else {
        await page.waitForTimeout(2500);
      }
      await pane.screenshot({
        path: path.join(OUT, `${s.name}.png`),
        animations: "disabled",
        caret: "initial",
      });
      console.log(`[shots] ${s.name}.png (file: ${fileId})`);
      await ctx.close();
    }
  } finally {
    await browser.close().catch(() => {});
    await killPid(pid, "service");
    rmdir(repoDir);
    rmdir(dataDir);
  }
  console.log("[shots] done");
  process.exit(0);
}

main().catch((e) => {
  console.error("[shots] FATAL", e);
  process.exit(1);
});
