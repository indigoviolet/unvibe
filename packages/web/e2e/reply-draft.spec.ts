/**
 * Reply-box drafts over mock mode: sending a follow-up empties the box
 * and it stays empty once the answer starts (no debounce resurrection);
 * Discard empties it too. Reload persistence rides the stored draft and
 * is covered over the real service in `reply-draft-service.spec.ts`.
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

test("sending a follow-up empties the box for good; Discard does too", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator("#C-central [data-expansion]").first();
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  const box = card.locator("textarea");
  // Discard clears a typed-but-unsent draft.
  await box.fill("never mind");
  await card.getByRole("button", { name: "Discard" }).click();
  await expect(box).toHaveValue("", { timeout: 5000 });

  // Send a follow-up: the box empties once accepted and stays empty
  // after the answer starts (no debounce resurrection).
  await box.fill("And why?");
  await card.getByRole("button", { name: "Reply" }).click();
  await expect(box).toHaveValue("", { timeout: 5000 });
  await expect(card.locator(".ans").nth(1)).toContainText("Mock explanation", { timeout: 8000 });
  await expect(box).toHaveValue("");
});
