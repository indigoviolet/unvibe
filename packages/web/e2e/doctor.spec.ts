/**
 * Doctor page + model display names + Reload (mock mode, issues #20/#21).
 */
import { expect, test } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/doctor");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();
});

test("doctor breadcrumb trails back through Settings", async ({ page }) => {
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings?tab=environment",
  );
  await expect(crumbs.getByText("Doctor")).toHaveAttribute("aria-current", "page");
  const gear = page.locator("header.top > a.ib[href=\"/settings\"]");
  await expect(gear).toHaveAttribute("aria-label", "Settings");
  await expect(gear).toHaveAttribute("title", "Settings");
});

test("doctor page shows service, PATH and tool detail with copy", async ({ page }) => {
  await expect(page.getByTestId("doctor-report")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("doctor-service")).toContainText("pid");
  await expect(page.getByTestId("doctor-path")).toContainText("effective");
  await expect(page.getByTestId("doctor-tool-claude")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy diagnostics" })).toBeVisible();
});

test("model pickers show display name beside the id, nothing underneath (#225)", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("tablist", { name: "Settings sections" })).toBeVisible();
  await page.getByRole("tab", { name: "Models" }).click();
  const main = page.locator('[data-testid="model-main"]');
  // Mock models carry names (Mock Main) + descriptions, but the picker
  // shows only the label: no description or status/path line underneath.
  await expect(main.locator("#model-main")).toContainText("Mock Main");
  await expect(main.locator("#model-main")).toContainText("mock-main");
  await expect(main.locator('[data-testid="model-main-desc"]')).toHaveCount(0);
  await expect(main.locator('[data-testid="model-main-status"]')).toHaveCount(0);
});

test("reload everything reports in mock mode", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Environment" }).click();
  await page.getByRole("button", { name: "Reload environment" }).click();
  await expect(page.getByTestId("reload-result")).toBeVisible({ timeout: 10000 });
});
