/**
 * Diff-pane behaviour tests against mock mode (PRD §4.13): fold/unfold,
 * mark reviewed, hide-uninteresting rows, split widening, files filter, and
 * `revealSource` on a hidden + a folded hunk — plus the start page's
 * open-review flow.
 *
 * File keys are the service-canonical path slugs, so element ids contain
 * dots: select them with `[id="…"]` (a `#…` selector would parse the dots
 * as class names).
 */
import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;
const tsockFile = `[id="F-${TSOCK}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

test("fold and unfold a hunk", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Fold code" }).first().click();
  await expect(conn.getByText("changed lines folded · show")).toBeVisible();
  await conn.getByText("changed lines folded · show").click();
  await expect(conn.getByText("changed lines folded · show")).toHaveCount(0);
});

test("mark reviewed advances the hunks-reviewed progress", async ({ page }) => {
  await page.getByRole("button", { name: "Show files panel" }).click();
  await expect(page.getByText("1/8 hunks reviewed")).toBeVisible();
  await page.locator(connFile).getByRole("button", { name: "Mark reviewed" }).first().click();
  await expect(page.getByText("2/8 hunks reviewed")).toBeVisible();
});

test("hide uninteresting collapses runs to one row per run", async ({ page }) => {
  await expect(page.locator("button.hid")).toHaveCount(2);
  await expect(page.getByText(/Hunks 1–2 of 3 hidden · imports/)).toBeVisible();
  await page.getByRole("button", { name: "Hide uninteresting" }).click();
  await expect(page.locator("button.hid")).toHaveCount(0);
  await page.getByRole("button", { name: "Hide uninteresting" }).click();
  await expect(page.locator("button.hid")).toHaveCount(2);
});

test("split view pairs columns and widens a narrow pane", async ({ page }) => {
  const right = page.locator("#right");
  const before = await right.boundingBox();
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(`${connFile} table.diff.split`)).toBeVisible();
  await expect(page.locator(`${connFile} table.diff.split colgroup`)).toHaveCount(1);
  const after = await right.boundingBox();
  expect(before?.width).toBeLessThan(after?.width ?? 0);
});

test("files filter narrows the visible files", async ({ page }) => {
  await page.getByRole("button", { name: "Show files panel" }).click();
  await page.getByLabel("Filter files by name").fill("socketlevel");
  await expect(page.locator(connFile)).toHaveCount(0);
  await expect(page.locator(tsockFile)).toBeVisible();
});

test("revealSource unhides a hidden hunk and highlights the line", async ({ page }) => {
  await expect(page.locator("button.hid")).toHaveCount(2);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:5`), TCONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${TCONN}-5"].hl`)).toBeVisible();
  // The hidden run expanded to show the hunk.
  await expect(page.getByText("Hunk 1 of 3")).toBeVisible();
});

test("revealSource unfolds a folded hunk and highlights the range", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Fold code" }).nth(1).click();
  await expect(conn.getByText("3 changed lines folded · show")).toBeVisible();
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650-651`), CONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${CONN}-650"].hl`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-651"].hl`)).toBeVisible();
  await expect(conn.getByText("3 changed lines folded · show")).toHaveCount(0);
});

test("start page opens a review", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Open a review")).toBeVisible();
  await expect(page.getByText("urllib3/urllib3")).toBeVisible();
  await page.getByText("Unfold obsolete folded response header values").first().click();
  await expect(page).toHaveURL(/\/review\/demo/);
  await expect(page.locator(connFile)).toBeVisible();
});
