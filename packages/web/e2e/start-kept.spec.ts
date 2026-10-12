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
  await expect(page.getByText("PRs you're authoring")).toBeVisible();
  await expect(page.locator('[data-testid="kept-status"]')).toContainText(/^Updated /);
  await expect(page.getByText("Unfold obsolete folded response header values").first()).toBeVisible();

  // Hold every repo-lists response, then reload: the kept rows must render
  // while the requests are still held.
  await page.evaluate(() => localStorage.setItem("unvibe.mock.repoChangesHold", "1"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(
    page.getByText("Unfold obsolete folded response header values").first(),
  ).toBeVisible();
  // No loading state for a repo with kept rows; the quiet refresh sign is on.
  await expect(page.locator('[data-testid="repo-lists-loading"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="kept-status"]')).toContainText("refreshing");

  // Release: the fresh data lands and the sign settles (same line, no jump).
  await page.evaluate(() => localStorage.removeItem("unvibe.mock.repoChangesHold"));
  await expect(page.getByText("PRs you're authoring")).toBeVisible();
  await expect(page.locator('[data-testid="kept-status"]')).toContainText(/^Updated /);
  await expect(page.locator('[data-testid="kept-status"]')).not.toContainText("refreshing");
  await expect(
    page.getByText("Unfold obsolete folded response header values").first(),
  ).toBeVisible();
});
