/**
 * Re-do guide on the Debug page (issue #115) in mock mode: never offered
 * for the demo review; the confirmation says what is lost; confirming
 * lands on the new loading review, which opens once the hold is released.
 */
import { expect, test } from "./network-guard.js";

test("demo debug page offers no re-do", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-do guide" })).toHaveCount(0);
});

test("cancel closes the confirmation without leaving", async ({ page }) => {
  await page.goto("/review/r-old/debug");
  await page.getByRole("button", { name: "Re-do guide" }).click();
  await expect(page.getByText("Anything already on GitHub stays there.")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Anything already on GitHub stays there.")).toBeHidden();
  await expect(page).toHaveURL("/review/r-old/debug");
});

test("re-do confirms and lands on the new loading review", async ({ page }) => {
  await page.goto("/review/r-old/debug");
  await page.getByRole("button", { name: "Re-do guide" }).click();
  await expect(page.getByText("Anything already on GitHub stays there.")).toBeVisible();
  // Arm the hold after load: an init script would run again on the reload
  // below and re-arm it, racing the release (open-review.spec.ts).
  await page.evaluate(() => localStorage.setItem("unvibe.mock.createReviewHold", "1"));
  await page.getByRole("button", { name: "Re-do guide" }).click();
  // The old id is gone; the new review opens in its loading state.
  await expect(page).toHaveURL(/\/review\/mock-loading-/, { timeout: 15000 });
  await expect(page.getByTestId("review-loading")).toBeVisible();
  await expect(page.getByTestId("review-loading")).toContainText("Building the guide");
  // Release the hold → the ingest lands → the guide opens after reload.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.createReviewHold"));
  await page.reload();
  await expect(page.getByTestId("review-loading")).toBeHidden({ timeout: 15000 });
});
