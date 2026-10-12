/**
 * Doctor page + model display names + Reload (mock mode, issues #20/#21).
 */
import { expect, test } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/doctor");
  await expect(page.getByRole("heading", { name: "Doctor" })).toBeVisible();
});

test("doctor page shows service, PATH and tool detail with copy", async ({ page }) => {
  await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("doctor-service")).toContainText("pid");
  await expect(page.getByTestId("doctor-path")).toContainText("effective");
  await expect(page.getByTestId("doctor-tool-claude")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
});

test("model pickers show display name beside the id with description", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
  await page.getByRole("tab", { name: "Models" }).click();
  const main = page.locator('[data-testid="model-main"]');
  // Mock models carry names (Mock Main) + descriptions.
  await expect(main.locator("select").nth(1)).toContainText("Mock Main");
  await expect(main.locator("select").nth(1)).toContainText("mock-main");
});

test("reload everything reports in mock mode", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Environment" }).click();
  await page.getByRole("button", { name: "Reload environment" }).click();
  await expect(page.getByTestId("reload-result")).toBeVisible({ timeout: 10000 });
});
