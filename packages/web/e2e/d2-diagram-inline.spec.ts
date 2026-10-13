/**
 * Inline in-place diagram zoom + breakout width in mock mode (round two,
 * items 2–3): the diagram fits its block by default (no scrollbars, never
 * above natural size); +/−/Reset zoom in place, Ctrl/Cmd+wheel zooms while
 * a plain wheel scrolls the page, drag pans once zoomed, citations work at
 * any zoom; with the source pane closed the block breaks out beyond the
 * text column without clipping or scrolling the guide pane.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const BLOCK = "#C-g-flow #B-b1";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await expect(page.locator(`${BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

function inlineTransform(page: Page): Promise<string> {
  return page.locator(`${BLOCK} .dg-doc`).evaluate((el) => (el as HTMLElement).style.transform);
}

async function sourceOpen(page: Page, open: boolean): Promise<void> {
  const toggle = page.locator("#toggleRight");
  if ((await toggle.getAttribute("aria-pressed")) !== String(open)) {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-pressed", String(open));
}

test("wide diagram fits the block with no scrollbars, never above natural size", async ({
  page,
}) => {
  await gotoReview(page);
  const m = await page.locator(BLOCK).evaluate((el) => {
    const dg = el.querySelector(".dg") as HTMLElement;
    const svg = el.querySelector(".dg-svg > svg") as SVGSVGElement;
    return {
      scroll: dg.scrollWidth - dg.clientWidth,
      svgW: svg.getBoundingClientRect().width,
    };
  });
  expect(m.scroll).toBeLessThanOrEqual(1);
  expect(m.svgW).toBeLessThanOrEqual(1379 + 1);
  await expect(page.locator(`${BLOCK} .dg-bar`)).toContainText("100%");
});

// DISABLED(#119): same title and assertions as DiagramInlineZoom.test.tsx (41 ms, no browser needed)
test.skip("zoom buttons zoom in place and Reset restores", async ({ page }) => {
  await gotoReview(page);
  const bar = page.locator(`${BLOCK} .dg-bar`);
  await bar.getByRole("button", { name: "Zoom in" }).click();
  expect(await inlineTransform(page)).toContain("scale(1.25)");
  await expect(bar).toContainText("125%");
  await bar.getByRole("button", { name: "Reset view" }).click();
  expect(await inlineTransform(page)).toBe("translate(0px, 0px) scale(1)");
  await expect(bar).toContainText("100%");
});

test("Ctrl+wheel zooms but a plain wheel scrolls the page instead", async ({ page }) => {
  await gotoReview(page);
  const svg = page.locator(`${BLOCK} .dg-svg > svg`);
  await svg.scrollIntoViewIfNeeded();
  // Park the diagram mid-viewport so a wheel has somewhere to scroll to.
  await page.evaluate(() => {
    document.querySelector("#C-g-flow #B-b1")?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
  const box = await svg.boundingBox();
  if (!box) throw new Error("diagram svg has no box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  const scrolledFrom = await page.evaluate(() => document.querySelector("#page")?.scrollTop ?? 0);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  expect(await inlineTransform(page)).toBe("translate(0px, 0px) scale(1)");
  const scrolledTo = await page.evaluate(() => document.querySelector("#page")?.scrollTop ?? 0);
  expect(scrolledTo).toBeGreaterThan(scrolledFrom);
  // With Ctrl held the same gesture zooms around the pointer instead
  // (re-aim: the scroll above moved the diagram; re-center it first so
  // the two-bar header cannot cover the aim point — main-rc).
  await page.evaluate(() => {
    document.querySelector("#C-g-flow #B-b1")?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
  const box2 = await svg.boundingBox();
  if (!box2) throw new Error("diagram svg has no box");
  await page.keyboard.down("Control");
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await expect.poll(() => inlineTransform(page), { timeout: 5000 }).not.toBe("translate(0px, 0px) scale(1)");
});

test("drag pans once zoomed and Reset restores; citations click after zoom", async ({
  page,
}) => {
  await gotoReview(page);
  await page.locator(`${BLOCK} .dg-bar`).getByRole("button", { name: "Zoom in" }).click();
  const view = page.locator(`${BLOCK} .dg-view`);
  const box = await view.boundingBox();
  if (!box) throw new Error("inline viewport has no box");
  const before = await inlineTransform(page);
  await page.mouse.move(box.x + 200, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => inlineTransform(page), { timeout: 5000 }).not.toBe(before);
  // A cited shape still reveals in the diff without changing the URL.
  const urlBefore = page.url();
  await page.locator(`${BLOCK} .dg-svg a[data-refs]`).first().click();
  expect(page.url()).toBe(urlBefore);
  await expect(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
    timeout: 5000,
  });
  await page.locator(`${BLOCK} .dg-bar`).getByRole("button", { name: "Reset view" }).click();
  expect(await inlineTransform(page)).toBe("translate(0px, 0px) scale(1)");
});

test("source closed: the block breaks out past the column without clipping", async ({
  page,
}) => {
  await gotoReview(page);
  await sourceOpen(page, true);
  const open = await page.locator(BLOCK).evaluate((el) => {
    const dg = el.querySelector(".dg") as HTMLElement;
    const blk = el.closest(".blk") as HTMLElement;
    const cap = el.querySelector(".dg-cap") as HTMLElement;
    return {
      dgW: dg.getBoundingClientRect().width,
      blkW: blk.getBoundingClientRect().width,
      capW: cap ? cap.getBoundingClientRect().width : 0,
    };
  });
  await sourceOpen(page, false);
  const closed = await page.evaluate(() => {
    const blk = document.querySelector("#C-g-flow #B-b1") as HTMLElement;
    const dg = blk.querySelector(".dg") as HTMLElement;
    const svg = blk.querySelector(".dg-svg > svg") as SVGSVGElement;
    const cap = blk.querySelector(".dg-cap") as HTMLElement;
    const pane = document.querySelector("#page") as HTMLElement;
    const pcs = getComputedStyle(pane);
    const padR = Number.parseFloat(pcs.paddingRight) || 0;
    const paneRect = pane.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    return {
      dgW: dg.getBoundingClientRect().width,
      blkW: blk.getBoundingClientRect().width,
      capW: cap ? cap.getBoundingClientRect().width : 0,
      // The whole svg stays inside the pane: not clipped…
      clipped: svgRect.right - (paneRect.right - padR),
      // …and the pane never scrolls sideways.
      paneScroll: pane.scrollWidth - pane.clientWidth,
    };
  });
  // Meaningfully wider than with the source open, and past the column…
  expect(closed.dgW).toBeGreaterThan(open.dgW + 50);
  expect(closed.dgW).toBeGreaterThan(closed.blkW + 10);
  // …but not clipped, with no sideways scroll, and the caption (like the
  // text) stays column-aligned.
  expect(closed.clipped).toBeLessThanOrEqual(1);
  expect(closed.paneScroll).toBeLessThanOrEqual(1);
  expect(Math.abs(closed.capW - closed.blkW)).toBeLessThanOrEqual(2);
});
