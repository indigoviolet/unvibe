/**
 * Hunk summaries as content cards (issue #138) over mock mode: selecting
 * in a summary and choosing Explain activates it under the hunk; a
 * Comment lands on the hunk's first changed line and never activates the
 * summary; a promoted hunk keeps its summary plus chip.
 *
 * (Click-to-activate, delete and on-demand summarize now live in J13
 * against the real service — #258.)
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

async function gotoDiff(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 8000 });
}

test("select summary text, Explain: the card appears under the hunk", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator(".dhunk [data-expansion]").first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // The nested answer fills inside the hunk card (two answer bodies: the
  // summary and the nested reply share the card's `.exp-b` divs).
  await expect(card).toContainText("Mock explanation", { timeout: 8000 });
  // The idle text gave way to the card (it stays a card).
  await expect(page.locator("p[data-hunksum]")).toHaveCount(0);
});

test("a Comment on a summary lands on the line and never activates", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="note"]').click();
  const composer = page.locator(".ithread[data-pending-thread]");
  await expect(composer).toBeVisible({ timeout: 5000 });
  // No card was activated under any hunk.
  await expect(page.locator(".dhunk [data-expansion]")).toHaveCount(0);
});

async function backToDiff(page: Page): Promise<void> {
  await page.goBack();
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("p[data-hunksum]").first()).toBeVisible({ timeout: 8000 });
}

test("promoted hunk keeps summary plus chip; the summary opens the page, never a second card", async ({
  page,
}) => {
  await gotoDiff(page);
  // Activate through the explicit control, then open as a page.
  await page.locator("p[data-hunksum]").first().click();
  const card = page.locator(".dhunk [data-expansion]").first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await card.getByRole("button", { name: "Open as page" }).click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });

  // Back on the diff: the summary text stays, plus the chip, no card.
  await backToDiff(page);
  await expect(page.locator(".dhunk [data-expansion]")).toHaveCount(0);
  const chip = page.locator(".dhunk a.cx.pg").first();
  await expect(chip).toBeVisible({ timeout: 5000 });

  // The chip opens the page.
  await chip.click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });

  // Selecting in the summary and choosing Explain opens the same page
  // instead of activating a second card.
  await backToDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="explain"]').click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });
  await backToDiff(page);
  await expect(page.locator(".dhunk [data-expansion]")).toHaveCount(0);
  await expect(page.locator(".dhunk a.cx.pg").first()).toBeVisible({ timeout: 5000 });
});
