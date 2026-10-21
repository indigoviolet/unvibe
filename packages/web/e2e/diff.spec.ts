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
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

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

/**
 * Hunk bodies below the fold render lazily (headers mount, bodies on
 * IntersectionObserver), so scroll the pane to the bottom before counting
 * hidden rows. (Without the `#root` height fix the whole page scrolled and
 * every body rendered upfront.)
 */
async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

// DISABLED(#119): same clicks and assertions as DiffView.test.tsx fold/unfold test
test.skip("fold and unfold a hunk", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Fold code" }).first().click();
  // One unfold control only: the header chevron, no placeholder row.
  await expect(conn.getByRole("button", { name: "Show code" })).toBeVisible();
  await expect(conn.getByText("changed lines folded · show")).toHaveCount(0);
  await conn.getByRole("button", { name: "Show code" }).click();
  await expect(conn.getByRole("button", { name: "Show code" })).toHaveCount(0);
});

test("reviewed progress fills the toolbar bottom border; counts only in its label", async ({ page }) => {
  const bar = page.getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-label", "1 of 8 hunks reviewed");
  // Poll: the fill has a short width transition.
  await expect
    .poll(async () =>
      bar.evaluate((el) => {
        const fill = el.querySelector("i")!;
        return fill.getBoundingClientRect().width / el.getBoundingClientRect().width;
      }),
    )
    .toBeCloseTo(1 / 8, 1);
  expect(await bar.getAttribute("data-tip")).toBe("1 of 8 hunks reviewed");
  // No text line for the counts anywhere.
  await expect(page.getByText(/\d+\/8 hunks reviewed/)).toHaveCount(0);
  await page.locator(connFile).getByRole("checkbox", { name: "Mark reviewed" }).first().click();
  await expect(bar).toHaveAttribute("aria-label", "2 of 8 hunks reviewed");
  await expect
    .poll(async () =>
      bar.evaluate((el) => {
        const fill = el.querySelector("i")!;
        return fill.getBoundingClientRect().width / el.getBoundingClientRect().width;
      }),
    )
    .toBeCloseTo(2 / 8, 1);
});

test("the toolbar stays on one row at a narrow pane width", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  const rows = await page.locator(".dtool").evaluate((el) => {
    const tops = new Set(
      [...el.children]
        .filter((c) => !c.classList.contains("rprog"))
        .map((c) => { const r = (c as HTMLElement).getBoundingClientRect(); return Math.round(r.top + r.height / 2); }),
    );
    return { tops: tops.size, height: el.getBoundingClientRect().height };
  });
  expect(rows.tops).toBe(1);
});

// DISABLED(#119): same as the DiffView.test.tsx progress test (also in real-service.spec.ts)
test.skip("mark reviewed advances the hunks-reviewed progress", async ({ page }) => {
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "1 of 8 hunks reviewed");
  await page.locator(connFile).getByRole("checkbox", { name: "Mark reviewed" }).first().click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-label", "2 of 8 hunks reviewed");
});

test("hide uninteresting collapses runs to one row per run", async ({ page }) => {
  await scrollDiffToBottom(page);
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
  await expect(page.locator(`${connFile} table.diff.split`).first()).toBeVisible();
  // One table (and colgroup) per hunk: the fixture's first file has two.
  await expect(page.locator(`${connFile} table.diff.split colgroup`)).toHaveCount(2);
  const after = await right.boundingBox();
  expect(before?.width).toBeLessThan(after?.width ?? 0);
});

// DISABLED(#119): same as the DiffView.test.tsx files-filter test
test.skip("files filter narrows the visible files", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list" }).click();
  await page.getByLabel("Filter files by name").fill("socketlevel");
  await expect(page.locator(connFile)).toHaveCount(0);
  await expect(page.locator(tsockFile)).toBeVisible();
});

