/**
 * #92: async open in mock mode (deterministic via localStorage hooks).
 * - click → immediate navigation → loading → guide appears;
 * - failing open shows the error with Retry (retry succeeds once the hook is cleared).
 */
import { expect, test } from "./network-guard.js";

test("opening a PR navigates at once to a loading page, then the guide appears", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // Arm the hold once, after load. An init script would run again on the
  // reload below and re-arm it, racing the release (flaky about 1 run in 20).
  await page.evaluate(() => localStorage.setItem("unvibe.mock.createReviewHold", "1"));
  // Open a PR by number (mock createReview returns loading while held).
  await page.getByLabel("Open a PR by URL or number").fill("5020");
  await page.getByRole("button", { name: "Open PR" }).click();
  // Immediate navigation (POST answers 202 before the ingest).
  await expect(page).toHaveURL(/\/review\/mock-loading-/, { timeout: 15000 });
  await expect(page.getByTestId("review-loading")).toBeVisible();
  await expect(page.getByTestId("review-loading-step")).toContainText("Fetching");
  // Release the hold → the ingest lands → guide appears after reload (mock
  // has no WS patches; the real-service path is covered in vitest).
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.createReviewHold"));
  await page.reload();
  await expect(page.getByTestId("review-loading")).toBeHidden({ timeout: 15000 });
});

test("a failing open shows the error with Retry", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unvibe.mock.createReviewFail", "gh pr view failed: not found");
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await page.getByLabel("Open a PR by URL or number").fill("999999");
  await page.getByRole("button", { name: "Open PR" }).click();
  await expect(page).toHaveURL(/\/review\/mock-failed-/, { timeout: 15000 });
  await expect(page.getByTestId("review-failed")).toBeVisible();
  await expect(page.getByTestId("review-failed-error")).toContainText("gh pr view failed");
  // Retry succeeds once the failure hook is cleared.
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.createReviewFail"));
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("review-failed")).toBeHidden({ timeout: 15000 });
});
