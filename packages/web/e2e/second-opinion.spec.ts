/**
 * Second opinion in mock mode (generated urllib3#5020 snapshot):
 * one icon button per card control row (tooltip names the default mode:
 * check on cards, blind on findings), a caret menu for the other mode,
 * run → verdict shows, disagreement uses warn styling, re-run and
 * remove work.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

test("card control is one icon button running check by default; run shows disagrees prominently", async ({ page }) => {
  await gotoReview(page);
  const ctl = page.locator('#C-central [data-so-ctl="central"]');
  await expect(ctl).toBeVisible();
  // One icon button (default for a guide card is check) plus a mode caret.
  await expect(ctl.getByRole("button", { name: "Second opinion (check this claim)" })).toBeVisible();
  await expect(ctl.getByRole("button", { name: "Choose a second-opinion mode" })).toBeVisible();
  // Run (check → disagrees in mock).
  await ctl.getByRole("button", { name: "Second opinion (check this claim)" }).click();
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
  // Wait for the re-run itself to finish: its working state appears and
  // clears when the new result lands (the old block already satisfies a
  // plain visibility wait, so that would prove nothing — issue #76).
  await expect(block.getByRole("button", { name: "Working…" })).toBeVisible({ timeout: 5000 });
  await expect(block.getByRole("button", { name: "Working…" })).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#C-central [data-so][data-verdict="disagrees"]')).toBeVisible({ timeout: 5000 });
  expect(await page.locator('#C-central [data-so][data-verdict="disagrees"]').count()).toBe(1);
  await block.getByRole("button", { name: "Remove second opinion" }).click();
  await expect(page.locator('#C-central [data-so]')).toHaveCount(0);
});

test("mode menu runs blind; finding defaults to blind", async ({ page }) => {
  await gotoReview(page);
  const ctl = page.locator('#C-central [data-so-ctl="central"]');
  await ctl.getByRole("button", { name: "Choose a second-opinion mode" }).click();
  const menu = ctl.getByRole("menu", { name: "Second-opinion mode" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitemradio", { name: /Blind/ }).click();
  await expect(page.locator('#C-central [data-so][data-verdict="partly"]')).toBeVisible({ timeout: 5000 });

  // Findings default to blind.
  await page.goto("/review/demo/page/f-lf");
  await expect(page.locator("#page .eyebrow")).toContainText("Agent finding", { timeout: 10000 });
  const findingCtl = page.locator('[data-so-ctl="flf-ev"]');
  await expect(findingCtl).toBeVisible();
  await expect(
    findingCtl.getByRole("button", { name: "Second opinion (blind)" }),
  ).toBeVisible();
  await findingCtl.getByRole("button", { name: "Second opinion (blind)" }).click();
  await expect(page.locator('[data-so][data-verdict="partly"]')).toBeVisible({ timeout: 5000 });
});

test("mode menu closes on Escape", async ({ page }) => {
  await gotoReview(page);
  const ctl = page.locator('#C-central [data-so-ctl="central"]');
  await ctl.getByRole("button", { name: "Choose a second-opinion mode" }).click();
  await expect(ctl.getByRole("menu", { name: "Second-opinion mode" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(ctl.getByRole("menu", { name: "Second-opinion mode" })).toHaveCount(0);
});
