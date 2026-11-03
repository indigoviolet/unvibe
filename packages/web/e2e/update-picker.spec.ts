/**
 * Version picker in mock mode (issue #36, step 2, PRD §4.14): a simulated
 * switch (the page reloads onto the preview + badge), running jobs
 * refusing the switch, a simulated rollback, and the data-format warn
 * line for a format-changing target (Export drafts only with drafts).
 *
 * (The toggle, the channel list and the update-available row now live in
 * J5 against the real service with the fake updater — #258. The switch
 * itself can only be simulated in mock mode: from a source checkout the
 * real service refuses with 409, as J5 asserts. The warn line's no-draft
 * case against the real service lives in J5; the with-drafts Export
 * action is exercised here through the mock Outbox hooks.)
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

test("switch moves to the preview: inline confirm, restart wait, reload, badge", async ({ page }) => {
  test.setTimeout(60_000);
  await enablePicker(page);
  const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  // #346: the shared inline confirm ("Confirm switch" ✓ ✕) in the row.
  await expect(feat.getByText("Confirm switch")).toBeVisible();
  await expect(feat.getByRole("button", { name: "Confirm switch" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(feat.getByText("Confirm switch")).toHaveCount(0);
  await expect(feat.getByRole("button", { name: "Switch to preview/feat-x" })).toBeVisible();
  // Confirm for real: the pill runs "Switching…" while the service restarts.
  await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
  await feat.getByRole("button", { name: "Confirm switch" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  // The page reloads once the new build reports; the badge is short.
  await expect(page.getByTestId("preview-badge")).toHaveText("preview · feat/x · abc1234", { timeout: 30_000 });
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
  await page.getByRole("button", { name: "Confirm switch" }).click();
  // Inline on the row: which jobs, what switching does, both actions.
  const panel = page.getByTestId("update-blocked");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("3 running jobs — switching stops them");
  await expect(panel).toContainText("show as interrupted");
  await expect(panel).toContainText("stay with this channel");
  await expect(panel).toContainText("switch back to resume or retry them");
  await expect(page.getByTestId("update-blocked-jobs")).toContainText("ask · demo · running");
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
  await page.getByRole("button", { name: "Confirm switch" }).click();
  await expect(page.getByTestId("update-switching")).toBeVisible();
  await expect(page.getByTestId("update-outcome")).toContainText("Rolled back to release", { timeout: 30_000 });
  await expect(page.locator('[data-testid="update-channel"][data-ref="release"]').getByTestId("update-current")).toBeVisible();
  await expect(page.getByTestId("preview-badge")).toHaveCount(0);
});

test.describe("format-changing target warns in one line; Export drafts only with drafts", () => {
  test("warn line without drafts: no Export action", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("unvibe.mock.update.dataFormat", "2");
      localStorage.setItem("unvibe.mock.update.outboxCount", "0");
    });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Version" }).click();
    await enablePicker(page);
    // One short warn line under the row, with the real from/to formats.
    const feat = page.locator('[data-testid="update-channel"][data-ref="preview/feat-x"]');
    const warn = page.locator('[data-testid="update-data-reset-warning"][data-ref="preview/feat-x"]');
    await expect(warn).toContainText("Needs a data reset (format 1 → 2)");
    // No unposted drafts: no Export action on the line.
    await expect(warn.getByRole("button")).toHaveCount(0);
    // The switch itself still confirms through the row's inline confirm.
    await feat.getByRole("button", { name: "Switch to preview/feat-x" }).click();
    await expect(feat.getByText("Confirm switch")).toBeVisible();
  });

  test("warn line with drafts offers Export with the count", async ({ page }) => {
    test.setTimeout(60_000);
    await page.addInitScript(() => {
      localStorage.setItem("unvibe.mock.update.dataFormat", "2");
      localStorage.setItem("unvibe.mock.update.outboxCount", "2");
    });
    await page.reload();
    await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
    await page.getByRole("tab", { name: "Version" }).click();
    await enablePicker(page);
    const warn = page.locator('[data-testid="update-data-reset-warning"][data-ref="preview/feat-x"]');
    await expect(warn).toContainText("Needs a data reset (format 1 → 2)");
    await expect(warn.getByRole("button", { name: "Export 2 drafts" })).toBeVisible();
  });
});
