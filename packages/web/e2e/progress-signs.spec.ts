/**
 * Progress signs (issue #98) against mock mode: the review bar shows a
 * running / queued job count while jobs are live and hides it when idle,
 * linking to the Debug jobs list; and the working dots run a visible
 * sequential pulse that stays still under reduced motion.
 *
 * The mock demo seeds 1 running + 1 queued + 1 backing-off job, so the
 * count reads "1 running, 2 queued" on load.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./network-guard.js";

async function gotoDemo(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
}

/** Computed `animation-name` + `animation-duration` of the first working dot. */
async function dotsAnimation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.querySelector("#C-g-flow .dots i");
    if (!el) return "missing";
    const cs = getComputedStyle(el);
    return `${cs.animationName} ${cs.animationDuration}`;
  });
}

test("review bar shows the job count and links to the Debug jobs list", async ({ page }) => {
  await gotoDemo(page);
  const bar = page.locator("#reviewbar");
  const count = bar.getByRole("link", { name: "1 running, 2 queued" });
  await expect(count).toBeVisible();
  await expect(count).toContainText("1 · 2");
  await expect(count).toHaveAttribute("href", "/review/demo/debug");
  await count.click();
  await expect(page).toHaveURL("/review/demo/debug");
});

test("the count disappears once no job is live", async ({ page }) => {
  await gotoDemo(page);
  const bar = page.locator("#reviewbar");
  await expect(bar.getByRole("link", { name: "1 running, 2 queued" })).toBeVisible();
  // Cancel every live job from the Debug jobs list.
  await bar.getByRole("link", { name: "Debug", exact: true }).click();
  for (const id of ["job-job-explain-1", "job-job-hunk-1", "job-job-critic-1"]) {
    await page.locator(`[data-testid="${id}"]`).getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(`[data-testid="${id}"]`)).toContainText("cancelled");
  }
  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "urllib3/urllib3#5020" })
    .click();
  await expect(page).toHaveURL("/review/demo");
  await expect(bar.getByRole("link", { name: /running, .* queued/ })).toHaveCount(0);
});

test("the count fits the 800px layout without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoDemo(page);
  await expect(page.locator("#reviewbar").getByRole("link", { name: "1 running, 2 queued" }))
    .toBeVisible();
  const overflow = await page
    .locator("#reviewbar")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("working dots pulse while the agent works", async ({ page }) => {
  await gotoDemo(page);
  // The follow-up chip shows dots on click, before the mock fill lands.
  await page.locator("#C-g-flow .follow button").first().click();
  await expect.poll(() => dotsAnimation(page), { timeout: 8000 }).toBe("dot-pulse 1s");
  // The work still completes normally afterwards.
  await expect(page.locator("#C-g-flow [data-expansion]").first()).toContainText("Mock explanation", {
    timeout: 8000,
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("dots stay still and the count gradient does not animate", async ({ page }) => {
    await gotoDemo(page);
    const bar = page.locator("#reviewbar");
    const count = bar.getByRole("link", { name: "1 running, 2 queued" });
    await expect(count).toBeVisible();
    await expect(count).toHaveCSS("animation-name", "none");
    await page.locator("#C-g-flow .follow button").first().click();
    await expect.poll(() => dotsAnimation(page), { timeout: 8000 }).toBe("none 0s");
  });
});
