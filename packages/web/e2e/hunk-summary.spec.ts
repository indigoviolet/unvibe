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

test("select summary text, Explain: the thread appears under the hunk", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="explain"]').click();
  // The hunk activates into its thread (summary text moves into the
  // thread); the nested Explain reply fills there too.
  const thread = page.locator('.dhunk section.ithread[data-thread]', { hasText: "Unfolds folded header values" }).first();
  await expect(thread).toBeVisible({ timeout: 5000 });
  await expect(thread).toContainText("Mock explanation", { timeout: 8000 });
  // The idle text gave way to the thread.
  await expect(page.locator("p[data-hunksum]")).toHaveCount(0);
});

test("a Comment on a summary lands on the line and never activates", async ({ page }) => {
  await gotoDiff(page);
  const before = await page.locator(".dhunk section.ithread[data-thread]").count();
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="note"]').click();
  const composer = page.locator(".ithread[data-pending-thread]");
  await expect(composer).toBeVisible({ timeout: 5000 });
  // Commenting never activates the hunk: the idle summary stays put and
  // no thread appears for it.
  await expect(page.locator("p[data-hunksum]").first()).toBeVisible();
  await expect(page.locator(".dhunk section.ithread[data-thread]")).toHaveCount(before);
});

async function backToDiff(page: Page): Promise<void> {
  await page.goBack();
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("p[data-hunksum]").first()).toBeVisible({ timeout: 8000 });
}

test("promoted hunk keeps summary plus chip; the summary opens the page, never a second thread", async ({
  page,
}) => {
  await gotoDiff(page);
  // The hunk thread carries its summary text; seeded suggestion threads
  // do not.
  await page.locator("p[data-hunksum]").first().click();
  const thread = page.locator('.dhunk section.ithread[data-thread]', { hasText: "Unfolds folded header values" }).first();
  await expect(thread).toBeVisible({ timeout: 5000 });
  await thread.getByRole("button", { name: "Open as page" }).click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });

  // Back on the diff: the summary text stays, plus the chip, and the
  // hunk thread is gone (promoted away).
  await backToDiff(page);
  await expect(page.locator("p[data-hunksum]", { hasText: "Unfolds folded header values" })).toBeVisible();
  await expect(page.locator('.dhunk section.ithread[data-thread]', { hasText: "Unfolds folded header values" })).toHaveCount(0);
  const chip = page.locator(".dhunk a.cx.pg").first();
  await expect(chip).toBeVisible({ timeout: 5000 });

  // The chip opens the page.
  await chip.click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });

  // Selecting in the summary and choosing Explain opens the same page
  // instead of activating a second thread.
  await backToDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="explain"]').click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });
  await backToDiff(page);
  await expect(page.locator('.dhunk section.ithread[data-thread]', { hasText: "Unfolds folded header values" })).toHaveCount(0);
  await expect(page.locator(".dhunk a.cx.pg").first()).toBeVisible({ timeout: 5000 });
});
