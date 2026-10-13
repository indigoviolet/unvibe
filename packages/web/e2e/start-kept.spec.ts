/**
 * Start page kept lists (issue #90): the last fetched PR/branch lists show
 * at once after a reload while the refresh is still held, then settle when
 * the fresh data lands.
 */
import { test, expect } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
});

test("reload shows kept rows before the changes request completes, then updates", async ({ page }) => {
  // First load fetches and keeps the lists.
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
  await expect(page.getByText("Unfold obsolete folded response header values").first()).toBeVisible();

  // Hold every repo-lists response, then reload: the kept rows must render
  // while the requests are still held.
  await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(
    page.getByText("Unfold obsolete folded response header values").first(),
  ).toBeVisible();
  // No loading state for a repo with kept rows; the refresh icon spins.
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
  await expect(page.getByTestId("lists-refresh")).toHaveAttribute("title", /refreshing/);

  // Release: the fresh data lands and the tooltip settles (no layout jump).
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("Your PRs")).toBeVisible();
  await expect(page.getByTestId("lists-refresh")).toHaveAttribute("title", /^Updated /);
  await expect(
    page.getByText("Unfold obsolete folded response header values").first(),
  ).toBeVisible();
});
