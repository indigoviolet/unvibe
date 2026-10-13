/**
 * Open as page mid-fill (issue #152) over mock mode, deterministic via
 * the `unvibe.mock.turnFillHold` hook: Explain, open as a page while the
 * answer is still being written, the page shows the working state, the
 * fill lands on the page when released, and the anchor is styled as a
 * page link at once and after navigating back.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

test("open as page mid-fill keeps filling the page; anchor links at once", async ({ page }) => {
  await gotoReview(page);
  // Hold every turn fill so the answer is still being written below.
  await page.evaluate(() => localStorage.setItem("unvibe.mock.turnFillHold", "1"));
  try {
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator("#C-central [data-expansion]").first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator(".working").first()).toBeVisible({ timeout: 5000 });

    // Open as page while the answer is still being written.
    await card.getByRole("button", { name: "Open as page" }).click();
    await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });
    // The page shows the working state (never an empty silent card).
    await expect(page.locator("#page .card .working").first()).toBeVisible({ timeout: 5000 });

    // Releasing the hold fills the page card.
    await page.evaluate(() => localStorage.removeItem("unvibe.mock.turnFillHold"));
    await expect(page.locator("#page .card .exp-b, #page .card .blk").first()).toContainText("Mock explanation", {
      timeout: 8000,
    });
    await expect(page.locator("#page .card .working")).toHaveCount(0);

    // Back on the guide, the anchor is a page link (fault a).
    await page.goBack();
    await expect(page.locator("#C-central")).toBeVisible();
    const link = page.locator("#C-central a.cx.pg").first();
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toContainText("fast path");
  } finally {
    await page.evaluate(() => localStorage.removeItem("unvibe.mock.turnFillHold"));
  }
});
