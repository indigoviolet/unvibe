/**
 * Per-review debug page (issue #32, PRD §4.14 + §9) against mock mode:
 * reachable from the review top bar; jobs with prompt links + cancel;
 * base + log + contributions as a rendered Markdown document with delete;
 * and the page links back to the review.
 */
import { expect, test } from "./network-guard.js";

test("top bar links to the debug page, which shows base, log and contributions", async ({ page }) => {
  await page.goto("/review/demo");
  await page.getByRole("link", { name: "Debug", exact: true }).click();
  await expect(page).toHaveURL("/review/demo/debug");
  await expect(page.getByRole("heading", { name: "Jobs, prompts and shared context" })).toBeVisible();

  const base = page.locator('section[aria-label="Base"]');
  await expect(base).toContainText("v1|guide-mock|mock|mock-main");
  await expect(base).toContainText("PR #5020");

  const log = page.locator('section[aria-label="Log"]');
  await expect(log).toContainText("[1 new-card global]");
  await expect(log).toContainText("Waiting for batch (1)");

  const contribs = page.locator('section[aria-label="Contributions"]');
  await expect(contribs).toContainText("ct-seed-1");
  await expect(contribs).toContainText("fact");
  await expect(contribs).toContainText("ct-seed-2");
  await expect(contribs).toContainText("correction");
  await expect(contribs).toContainText("diff:src-urllib3-connection.py:640-660");
});

test("jobs show state, tokens, cache rate, prompt link and cancel", async ({ page }) => {
  await page.goto("/review/demo/debug");
  const running = page.locator('[data-testid="job-job-explain-1"]');
  await expect(running).toContainText("explain");
  await expect(running).toContainText("running");
  await expect(running).toContainText("42.5k in");
  await expect(running).toContainText("91.5% cached");

  const backing = page.locator('[data-testid="job-job-critic-1"]');
  await expect(backing).toContainText(/backing-off · retry in/);

  await running.getByRole("button", { name: "Prompt" }).click();
  await expect(running).toContainText("Explain the quoted text");

  const queued = page.locator('[data-testid="job-job-hunk-1"]');
  await queued.getByRole("button", { name: "Cancel" }).click();
  await expect(queued).toContainText("cancelled");

  await expect(page.locator('[data-testid="jobs-totals"]')).toContainText("Totals:");
});

test("prompts show the expanded text for this review", async ({ page }) => {
  await page.goto("/review/demo/debug");
  const card = page.locator('section[aria-label="Prompts"]').locator('[data-testid="prompt-reader"]');
  await card.getByRole("button", { name: "Expand reader" }).click();
  // Expanded view: layers collapsed by default, cached part set apart.
  await expect(card.getByText(/total · .* cached/)).toBeVisible();
  const l1 = card.locator('details.lay[data-layer="L1"]');
  await expect(l1).toBeVisible();
  await expect(l1).toContainText("cached");
  await l1.locator("summary").click();
  await expect(l1).toContainText("PR #5020");
});

test("delete on the debug page removes the contribution", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await expect(page.locator('section[aria-label="Contributions"]')).toContainText("ct-seed-2");
  await page.getByRole("button", { name: "Delete ct-seed-2" }).click();
  await expect(page.locator('[data-testid="debug-delete-ct-seed-2"]')).toHaveCount(0);
  await expect(page.locator('section[aria-label="Contributions"]')).not.toContainText("ct-seed-2");
  await expect(page.locator('section[aria-label="Contributions"]')).toContainText("ct-seed-1");
});

test("debug page links back to the review", async ({ page }) => {
  await page.goto("/review/demo/debug");
  await page.getByRole("link", { name: "Back to review" }).click();
  await expect(page).toHaveURL("/review/demo");
});
