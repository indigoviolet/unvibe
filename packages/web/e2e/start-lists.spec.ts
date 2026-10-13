/**
 * Start page PR lists (#95, #100, #94, #131) in mock mode: the
 * review-request split with its recency filter (persisted), the diff size
 * on PR rows, the PR label link to GitHub (present on PR rows, never
 * triggering the row; the review-bar label links too), and the branches
 * filter by last commit date (Reviews stays unfiltered).
 */
import { test, expect } from "./network-guard.js";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByText("Your PRs")).toBeVisible();
});

test("review requests split into direct and team, newest first", async ({ page }) => {
  await expect(page.getByText("Requested of you", { exact: true })).toBeVisible();
  await expect(page.getByText("Requested of your team")).toBeVisible();
  // Asked of both you and your team: once, as direct, with its team name.
  await expect(page.getByText("Docs: clarify retry wording")).toHaveCount(1);
  await expect(page.locator(".ci", { hasText: "Docs: clarify retry wording" })).toContainText("via docs");
  // Newest first: the 30-minute-old ask sits above the 2-hour-old one.
  const newer = await page.getByText("Docs: clarify retry wording").boundingBox();
  const older = await page.getByText("Pool: reuse connections across redirects").boundingBox();
  expect(newer?.y).toBeLessThan(older?.y ?? 0);
  // Relative time and team names on the rows.
  await expect(page.locator(".ci", { hasText: "Pool: reuse connections across redirects" })).toContainText("2h ago");
  await expect(page.locator(".ci", { hasText: "CI: pin the lint action" })).toContainText("via core");
});

test("recency filter hides older rows in both groups and persists", async ({ page }) => {
  await expect(page.getByText("CI: pin the lint action")).toBeVisible();
  await page.getByLabel("Updated within").selectOption("1d");
  // The 2-day-old team ask hides; the filtered-out group names its window.
  await expect(page.getByText("CI: pin the lint action")).toHaveCount(0);
  await expect(page.locator('[data-testid="requested-team-empty"]')).toContainText(
    "No PRs updated in the last day.",
  );
  // The recent direct asks stay.
  await expect(page.getByText("Pool: reuse connections across redirects")).toBeVisible();
  // All shows everything again, and the choice survives a reload.
  await page.getByLabel("Updated within").selectOption("all");
  await expect(page.getByText("CI: pin the lint action")).toBeVisible();
  await page.getByLabel("Updated within").selectOption("2w");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByLabel("Updated within")).toHaveValue("2w");
  await expect(page.getByText("Changelog: backfill old entries")).toHaveCount(0);
});

test("PR rows show the diff size and omit it when unknown", async ({ page }) => {
  const row = page.locator(".ci", { hasText: "Pool: reuse connections across redirects" });
  await expect(row).toContainText("+545");
  await expect(row).toContainText("30 files");
  // The size-less row carries no size text.
  const unsized = page.locator(".ci", { hasText: "Changelog: backfill old entries" });
  await expect(unsized).not.toContainText("+");
  await expect(unsized).not.toContainText("files");
});

test("the PR label links to GitHub without opening the review", async ({ page }) => {
  const link = page.getByRole("link", { name: "Open PR #5018 on GitHub" });
  await expect(link).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5018");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noreferrer");
  // The link sits in the row but outside the row's own button, so opening
  // the review and following the link stay separate actions.
  expect(await link.evaluate((el) => el.closest("button"))).toBeNull();
  // (Not clicked: a new-tab GitHub navigation must never fire in tests.)
});

test("the review-bar PR label links to the PR", async ({ page }) => {
  await page.goto("/review/r-old");
  await expect(page.locator("#reviewbar")).toBeVisible();
  const label = page.locator("#reviewbar").getByRole("link", { name: "urllib3/urllib3#5011" });
  await expect(label).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5011");
  await expect(label).toHaveAttribute("target", "_blank");
});

test("branches filter by last commit and show ages, Reviews stays unfiltered (#131)", async ({ page }) => {
  // Branch rows show the commit age, as PR rows do.
  await expect(page.locator(".ci", { hasText: "experiment/lazy-headers" })).toContainText("3d ago");
  await page.getByLabel("Updated within").selectOption("1d");
  // The 3-day-old branch drops out; the fresh branch row stays.
  await expect(page.getByText("experiment/lazy-headers")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "fix-obs-fold", exact: true })).toBeVisible();
  // Reviews ignores the window: the recent demo review still lists.
  await expect(
    page.locator('div[aria-label="Reviews"]').getByText("Unfold obsolete folded response header values"),
  ).toBeVisible();
});