test("file filter dropdown filters by type with counts and an active state", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list" }).click();
  const filter = page.getByRole("button", { name: "File filters" });
  await expect(filter).toBeVisible();
  // Default: no active state, and no count badge anywhere.
  await expect(filter).toHaveAttribute("aria-pressed", "false");
  await expect(filter.locator(".count")).toHaveCount(0);
  await filter.click();
  const menu = page.getByRole("menu", { name: "File filters" });
  await expect(menu).toBeVisible();
  // File types only (#184): Reviewed and GitHub comments left this menu.
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(5);
  for (const name of ["Code", "Tests", "Docs", "Config", "Generated"]) {
    await expect(menu.getByRole("menuitemcheckbox", { name: new RegExp(name) })).toBeVisible();
  }
  await expect(menu.getByRole("menuitemcheckbox", { name: /Reviewed|GitHub/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // The toolbar's second filter holds Reviewed and GitHub comments.
  const reviewFilter = page.getByRole("button", { name: "Review filters" });
  await reviewFilter.click();
  const reviewMenu = page.getByRole("menu", { name: "Review filters" });
  await expect(reviewMenu.getByRole("menuitemcheckbox")).toHaveCount(2);
  await expect(reviewMenu.getByRole("menuitemcheckbox", { name: /Reviewed/ })).toBeVisible();
  await expect(reviewMenu.getByRole("menuitemcheckbox", { name: /GitHub comments/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await filter.click();
  // Deselect Tests: its files hide and the button shows the active count.
  await menu.getByRole("menuitemcheckbox", { name: /Tests/ }).click();
  await expect(page.locator(connFile)).toBeVisible();
  await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
  await expect(filter).toHaveAttribute("aria-pressed", "true");
  await expect(filter).toHaveAttribute("data-tip", "Hiding: Tests");
  // Stored prefs survive a reload.
  await page.reload();
  await expect(page.locator(connFile)).toBeVisible();
  await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "File filters" })).toHaveAttribute("data-tip", "Hiding: Tests");
});

test("file filter dropdown is keyboard-usable and closes on Escape", async ({ page }) => {
  await page.getByRole("button", { name: "Show file list" }).click();
  const filter = page.getByRole("button", { name: "File filters" });
  await filter.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "File filters" });
  await expect(menu).toBeVisible();
  // ArrowDown moves focus down the rows.
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitemcheckbox", { name: /Tests/ })).toBeFocused();
  // Space toggles the focused row; the menu stays open for multi-toggle.
  await page.keyboard.press("Space");
  await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
  await expect(menu).toBeVisible();
  // Escape closes and returns focus to the button.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(filter).toBeFocused();
});

test("revealSource unhides a hidden hunk and highlights the line", async ({ page }) => {
  await scrollDiffToBottom(page);
  await expect(page.locator("button.hid")).toHaveCount(2);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:5`), TCONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${TCONN}-5"].hl`)).toBeVisible();
  // The hidden run expanded to show the hunk.
  await expect(page.getByText("Hunk 1 of 3")).toBeVisible();
});

// DISABLED(#119): same as the DiffView.test.tsx revealSource test
test.skip("revealSource unfolds a folded hunk and highlights the range", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Fold code" }).nth(1).click();
  await expect(conn.getByRole("button", { name: "Show code" })).toBeVisible();
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650-651`), CONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${CONN}-650"].hl`)).toBeVisible();
  await expect(page.locator(`[id="L-${CONN}-651"].hl`)).toBeVisible();
  await expect(conn.getByRole("button", { name: "Show code" })).toHaveCount(0);
});

// Issue #162: file fold survives a tab switch, and file reviewed derives
// from hunks with a partial state.
test("file fold survives a tab switch; file reviewed derives from hunks", async ({ page }) => {
  const conn = page.locator(connFile);
  await conn.getByRole("button", { name: "Collapse file" }).click();
  await expect(conn.locator(".dbody")).toHaveCount(0);
  // To the description tab and back: the fold must survive.
  await page.getByRole("tab", { name: "PR description" }).click();
  await expect(conn).toHaveCount(0);
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.locator(connFile).locator(".dbody")).toHaveCount(0);
  await page.locator(connFile).getByRole("button", { name: "Expand file" }).click();
  await expect(page.locator(connFile).locator(".dbody")).toHaveCount(1);
  // File reviewed derives from hunks: mark the file, unmark one hunk.
  const file = page.locator(connFile);
  await expect(file.getByText("0/2")).toBeVisible();
  await file.getByRole("checkbox", { name: "Mark file reviewed" }).click();
  await expect(file.getByText("2/2")).toBeVisible();
  await expect(file.getByRole("checkbox", { name: "Mark file not reviewed" })).toBeChecked();
  await file.getByRole("checkbox", { name: "Mark not reviewed" }).first().click();
  await expect(file.getByText("1/2")).toBeVisible();
  const partial = file.getByRole("checkbox", { name: "Mark file reviewed" });
  await expect(partial).not.toBeChecked();
  expect(await partial.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
});

// DISABLED(#119): not a diff test; repeats start.spec.ts demo-row tests
test.skip("start page opens a review", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  // The page follows the selected repo; the remembered repo is selected.
  await expect(page.getByLabel("Repo")).toContainText("urllib3/urllib3");
  await page.locator('[data-testid="session-demo"] button.cj-open').click();
  await expect(page).toHaveURL(/\/review\/demo/);
  await expect(page.locator(connFile)).toBeVisible();
});
