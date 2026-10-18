/** J1 (#188): open a PR/demo review and read the guide — real service, replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { createDemoReview, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J1 open and read the guide", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("demo guide reads, citation reveals diff, reload keeps it; scratch repo opens with no agent", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    // Start page lists the demo entry.
    await page.goto(`${svc.origin}/?token=${svc.token}`);
    await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible({ timeout: 30_000 });
    // The opened demo review is listed on the start page; open it from there.
    await page.getByRole("button", { name: /Unfold obsolete folded response headers/ }).first().click();
    await page.waitForURL(new RegExp(`/review/${reviewId}`), { timeout: 30_000 });
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-problem")).toBeVisible();

    // Follow a citation into the diff (proven selector from guide-service).
    const seeded = page.locator("#C-problem [data-expansion]");
    if ((await seeded.count()) > 0) {
      const closer = page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" });
      if ((await closer.count()) > 0) await closer.first().click().catch(() => {});
    }
    await page.locator("#C-central .lk[data-refs]").first().click();
    await expect(page.locator('[id="L-src-urllib3-connection.py-91"].hl')).toBeVisible({ timeout: 15_000 });

    // Reload: same guide page.
    await page.reload();
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Variant with no agent: a scratch repo opens as diff + metadata, no guide promised.
    const repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-repo-"));
    const noneData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j1-none-"));
    let noneSvc: RunningService | null = null;
    try {
      await makeScratchRepo(repoDir);
      noneSvc = await startService(noneData, { agent: "none" });
      const scratchId = await createScratchReview(noneSvc, repoDir);
      await page.goto(`${noneSvc.origin}/review/${scratchId}?token=${noneSvc.token}`);
      const appFile = `[id="F-${fileKeyForPath("src/app.py")}"]`;
      await expect(page.locator(appFile)).toBeVisible({ timeout: 60_000 });
      await expect(page.locator(appFile).getByText("return 2")).toBeVisible({ timeout: 30_000 });
    } finally {
      await noneSvc?.stop().catch(() => {});
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(noneData, { recursive: true, force: true });
    }
  });
});
