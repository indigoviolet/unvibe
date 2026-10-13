/**
 * Selection-toolbar scroll race (issue #147) over mock mode.
 *
 * The toolbar hides on scroll, so an app-initiated scroll landing within
 * milliseconds of the mouse-up hid the bar the user just summoned. The bar
 * now re-positions over the still-live selection for a short grace window
 * after it shows, and hides on later scrolls as before.
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

test("an app-initiated scroll just after selection keeps the toolbar; a later scroll hides it", async ({
  page,
}) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  const bar = page.locator("#selbar");
  await expect(bar).toBeVisible();
  // App-initiated scroll immediately after the bar shows: it stays.
  await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
  await page.waitForTimeout(150);
  await expect(bar).toBeVisible();
  // Past the grace window a scroll hides it as before.
  await page.waitForTimeout(600);
  await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
  await expect(bar).toBeHidden();
});
