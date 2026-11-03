/**
 * Re-do guide in the review top bar (issue #345, moved from the Debug
 * page where it lived under #115) in mock mode: never offered for the
 * demo review or on the Debug page; the icon button matches its
 * neighbours and the bar still fits at 960; the confirmation says what
 * is lost; confirming lands on the new loading review, which opens once
 * the hold is released; Cancel and Escape close without acting.
 */
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./network-guard.js";

const FRAMES = fileURLToPath(new URL("../test-results/", import.meta.url));

/** The shared inline confirm (#346) is open: pill + both segments + the copy in its accessible name. */
async function expectConfirmOpen(page: Page): Promise<void> {
  const pill = page.locator("#reviewbar .uic-pill");
  await expect(pill).toContainText("Confirm re-do guide");
  await expect(pill.getByRole("button", { name: "Confirm re-do guide" })).toBeVisible();
  await expect(pill.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(pill).toHaveAttribute("aria-label", /Anything already on GitHub stays there\./);
}

test("demo review toolbar offers no re-do, and neither does the Debug page", async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.getByRole("button", { name: "Guide" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-do guide" })).toHaveCount(0);
  await page.goto("/review/demo/debug");
  await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-do guide" })).toHaveCount(0);
});

test("re-do sits in the top bar after Debug with tooltip Re-do guide", async ({ page }) => {
  await page.goto("/review/r-old");
  const button = page.getByRole("button", { name: "Re-do guide" });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("title", "Re-do guide");
  await expect(button).toHaveAttribute("data-tip", "Re-do guide");
  // An icon button like its neighbours: glyph only, no visible text.
  await expect(button.locator("svg.ic")).toBeVisible();
  await expect(button).toHaveText("");
  // After the Debug icon in the bar's review-action group.
  const debugBox = await page.getByRole("link", { name: "Debug" }).boundingBox();
  const btnBox = await button.boundingBox();
  expect(btnBox!.x).toBeGreaterThanOrEqual(debugBox!.x + debugBox!.width);
  expect(Math.abs(btnBox!.y - debugBox!.y)).toBeLessThanOrEqual(4);
});

test("top bar fits at 1440 and 960 (light), plus the open confirmation", async ({ page }) => {
  for (const width of [1440, 960]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/review/r-old");
    await expect(page.getByRole("button", { name: "Re-do guide" })).toBeVisible();
    await page.screenshot({ path: `${FRAMES}redo-topbar-${width}.png` });
    const layout = await page.evaluate(() => {
      const bar = document.getElementById("reviewbar")!;
      const tops = [...bar.children].map((el) => (el as HTMLElement).offsetTop);
      return {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        minTop: Math.min(...tops),
        maxTop: Math.max(...tops),
      };
    });
    expect(layout.scrollW).toBeLessThanOrEqual(layout.innerW);
    expect(layout.maxTop - layout.minTop).toBeLessThanOrEqual(2);
    // The confirming state swaps in place and must hold the same row.
    await page.getByRole("button", { name: "Re-do guide" }).click();
    await expectConfirmOpen(page);
    // Let the pill's entry animation settle: capturing mid-fade reads
    // as a see-through pill with doubled text.
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${FRAMES}redo-confirm-${width}.png` });
    const confirming = await page.evaluate(() => {
      const bar = document.getElementById("reviewbar")!;
      const tops = [...bar.children].map((el) => (el as HTMLElement).offsetTop);
      return {
        scrollW: document.documentElement.scrollWidth,
        innerW: window.innerWidth,
        minTop: Math.min(...tops),
        maxTop: Math.max(...tops),
      };
    });
    expect(confirming.scrollW).toBeLessThanOrEqual(confirming.innerW);
    expect(confirming.maxTop - confirming.minTop).toBeLessThanOrEqual(2);
  }
});

test("cancel and Escape close the confirmation without leaving", async ({ page }) => {
  await page.goto("/review/r-old");
  await page.getByRole("button", { name: "Re-do guide" }).click();
  await expectConfirmOpen(page);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("#reviewbar .uic-pill")).toHaveCount(0);
  await expect(page).toHaveURL("/review/r-old");
  await page.getByRole("button", { name: "Re-do guide" }).click();
  await expectConfirmOpen(page);
  await page.keyboard.press("Escape");
  await expect(page.locator("#reviewbar .uic-pill")).toHaveCount(0);
  await expect(page).toHaveURL("/review/r-old");
});

test("re-do confirms and lands on the new loading review", async ({ page }) => {
  await page.goto("/review/r-old");
  await page.getByRole("button", { name: "Re-do guide" }).click();
  await expectConfirmOpen(page);
  // Arm the hold after load: an init script would run again on the reload
  // below and re-arm it, racing the release (open-review.spec.ts).
  await page.evaluate(() => localStorage.setItem("unvibe.mock.createReviewHold", "1"));
  await page.getByRole("button", { name: "Confirm re-do guide" }).click();
  // The old id is gone; the new review opens in its loading state.
  await expect(page).toHaveURL(/\/review\/mock-loading-/, { timeout: 15000 });
  await expect(page.getByTestId("review-loading")).toBeVisible();
  await expect(page.getByTestId("review-loading")).toContainText("Building the guide");
  // Release the hold → the ingest lands → the guide opens after reload.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.createReviewHold"));
  await page.reload();
  await expect(page.getByTestId("review-loading")).toBeHidden({ timeout: 15000 });
});
