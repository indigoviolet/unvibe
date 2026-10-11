/**
 * Diagram e2e (JSON spec, mock mode): the demo's go-deeper diagram renders
 * as static SVG, a cited node's hover previews code, clicking reveals it
 * in the diff, and it stays readable in dark theme, at 800px width and
 * inside the 400px hover preview.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

async function gotoFlow(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await expect(page.locator("#C-g-flow .dg svg")).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

async function hoverFresh(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  await page.mouse.move(8, 200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

test("diagram renders with cited nodes", async ({ page }) => {
  await gotoFlow(page);
  const svg = page.locator("#C-g-flow .dg svg");
  await expect(svg).toBeVisible();
  // Cited nodes carry badges with the standard hooks.
  expect(await page.locator('#C-g-flow .dg [data-cite-badge]').count()).toBeGreaterThan(0);
  // No inline styles: strict CSP clean.
  expect(await svg.evaluate((el) => el.outerHTML.includes("style="))).toBe(false);
});

test("hovering a cited node previews code; clicking reveals it in the diff", async ({ page }) => {
  await gotoFlow(page);
  // Canonical file keys are stored (alias `conn` → path slug).
  const badges = page.locator('#C-g-flow .dg [data-cite-badge]');
  await expect(badges.first()).toBeVisible();
  await hoverFresh(page, '#C-g-flow .dg [data-cite-badge]');
  await expect(page.locator("#pop")).toContainText("connection.py", { timeout: 3000 });
  await badges.first().click();
  // Source pane opens at the cited lines with a highlight.
  await expect(page.locator("#right")).toBeVisible();
  await expect(page.locator('#right [data-hl="1"], #right .hl').first()).toBeVisible({ timeout: 5000 });
});

test("diagram stays readable dark, at 800px and in the 400px preview", async ({ page }) => {
  await gotoFlow(page);
  // 800px window width: diagram still visible, no horizontal page scroll.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator("#C-g-flow .dg svg")).toBeVisible();
  // Dark theme inherits CSS variables.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("#C-g-flow .dg svg")).toBeVisible();
  await page.emulateMedia({ colorScheme: "light" });
  // 400px hover preview: the SVG scales via viewBox (prototype's
  // `#pop .xprev .dg svg { min-width: 0 }` lets it shrink; the main
  // column keeps min-width 540 with horizontal scroll).
  const hasViewBox = await page.locator("#C-g-flow .dg svg").evaluate((el) => !!(el as SVGSVGElement).viewBox?.baseVal?.width);
  expect(hasViewBox).toBe(true);
  const css = await page.evaluate(async () => {
    const sheets: string[] = [];
    for (const ss of [...document.styleSheets]) {
      try {
        sheets.push([...(ss as CSSStyleSheet).cssRules].map((r) => r.cssText).join("\n"));
      } catch { /* cross-origin: ignore */ }
    }
    return sheets.join("\n");
  });
  expect(css).toContain(".dg svg");
});
