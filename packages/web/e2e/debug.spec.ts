/**
 * Per-review shared-context debug page (issue #32, PRD §9) against mock
 * mode: reachable from the review top bar, shows base + log +
 * contributions as a rendered Markdown document, delete works there, and
 * the page links back to the review.
 */
import { expect, test } from "./network-guard.js";

test("top bar links to the debug page, which shows base, log and contributions", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("link", { name: "Debug", exact: true }).click();
  await expect(page).toHaveURL("/review/demo/debug");
  await expect(page.getByRole("heading", { name: "Shared context" })).toBeVisible();

  const base = page.locator('section[aria-label="Base"]');
  await expect(base).toContainText("v1|guide-mock|mock|mock-main");
  await expect(base).toContainText("PR #5020");

  const log = page.locator('section[aria-label="Log"]');
  await expect(log).toContainText("[1 new-card global]");
  await expect(log).toContainText("waiting for batch");

  const contribs = page.locator('section[aria-label="Contributions"]');
  await expect(contribs).toContainText("ct-seed-1");
  await expect(contribs).toContainText("fact");
  await expect(contribs).toContainText("ct-seed-2");
  await expect(contribs).toContainText("correction");
  await expect(contribs).toContainText("diff:src-urllib3-connection.py:640-660");
});

test("delete on the debug page removes the contribution", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await expect(page.locator('section[aria-label="Contributions"]')).toContainText("ct-seed-2");
  await page.getByRole("button", { name: "Delete ct-seed-2" }).click();
  await expect(page.locator('[data-testid="debug-delete-ct-seed-2"]')).toHaveCount(0);
  await expect(page.locator('section[aria-label="Contributions"]')).not.toContainText("ct-seed-2");
  await expect(page.locator('section[aria-label="Contributions"]')).toContainText("ct-seed-1");
});

test("debug page links back to the review", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await page.getByRole("link", { name: "Back to review" }).click();
  await expect(page).toHaveURL("/review/demo");
});
