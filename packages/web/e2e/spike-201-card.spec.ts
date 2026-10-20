/** Spike #201 addendum: pinned Explain card + reply box + hovered toolbar tooltip (#204 pinned default), demo only. Output spikes/201/<SPIKE_SET>-card/ */
import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { selectText } from "./select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
const exec = promisify(execFile);
const SET = process.env.SPIKE_SET ?? "after";
const OUT = path.resolve(`spikes/201/${SET}-card`);
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
  svc = await startService(mkdtempSync(path.join(os.tmpdir(), "spike201card-")), { agent: "replay" });
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
    test(`card ${theme} ${dark ? "dark" : "light"}`, async ({ page }) => {
      if (!svc) throw new Error("no service");
      test.setTimeout(120000);
      await page.setViewportSize({ width: 1280, height: 900 });
      if (dark) await page.emulateMedia({ colorScheme: "dark" });
      await page.request.fetch(`${svc.origin}/api/settings?token=${svc.token}`, { method: "PUT", data: { uiTheme: theme } });
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toBeVisible({ timeout: 30000 });
      await page.locator("#C-problem").scrollIntoViewIfNeeded();
      await selectText(page, "#C-problem", "used to let a server continue");
      await page.locator('#selbar [data-act="explain"]').click();
      const floating = page.locator("#page .card.child.floating").first();
      await expect(floating).toBeVisible({ timeout: 15000 });
      await expect(floating.locator(".working")).toHaveCount(0, { timeout: 15000 });
      await floating.getByRole("button", { name: "Pin into the page" }).click();
      const card = page.locator("#page .card.child:not(.floating)").first();
      await expect(card).toBeVisible({ timeout: 15000 });
      await card.screenshot({ path: path.join(OUT, `${theme}-${dark ? "dark" : "light"}-card.png`) });
      const bulb = card.getByRole("button", { name: "Use examples" });
      const box = await bulb.boundingBox();
      if (!box) throw new Error("no bulb box");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
      await expect(page.locator("#tip")).toBeVisible({ timeout: 5000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${theme}-${dark ? "dark" : "light"}-tooltip.png`) });
    });
  }
}
