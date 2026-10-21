/** Spike #201 surfaces: review guide/diff + Debug/Doctor in each theme, light/dark.
 * Output spikes/201/<SPIKE_SET>-surfaces/ (before-surfaces|after-surfaces). Demo data only;
 * gh/d2 stubbed at a neutral /tmp path; Doctor text redacted to /tmp in-page before the shot. */
import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { selectText } from "./select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
const exec = promisify(execFile);
const SET = process.env.SPIKE_SET ?? "after";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../../../spikes/201/${SET}-surfaces`);
test.skip(!existsSync(SERVICE_ENTRY), "needs build");
test.use({ channel: "chromium" });
async function apiJson(origin: string, token: string, method: string, p: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${p}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}
let svc: RunningService | null = null;
let reviewId = "";
test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const bin = mkdtempSync(path.join(os.tmpdir(), "spike201-bin-"));
  writeFileSync(path.join(bin, "gh"), "#!/bin/sh\ncase \"$*\" in\n  *\"api user\"*\"--jq\"*) echo 'demo-user'; exit 0 ;;\n  *\"api user\"*) echo '{\"login\":\"demo-user\"}'; exit 0 ;;\n  *auth*) exit 0 ;;\n  *--version*) echo 'gh version 2.0.0'; exit 0 ;;\nesac\necho '{}'\nexit 0\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "d2"), "#!/bin/sh\necho 'v0.9.0'\n", { mode: 0o755 });
  writeFileSync(path.join(bin, "fakeshell"), `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${bin}:$PATH"\n`, { mode: 0o755 });
  svc = await startService(mkdtempSync(path.join(os.tmpdir(), "spike201surf-")), { agent: "replay", extraEnv: { SHELL: path.join(bin, "fakeshell"), PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` } });
  const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as { review: { id: string } };
  reviewId = created.review.id;
  const deadline = Date.now() + 90000;
  for (;;) {
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as { pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[] };
    const root = snap.pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0)) break;
    if (Date.now() > deadline) throw new Error("guide did not fill");
    await new Promise((r) => setTimeout(r, 1000));
  }
});
test.afterAll(async () => { await svc?.stop(); svc = null; });
for (const theme of ["default", "studio", "console"] as const) {
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    test(`surfaces ${theme} ${mode}`, async ({ page }) => {
      if (!svc) throw new Error("no service");
      test.setTimeout(180000);
      await page.setViewportSize({ width: 1440, height: 950 });
      if (dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.request.fetch(`${svc.origin}/api/settings?token=${svc.token}`, { method: "PUT", data: { uiTheme: theme } });
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toBeVisible({ timeout: 30000 });
      // Guide: Contents, Plotlines, guide cards.
      await page.locator("#page").screenshot({ path: path.join(OUT, `${theme}-${mode}-guide.png`) });
      // Pinned Explain/Ask card with reply area (create once, reuse across themes).
      let pinned = page.locator("#C-problem section[data-expansion]").first();
      if ((await pinned.count()) === 0) {
        await page.locator("#C-problem").scrollIntoViewIfNeeded();
        await selectText(page, "#C-problem", "used to let a server continue");
        await page.locator('#selbar [data-act="explain"]').click();
        const created = page.locator("#page section[data-expansion]").first();
        await expect(created).toBeVisible({ timeout: 15000 });
        await expect(created.locator(".working")).toHaveCount(0, { timeout: 30000 });
        pinned = page.locator("#C-problem section[data-expansion]").first();
      }
      await expect(pinned).toBeVisible({ timeout: 15000 });
      await pinned.scrollIntoViewIfNeeded();
      await pinned.screenshot({ path: path.join(OUT, `${theme}-${mode}-guide-pinned.png`) });
      // Finding page card.
      await page.goto(`${svc.origin}/review/${reviewId}/page/f-lf?token=${svc.token}`);
      await expect(page.locator("#page .doc")).toBeVisible({ timeout: 30000 });
      await page.locator("#page").screenshot({ path: path.join(OUT, `${theme}-${mode}-finding.png`) });
      // Diff: hunk summary, then its pinned card.
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toBeVisible({ timeout: 30000 });
      const sum = page.locator("[data-hunksum]").first();
      await expect(sum).toBeVisible({ timeout: 90000 });
      await sum.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${theme}-${mode}-diff.png`) });
      let hunkCard = page.locator(".dhunk section[data-expansion]").first();
      if ((await hunkCard.count()) === 0) await sum.click();
      hunkCard = page.locator(".dhunk section[data-expansion]").first();
      await expect(hunkCard).toBeVisible({ timeout: 15000 });
      await hunkCard.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, `${theme}-${mode}-diff-pinned.png`) });
      // Debug.
      await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
      await expect(page.locator("main")).toBeVisible({ timeout: 30000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `${theme}-${mode}-debug.png`), fullPage: true });
      // Doctor (redact any host path to a neutral /tmp path for the shot only).
      await page.goto(`${svc.origin}/doctor?token=${svc.token}`);
      await expect(page.locator('[data-testid="doctor-report"]')).toBeVisible({ timeout: 30000 });
      await page.evaluate(() => {
        const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n as Text;
          if (t.data.includes("/home/") || t.data.includes("/Users/")) t.data = t.data.replace(/\/(home|Users)\/\S+/g, "/tmp/demo-service");
        }
      });
      await page.screenshot({ path: path.join(OUT, `${theme}-${mode}-doctor.png`), fullPage: true });
    });
  }
}
