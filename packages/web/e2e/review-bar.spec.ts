/**
 * Review bar behaviour tests against mock mode (issue #31 round 2 +
 * issue #83, one-bar layout in issue #141): the home control (the only
 * bar on a review, no breadcrumb), identity + GitHub link-out + Debug
 * icon, the [ Guide | Source ] selector (pane toggles, full-width source,
 * never both hidden), Comments + Submit side by side, and narrow-window
 * no-overflow.
 */
import { expect, test } from "./network-guard.js";

const CONN = "src-urllib3-connection.py";
const connFile = `[id="F-${CONN}"]`;

async function gotoDemo(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
}

// DISABLED(#119): same attributes asserted by the ReviewBar.test.tsx test of the same name
test.skip("review bar shows identity, GitHub link, Debug, Guide|Source, Comments and Submit", async ({
  page,
}) => {
  // r-old is a PR review; the demo hides its GitHub link (mock snapshot
  // carries repoId "demo" like the real demo), so the link case uses r-old.
  await page.goto("/review/r-old");
  await expect(page.locator(connFile)).toBeVisible();
  const bar = page.locator("#reviewbar");
  await expect(bar).toBeVisible();
  await expect(bar.getByText("urllib3/urllib3#5011")).toBeVisible();
  const github = bar.getByRole("link", { name: "Open PR on GitHub" });
  await expect(github).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5011");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(bar.getByRole("link", { name: "Debug" })).toHaveAttribute(
    "href",
    "/review/r-old/debug",
  );
  await expect(bar.getByRole("button", { name: "Guide" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator('[data-cm=""]')).toBeVisible();
  // Submit is the primary action in the bar.
  await expect(bar.locator('#submitSlot [data-submit]')).toHaveClass(/btn/);
});

// DISABLED(#119): same as the ReviewBar.test.tsx demo test
test.skip("demo review shows no GitHub link", async ({ page }) => {
  await gotoDemo(page);
  const bar = page.locator("#reviewbar");
  await expect(bar.getByText("urllib3/urllib3#5020")).toBeVisible();
  await expect(bar.getByRole("link", { name: "Open PR on GitHub" })).toHaveCount(0);
});

test("review page has one bar with a home control and no breadcrumb", async ({ page }) => {
  await gotoDemo(page);
  // Issue #141: no application top bar on a review.
  await expect(page.locator("header.top")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
  const bar = page.locator("#reviewbar");
  await expect(bar).toBeVisible();
  const home = bar.getByRole("link", { name: "Back to the start page" });
  await expect(home).toHaveAttribute("href", "/");
  await home.click();
  await expect(page).toHaveURL("/");
});

test("comments menu opens with the source pane closed", async ({ page }) => {
  await gotoDemo(page);
  await page.locator("#toggleRight").click();
  await expect(page.locator("#right")).toHaveClass(/hide/);
  await page.locator('#reviewbar [data-cm=""]').click();
  await expect(page.locator("#reviewbar .cmenu")).toBeVisible();
  await expect(page.locator("#reviewbar .cmenu")).toContainText("On GitHub");
});

test("review bar does not overflow at 800px", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toBeVisible();
  const overflow = await page
    .locator("#reviewbar")
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("older version annotates current and keeps the title at 800px (issue #120)", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/review/r-old?version=1");
  await expect(page.locator("#reviewbar")).toBeVisible();
  // Rendered once, in the bar: the select shows the older version with
  // the warning state, current is annotated in the dropdown, and there
  // is no notice and no back button in the bar.
  const switcher = page.locator('#reviewbar [data-testid="version-switcher"]');
  await expect(switcher).toHaveCount(1);
  await expect(switcher).toHaveAttribute("data-ro", "1");
  await expect(page.locator("#version-pick option", { hasText: "current" })).toContainText("v2");
  await expect(page.getByRole("button", { name: "Back to current" })).toHaveCount(0);
  // The title is no longer squeezed out entirely.
  const titleBox = await page.locator("#reviewbar .rid b").boundingBox();
  expect(titleBox?.width).toBeGreaterThan(0);
  const overflow = await page.locator("#reviewbar").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Choosing the annotated current version is the way back.
  await page.locator("#version-pick").selectOption("2");
  await expect(page).not.toHaveURL(/version=1/);
});

test("guide toggle at 1440px: source-only spans the window, then back (issue #83)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
  const guide = page.getByRole("button", { name: "Guide" });
  await expect(guide).toHaveAttribute("aria-pressed", "true");
  // Guide off: the source pane spans the window, no drag handle.
  await guide.click();
  await expect(page.locator("#page")).toHaveClass(/hide/);
  const box = await page.locator("#right").boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(1430);
  await expect(page.locator("#handle")).toBeHidden();
  // Back on: the two-pane split returns.
  await guide.click();
  await expect(page.locator("#page")).not.toHaveClass(/hide/);
  await expect(page.locator("#right")).not.toHaveClass(/hide/);
  await expect(page.locator("#handle")).toBeVisible();
});

// DISABLED(#119): pane-toggle state machine already in AppShell.test.tsx (class assertions only, no layout)
test.skip("the panes cannot both be hidden", async ({ page }) => {
  // Source off first: only the guide shows.
  await page.locator("#toggleRight").click();
  await expect(page.locator("#right")).toHaveClass(/hide/);
  // Guide then acts as a switch to source-only (never both hidden).
  await page.getByRole("button", { name: "Guide" }).click();
  await expect(page.locator("#page")).toHaveClass(/hide/);
  await expect(page.locator("#right")).not.toHaveClass(/hide/);
  // Source switches back to guide-only.
  await page.locator("#toggleRight").click();
  await expect(page.locator("#page")).not.toHaveClass(/hide/);
  await expect(page.locator("#right")).toHaveClass(/hide/);
});

test("no full-access marker while the setting is off", async ({ page }) => {
  await gotoDemo(page);
  await expect(page.locator("#reviewbar")).toBeVisible();
  await expect(page.getByTestId("full-access-marker")).toHaveCount(0);
});
