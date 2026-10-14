/**
 * Hunk scores + plotlines (issue #169) against mock mode: header dots and
 * plotline tags, the Files list dots and legend, the filter dropdown's
 * plotline/score groups, and the guide's plotlines box.
 */
import { expect, test } from "./network-guard.js";

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

test("hunk headers carry score dots and plotline tags", async ({ page }) => {
  const dots = page.locator(".dhunk-h .score-dot");
  await expect(dots.first()).toBeVisible();
  await expect(page.locator('.dhunk-h .score-dot[data-score="substantive"]').first()).toBeVisible();
  await expect(page.locator(".dhunk-h .ptag", { hasText: "Unfold folded values" }).first()).toBeVisible();
  await expect(page.locator(".dhunk-h .ptag", { hasText: "Tests for unfolding" }).first()).toBeVisible();
});

test("Files list shows file dots and the score legend", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list" }).click();
  await expect(page.locator(".flist .score-dot").first()).toBeVisible();
  const legend = page.locator(".legend");
  await expect(legend).toBeVisible();
  for (const label of ["Mechanical", "Routine", "Substantive", "Needs attention"]) {
    await expect(legend.getByText(label)).toBeVisible();
  }
});

test("filter dropdown filters by plotline, by score, and both", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list" }).click();
  const filter = page.getByRole("button", { name: "File filters" });
  await filter.click();
  const menu = page.getByRole("menu", { name: "File filters" });
  // Both new groups are present alongside the six checkbox rows.
  await expect(menu.getByRole("menuitemradio", { name: /Unfold folded values/ })).toBeVisible();
  await expect(menu.getByRole("menuitemradio", { name: /Mechanical/ })).toBeVisible();
  // By plotline: only the connection file carries unfold hunks.
  await menu.getByRole("menuitemradio", { name: /Unfold folded values/ }).click();
  await expect(page.locator(connFile)).toBeVisible();
  await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
  // By score as well: unfold + substantive is the first connection hunk only.
  await menu.getByRole("menuitemradio", { name: /^Substantive/ }).click();
  await expect(page.locator(connFile)).toBeVisible();
  await expect(page.locator(`[id="F-${TSOCK}"]`)).toHaveCount(0);
  // The button carries an active count for the two radio groups.
  await expect(filter.locator(".count")).toHaveText("2");
});

test("guide root lists plotlines with hunk counts", async ({ page }) => {
  const box = page.locator(".plotlines");
  await expect(box).toBeVisible();
  await expect(box.getByText("Unfold folded values")).toBeVisible();
  await expect(box.getByText("Tests for unfolding")).toBeVisible();
  await expect(box.getByText("Other")).toBeVisible();
  await expect(box.getByText(/hunks?/ ).first()).toBeVisible();
});
