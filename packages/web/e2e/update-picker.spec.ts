/**
 * Version picker in mock mode (issue #36, step 2, PRD §4.14): the toggle
 * above the card, the current version line, one aligned row per version
 * with the current one marked, a simulated switch (the page reloads onto
 * the preview + badge), and a simulated rollback (the reason shows in
 * place, still on release).
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
  await page.getByTestId("version-picker-toggle").check();
  await expect(page.locator('[data-testid="update-channel"]')).not.toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await freshSettings(page);
});

test("picker is off by default: only the toggle shows", async ({ page }) => {
  await expect(page.getByTestId("version-picker-toggle")).not.toBeChecked();
  await expect(page.locator('[data-testid="update-channel"]')).toHaveCount(0);
  await expect(page.getByText("Show channels and allow switching")).toBeVisible();
});

test("enable lists one aligned row per version with the current one marked", async ({ page }) => {
  await enablePicker(page);
  await expect(page.getByTestId("update-current-version")).toContainText("Installed: release");
  await expect(page.getByText("Channels", { exact: true })).toBeVisible();
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await expect(feat).toContainText("abc1234");
  await expect(feat.getByRole("button", { name: "Switch to preview/feat-x" })).toHaveText("Switch");
  const release = page.locator('[data-testid="update-channel"][data-ref="release"]');
  await expect(release.getByTestId("update-current")).toBeVisible();
  await expect(page.getByTestId("update-refresh")).toHaveText("Refresh");
  // Newest build first (issue #73).
  const refs = await page
    .locator('[data-testid="update-channel"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-ref")));
  expect(refs).toEqual(["preview/feat-x", "preview/fix-y", "release-rc", "release"]);
});

test("switch moves to the preview: confirm, restart wait, reload, badge", async ({ page }) => {
  test.setTimeout(60_000);
  await enablePicker(page);
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  await expect(page.getByText("The service restarts. Your data is kept and backed up first.")).toBeVisible();
  await page.getByRole("button", { name: "Confirm switch to preview/feat-x" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  // The page reloads once the new build reports; the badge names the branch.
  await expect(page.getByTestId("preview-badge")).toContainText("feat/x", { timeout: 30_000 });
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
  await expect(page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]').getByTestId("update-current")).toBeVisible();
  await expect(page.getByTestId("update-outcome")).toContainText("Switched to preview/feat-x");
  // The badge links to the Version section.
  await expect(page.getByTestId("preview-badge")).toHaveAttribute("href", "/settings?tab=version");
});

test("running jobs refuse the switch; switch anyway forces it with a count", async ({ page }) => {
  test.setTimeout(60_000);
  await enablePicker(page);
  await page.evaluate(() => {
    localStorage.setItem("unvibe.mock.update.blockJobs", "1");
  });
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  await page.getByRole("button", { name: "Confirm switch to preview/feat-x" }).click();
  // Inline on the row: which jobs, what switching does, both actions.
  const panel = page.getByTestId("update-blocked");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("3 running jobs — switching stops them");
  await expect(panel).toContainText("show as interrupted");
  await expect(panel).toContainText("stay with this channel");
  await expect(panel).toContainText("switch back to resume or retry them");
  await expect(page.getByTestId("update-blocked-jobs")).toContainText("explain · demo · running");
  await expect(page.getByTestId("update-blocked-jobs")).toContainText("backing-off");
  await panel.getByRole("button", { name: "Switch anyway" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  // Forced switch completes; the post-reload outcome names the count.
  await expect(page.getByTestId("preview-badge")).toContainText("feat/x", { timeout: 30_000 });
  await expect(page.getByTestId("update-outcome")).toContainText("Switched to preview/feat-x");
  await expect(page.getByTestId("update-outcome")).toContainText("3 jobs interrupted");
});

test("failed switch rolls back with a reason and stays on release", async ({ page }) => {
  test.setTimeout(60_000);
  await enablePicker(page);
  await page.evaluate(() => {
    localStorage.setItem("unvibe.mock.update.fail", "health");
  });
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  await page.getByRole("button", { name: "Confirm switch to preview/feat-x" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  await expect(page.getByTestId("update-outcome")).toContainText("Rolled back to release", { timeout: 30_000 });
  await expect(page.locator('[data-testid="update-channel"][data-ref="release"]').getByTestId("update-current")).toBeVisible();
  await expect(page.getByTestId("preview-badge")).toHaveCount(0);
});
