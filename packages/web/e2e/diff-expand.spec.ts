/**
 * Expand-by-lines behaviour tests against mock mode (issue #133, stage
 * 1): step controls above/below hunks, gap show-all with continuity,
 * collapse, split alignment, and no comment start on revealed lines.
 *
 * File keys are the service-canonical path slugs, so element ids contain
 * dots: select them with `[id="…"]`.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const connFile = `[id="F-${CONN}"]`;
const tconnFile = `[id="F-${TCONN}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

test("expands above a hunk in steps and collapses back", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
  const revealed = conn.locator("tr[data-revealed]");
  await expect(revealed).toHaveCount(20);
  await expect(page.locator(`[id="L-${CONN}-76"]`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-56"]`)).toHaveCount(0);
  // A second step continues upward.
  await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(40);
  await expect(page.locator(`[id="L-${CONN}-37"]`)).toBeVisible();
  // Collapse hides the region again.
  await conn.getByRole("button", { name: "Hide shown lines" }).click();
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(0);
});

test("reveals a whole gap so the hunks read as continuous", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByText(/Hunks 1–2 of 3 hidden · imports/).click();
  await expect(page.getByText("Hunk 1 of 3")).toBeVisible();
  const tconn = page.locator(tconnFile);
  await tconn.getByRole("button", { name: "Show all 4 lines" }).click();
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(4);
  for (const n of [10, 11, 12, 13]) {
    await expect(page.locator(`[id="L-${TCONN}-${n}"]`)).toBeVisible();
  }
  // Fully revealed: this gap's show-all is gone, only the slim hide.
  await expect(tconn.getByRole("button", { name: "Show all 4 lines" })).toHaveCount(0);
  await tconn.getByRole("button", { name: "Hide shown lines" }).click();
  await expect(tconn.locator("tr[data-revealed]")).toHaveCount(0);
});

test("split view keeps both sides of revealed lines aligned", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
  const row = page.locator(`[id="L-${CONN}-76"]`);
  await expect(row).toBeVisible();
  await expect(row.locator("td.n")).toHaveCount(2);
  await expect(row.locator("td.n").first()).toHaveText("76");
  await expect(row.locator("td.n").nth(1)).toHaveText("76");
});

test("revealed lines offer no comment start", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Show 20 more lines" }).first().click();
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(20);
  // No comment affordance on revealed number cells…
  await expect(page.locator("tr[data-revealed] td.n.new")).toHaveCount(0);
  await expect(page.locator("tr[data-revealed] td.n[data-line]")).toHaveCount(0);
  // …and clicking one opens no comment composer.
  await page.locator(`[id="L-${CONN}-76"]`).locator("td.n").nth(1).click();
  await expect(page.locator("tr[data-revealed]")).toHaveCount(20);
});

test("steps from function to class with the unit name in the hunk header", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByText("Hunk 2 of 2").scrollIntoViewIfNeeded();
  await conn.getByRole("button", { name: "Show the enclosing function or class" }).nth(1).click();
  await expect(conn.locator("tr[data-revealed]")).toHaveCount(18);
  await expect(page.locator(`[id="L-${CONN}-640"]`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-665"]`)).toBeVisible();
  await expect(conn.getByText(/in getresponse/)).toBeVisible();
  await conn.getByRole("button", { name: "Show enclosing class HTTPConnection" }).click();
  await expect(conn.getByText(/in HTTPConnection/)).toBeVisible();
  await expect(conn.getByRole("button", { name: "Show the whole file" })).toBeVisible();
});

test("hides the unit control when no unit encloses the hunk", async ({ page }) => {
  const conn = page.locator(connFile);
  // First hunk spans top-level items: the outline is empty.
  await conn.getByRole("button", { name: "Show the enclosing function or class" }).first().click();
  await expect(conn.getByRole("button", { name: "Show the enclosing function or class" })).toHaveCount(1);
});
