/** J266 (#266): scroll restore across guide page navigation — real service, replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { selectText } from "../select-text.js";
import { createSeededDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J266 scroll restore", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j266-data-"));
    reviewId = createSeededDemoReview(dataDir, "j266-seed");
    svc = await startService(dataDir, { agent: "replay" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test.beforeEach(async ({ page }) => {
    await cpuThrottleFromEnv(page);
  });

  test("scroll, open page, back restores position", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Open an expansion as a page so Contents lists it under linked pages.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator('#C-central [data-expansion]').first();
    await expect(card.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
    await card.getByRole("button", { name: "Open as page" }).click();
    await expect(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
    await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
    const pageId = page.url().match(/page\/(.+)$/)?.[1] ?? "";
    await page.goBack();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });
    const link = page.locator(`nav.toc [data-node="${pageId}"]`);
    await expect(link).toBeVisible({ timeout: 5000 });

    // Same wait as interaction test 7 (#266): the scroll must stick before
    // navigating — re-issue until it reads back, as a reader's wheel would.
    // The offset keeps the clicked Contents link on screen: clicking an
    // off-screen link auto-scrolls it into view first, so the restored
    // position would legitimately be the revealed one, not the intended one.
    await expect
      .poll(
        () =>
          page.locator("#page").evaluate((el) => {
            el.scrollTo(0, 200);
            return el.scrollTop;
          }),
        { timeout: 5000 },
      )
      .toBe(200);
    // Loud premise: the click below must not move the scroll itself. The
    // link must already sit inside #page's visible area (viewport
    // coordinates would ignore the review bar above the pane).
    const vis = await page.evaluate((sel) => {
      const pane = document.getElementById("page");
      const target = pane?.querySelector(sel);
      if (!pane || !target) return null;
      const p = pane.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      return { top: b.y - p.y, bottom: b.y + b.height - p.y, height: p.height };
    }, `nav.toc [data-node="${pageId}"]`);
    expect(vis?.top).toBeGreaterThanOrEqual(0);
    expect(vis?.bottom).toBeLessThanOrEqual(vis?.height ?? 0);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`page/${pageId}`));
    await page.goBack();
    await expect
      .poll(() => page.locator("#page").evaluate((el) => el.scrollTop), { timeout: 5000 })
      .toBeGreaterThan(150);
  });
});
