/**
 * Review bar behaviour tests against mock mode (issue #31 round 2 +
 * issue #83): identity + GitHub link-out + Debug icon, the
 * [ Guide | Source ] selector (pane toggles, full-width source, never
 * both hidden), Comments + Submit side by side, and narrow-window
 * no-overflow.
 */
import { expect, test } from "./network-guard.js";

const CONN = "src-urllib3-connection.py";
const connFile = `[id="F-${CONN}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

test("review bar shows identity, GitHub link, Debug, Guide|Source, Comments and Submit", async ({
  page,
}) => {
  const bar = page.locator("#reviewbar");
  await expect(bar).toBeVisible();
  await expect(bar.getByText("urllib3/urllib3#5020")).toBeVisible();
  await expect(bar.getByText("Unfold obsolete folded response header values")).toBeVisible();
  const github = bar.getByRole("link", { name: "Open PR on GitHub" });
  await expect(github).toHaveAttribute("href", "https://github.com/urllib3/urllib3/pull/5020");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(bar.getByRole("link", { name: "Debug" })).toHaveAttribute(
    "href",
    "/review/demo/debug",
  );
  await expect(bar.getByRole("button", { name: "Guide" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.getByRole("button", { name: "Source" })).toHaveAttribute("aria-pressed", "true");
  await expect(bar.locator('[data-cm=""]')).toBeVisible();
  // Submit is the primary action in the bar.
  await expect(bar.locator('#submitSlot [data-submit]')).toHaveClass(/btn/);
});

test("review breadcrumb names the review as the current page", async ({ page }) => {
  await expect(page.getByRole("link", { name: "Unvibe" })).toHaveAttribute("href", "/");
  const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(crumbs.getByText("urllib3/urllib3#5020")).toHaveAttribute("aria-current", "page");
});

test("comments menu opens with the source pane closed", async ({ page }) => {
  await page.locator("#toggleRight").click();
  await expect(page.locator("#right")).toHaveClass(/hide/);
  await page.locator('#reviewbar [data-cm=""]').click();
  await expect(page.locator("#reviewbar .cmenu")).toBeVisible();
  await expect(page.locator("#reviewbar .cmenu")).toContainText("Already on GitHub");
});

test("review bar and top bar do not overflow at 800px", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toBeVisible();
  for (const sel of ["header.top", "#reviewbar"]) {
    const overflow = await page.locator(sel).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
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

test("the panes cannot both be hidden", async ({ page }) => {
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
