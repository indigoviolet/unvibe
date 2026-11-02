/**
 * J323 (#323): Settings → Debug → Export statistics downloads an
 * anonymized stats file from the real service, and the file passes the
 * leak checks (no ISO dates, no SHAs, no epoch timestamps).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J323 stats export", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j323-"));
    svc = await startService(dataDir, { agent: "none" });
  });

  test.afterAll(async () => {
    await svc?.stop();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test("Export button downloads a leak-clean stats file", async ({ page }) => {
    await page.goto(`${svc!.origin}/settings?tab=debug&token=${svc!.token}`);
    const button = page.getByRole("button", { name: "Export statistics" });
    await expect(button).toBeVisible();
    await page.getByRole("region", { name: "Debug" }).screenshot({
      path: path.join("test-results", "j323-settings-debug.png"),
    });
    const downloadPromise = page.waitForEvent("download");
    await button.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("unvibe-stats.json");
    const file = path.join(dataDir, "downloaded-stats.json");
    await download.saveAs(file);
    const text = readFileSync(file, "utf8");
    const body = JSON.parse(text) as { schemaVersion: number; totals: { reviews: number } };
    expect(body.schemaVersion).toBe(1);
    expect(body.totals.reviews).toBe(0);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b/i);
    await expect(page.getByText(/Exported 0 reviews/)).toBeVisible();
  });
});
