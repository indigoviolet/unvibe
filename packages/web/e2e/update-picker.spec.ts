/**
 * Failed-switch rollback in mock mode (issue #36, step 2, PRD §4.14).
 *
 * This is the only switch-flow test that cannot move to J5 (#357 Q4):
 * from a source checkout the real service refuses every switch with
 * 409 by design (it would restart an entry npm never renews), so the
 * switching/rollback UI is reachable only through the mock updater.
 * The rollback logic itself is covered by service unit tests
 * (update-helper/update-updater) and the "Rolled back" copy by
 * versionFormat.test.ts; J5 asserts the 409 refusal over the real API.
 */
import { expect, test } from "./network-guard.js";

async function freshSettings(page: import("@playwright/test").Page): Promise<void> {
  // Every test gets a fresh browser context, so localStorage starts empty:
  // one load is enough, no clear + reload (issue #119).
  await page.goto("/settings");
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
  await page.getByRole("tab", { name: "Version" }).click();
  await expect(page.getByRole("tabpanel", { name: "Version" })).toBeVisible();
}

async function enablePicker(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("version-picker-toggle").click();
  await expect(page.getByTestId("version-picker-toggle")).toBeChecked();
  await expect(page.locator('[data-testid="update-channel"]')).not.toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await freshSettings(page);
});

test("failed switch rolls back with a reason and stays on release", async ({ page }) => {
  test.setTimeout(60_000);
  await enablePicker(page);
  await page.evaluate(() => {
    localStorage.setItem("unvibe.mock.update.fail", "health");
  });
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  await page.getByRole("button", { name: "Confirm switch" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  await expect(page.getByTestId("update-outcome")).toContainText("Rolled back to release", { timeout: 30_000 });
  await expect(page.locator('[data-testid="update-channel"][data-ref="release"]').getByTestId("update-current")).toBeVisible();
  await expect(page.getByTestId("preview-badge")).toHaveCount(0);
});
