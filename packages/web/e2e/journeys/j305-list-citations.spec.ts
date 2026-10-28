/** J305 (#305): a whole-list citation sits inline at the end of the last item. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J305 list citations", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j305-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("cited lists keep their chips inside items, with no row below the list", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toBeVisible({ timeout: 60_000 });

    // Every list block: no citation row of its own below the list …
    const lists = page.locator("#page .blk:has(ul.lst, ol.lst)");
    const n = await lists.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const blk = lists.nth(i);
      await expect(blk.locator(":scope > .lo-row button.lk")).toHaveCount(0);
    }
    // … and at least one cited list shows its chips inside items.
    const chips = page.locator('#page .blk ul.lst li button.lk, #page .blk ol.lst li button.lk');
    await expect(chips.first()).toBeVisible({ timeout: 30_000 });
    // Each chip sits inside an `li`, inline after the item text.
    const chipLi = chips.first().locator("xpath=ancestor::li[1]");
    await expect(chipLi).toBeVisible();
    const chipBox = (await chips.first().boundingBox())!;
    const liBox = (await chipLi.boundingBox())!;
    expect(chipBox.y).toBeGreaterThanOrEqual(liBox.y);
    expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(liBox.y + liBox.height + 1);
  });
});
