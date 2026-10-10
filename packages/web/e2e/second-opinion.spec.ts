/**
 * Second opinion in mock mode (generated urllib3#5020 snapshot):
 * control row with blind/check switch (defaults: blind on findings, check
 * on cards), run → verdict shows, disagreement uses warn styling, re-run
 * and remove work.
 */
import { expect, test, type Page } from "@playwright/test";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

test("card control shows check by default; run shows disagrees prominently", async ({ page }) => {
  await gotoReview(page);
  const ctl = page.locator('#C-central [data-so-ctl="central"]');
  await expect(ctl).toBeVisible();
  // Default for a guide card is Check.
  await expect(ctl.getByRole("button", { name: "Check mode" })).toHaveAttribute("aria-pressed", "true");
  await expect(ctl.getByRole("button", { name: "Blind mode" })).toHaveAttribute("aria-pressed", "false");
  // Run (check → disagrees in mock).
  await ctl.getByRole("button", { name: /Second opinion \(check\)/ }).click();
  const block = page.locator('#C-central [data-so][data-verdict="disagrees"]');
  await expect(block).toBeVisible({ timeout: 5000 });
  await expect(block).toHaveClass(/so-dis/);
  await expect(block).toContainText("Disagrees");
  await expect(block).toContainText("codex/mock-second");
  await expect(block).toContainText("Missed:");
  // Citation marker behaves like all others.
  await expect(block.locator(".lk[data-refs]").first()).toBeVisible();
  // Re-run keeps one per mode; remove clears it.
  await block.getByRole("button", { name: /Re-run second opinion/ }).click();
  await expect(page.locator('#C-central [data-so][data-verdict="disagrees"]')).toBeVisible({ timeout: 5000 });
  expect(await page.locator('#C-central [data-so][data-verdict="disagrees"]').count()).toBe(1);
  await block.getByRole("button", { name: "Remove second opinion" }).click();
  await expect(page.locator('#C-central [data-so]')).toHaveCount(0);
});

test("mode switch selects blind; finding defaults to blind", async ({ page }) => {
  await gotoReview(page);
  const ctl = page.locator('#C-central [data-so-ctl="central"]');
  await ctl.getByRole("button", { name: "Blind mode" }).click();
  await expect(ctl.getByRole("button", { name: "Blind mode" })).toHaveAttribute("aria-pressed", "true");
  await ctl.getByRole("button", { name: /Second opinion \(blind\)/ }).click();
  await expect(page.locator('#C-central [data-so][data-verdict="partly"]')).toBeVisible({ timeout: 5000 });

  // Findings default to blind.
  await page.goto("/review/demo/page/f-lf");
  await expect(page.locator("#page .eyebrow")).toContainText("Agent finding", { timeout: 10000 });
  const findingCtl = page.locator('[data-so-ctl="flf-ev"]');
  await expect(findingCtl).toBeVisible();
  await expect(findingCtl.getByRole("button", { name: "Blind mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await findingCtl.getByRole("button", { name: /Second opinion \(blind\)/ }).click();
  await expect(page.locator('[data-so][data-verdict="partly"]')).toBeVisible({ timeout: 5000 });
});
