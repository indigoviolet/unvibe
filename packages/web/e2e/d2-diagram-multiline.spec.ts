/**
 * Multi-line diagram labels in mock mode (issue #16, round two): the
 * service sanitiser once stripped tspan x/dy, collapsing every line onto
 * one baseline. The mock multi-line block carries two- and three-line
 * shapes plus a masked edge label; this spec asserts each line lands on
 * its own baseline inline and expanded, in light and dark.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const BLOCK = "#C-g-flow #B-b-mock-d2-multiline";
const DIALOG = '[role="dialog"][aria-label="Expanded diagram"]';

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await expect(page.locator(`${BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Vertical centers of every tspan line, grouped per label. */
async function lineTops(page: Page, scope: string): Promise<number[][]> {
  return page.locator(`${scope} .dg-svg > svg`).evaluate((svg) => {
    const groups: number[][] = [];
    for (const text of svg.querySelectorAll("text")) {
      const spans = [...text.querySelectorAll("tspan")];
      if (spans.length < 2) continue;
      groups.push(
        spans.map((t) => {
          const r = (t as SVGGraphicsElement).getBoundingClientRect();
          return r.top + r.height / 2;
        }),
      );
    }
    return groups;
  });
}

function expectStacked(groups: number[][]): void {
  // The two- and three-line shapes from the mock block.
  expect(groups).toHaveLength(2);
  expect(groups[0]).toHaveLength(2);
  expect(groups[1]).toHaveLength(3);
  for (const lines of groups) {
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i] - lines[i - 1]).toBeGreaterThan(5);
    }
  }
}

async function expectMaskIntact(page: Page, scope: string): Promise<void> {
  const mask = await page.locator(`${scope} .dg-svg > svg`).evaluate((svg) => {
    const mask = svg.querySelector("mask");
    const path = svg.querySelector("path[mask]");
    return {
      units: mask?.getAttribute("maskUnits"),
      maskId: mask?.getAttribute("id"),
      pathMask: path?.getAttribute("mask"),
    };
  });
  // The edge label clears the line behind it via a userSpaceOnUse mask;
  // the path's url must name the surviving (namespaced) mask id.
  expect(mask.units).toBe("userSpaceOnUse");
  expect(mask.maskId).not.toBeNull();
  expect(mask.pathMask).toBe(`url(#${mask.maskId})`);
}

test("multi-line labels stack inline in light", async ({ page }) => {
  await gotoReview(page);
  expectStacked(await lineTops(page, BLOCK));
  await expectMaskIntact(page, BLOCK);
});

test("multi-line labels stack inline in dark", async ({ page }) => {
  await gotoReview(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect
    .poll(() => page.locator(`${BLOCK} .dg-svg`).innerHTML(), { timeout: 10000 })
    .toContain('data-mock-theme="dark"');
  expectStacked(await lineTops(page, BLOCK));
  await expectMaskIntact(page, BLOCK);
});

test("multi-line labels stack expanded in light and dark", async ({ page }) => {
  await gotoReview(page);
  await page.locator(`${BLOCK} .dg-expand`).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await expect(page.locator(`${DIALOG} .dg-ov-doc .dg-svg > svg`)).toBeVisible({
    timeout: 15000,
  });
  expectStacked(await lineTops(page, DIALOG));
  await expectMaskIntact(page, DIALOG);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect
    .poll(() => page.locator(`${DIALOG} .dg-ov-doc .dg-svg`).innerHTML(), { timeout: 10000 })
    .toContain('data-mock-theme="dark"');
  expectStacked(await lineTops(page, DIALOG));
  await expectMaskIntact(page, DIALOG);
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
});
