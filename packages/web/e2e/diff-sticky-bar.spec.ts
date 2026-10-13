/**
 * Sticky diff actions bar (issue #132): the `.dtool` row (Files,
 * Unified/Split, Hide uninteresting, Fold all, Unfold all, Refresh) stays
 * pinned directly under the source pane's tab strip while the diff scrolls;
 * reveals and file jumps land below the pinned rows; the Files panel and
 * the filter dropdown open fully visible; the bar spans the full pane
 * width sideways and stays one row at narrow widths.
 *
 * Runs against mock mode (no service needed); the Playwright config boots
 * its own Vite server.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

declare global {
  interface Window {
    __revealSource?: (ref: string) => boolean;
  }
}

const CONN = "src-urllib3-connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";
const connFile = `[id="F-${CONN}"]`;

test.beforeEach(async ({ page }) => {
  await page.goto("/review/demo");
  await expect(page.locator(connFile)).toBeVisible();
});

interface PaneGeometry {
  pane: { y: number; bottom: number; x: number; width: number };
  stickH: number;
  bar: { y: number; bottom: number; x: number; width: number; height: number };
  barTop: number;
}

async function geometry(page: Page): Promise<PaneGeometry | null> {
  return page.evaluate(() => {
    const pane = document.getElementById("right");
    const stick = pane?.querySelector(".rstick");
    const bar = pane?.querySelector(".dtool");
    if (!(pane instanceof HTMLElement) || !(stick instanceof Element) || !(bar instanceof Element)) return null;
    const p = pane.getBoundingClientRect();
    const s = stick.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    return {
      pane: { y: p.top, bottom: p.bottom, x: p.left, width: p.width },
      stickH: s.height,
      bar: { y: b.top, bottom: b.bottom, x: b.left, width: b.width, height: b.height },
      barTop: Number.parseFloat(getComputedStyle(bar).top),
    };
  });
}

async function scrollDiffToBottom(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("#right")?.scrollTo(0, 1e9));
}

test("actions bar stays pinned under the tab strip while the diff scrolls", async ({ page }) => {
  await scrollDiffToBottom(page);
  const g = await geometry(page);
  expect(g).not.toBeNull();
  // position:sticky from CSS, with `top` tracking the live tab-strip height.
  await expect(page.locator("#right .dtool")).toBeVisible();
  const position = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).position,
  );
  expect(position).toBe("sticky");
  // Pinned directly under the strip: bar top == pane top + strip height.
  expect(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
  expect(Math.abs(g!.barTop - g!.stickH)).toBeLessThan(2.5);
  // Fully inside the pane vertically (opaque bar above scrolling content).
  expect(g!.bar.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(g!.bar.bottom).toBeLessThanOrEqual(g!.pane.bottom + 1);
});

test("a revealed line lands below the bar, not under it", async ({ page }) => {
  await scrollDiffToBottom(page);
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
  expect(ok).toBe(true);
  const line = page.locator(`[id="L-${CONN}-650"].hl`);
  await expect(line).toBeVisible();
  const g = await geometry(page);
  const lineBox = await line.boundingBox();
  expect(g).not.toBeNull();
  expect(lineBox).not.toBeNull();
  // The line's top is at or below the pinned bar's bottom.
  expect(lineBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 1);
  // ... and inside the pane viewport.
  expect(lineBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(lineBox!.y).toBeLessThanOrEqual(g!.pane.bottom);
});

test("a file jump from the Files list lands the header below the bar", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByRole("button", { name: "Show file list" }).click();
  await page.getByRole("button", { name: /test_socketlevel\.py/ }).click();
  const header = page.locator(`[id="F-${TSOCK}"]`);
  await expect(header).toBeVisible();
  const g = await geometry(page);
  const fileBox = await header.boundingBox();
  expect(g).not.toBeNull();
  expect(fileBox).not.toBeNull();
  // The file section's top (its header) sits below the pinned bar.
  expect(fileBox!.y).toBeGreaterThanOrEqual(g!.bar.bottom - 2);
});

test("Files panel opened while scrolled is fully visible, with its dropdown", async ({ page }) => {
  await scrollDiffToBottom(page);
  await page.getByRole("button", { name: "Show file list" }).click();
  const files = page.locator("#right .files");
  await expect(files).toBeVisible();
  const g = await geometry(page);
  expect(g).not.toBeNull();
  const filesBox = await files.boundingBox();
  expect(filesBox).not.toBeNull();
  // The whole panel (filter, progress, list) sits inside the pane viewport.
  expect(filesBox!.y).toBeGreaterThanOrEqual(g!.pane.y - 1);
  expect(filesBox!.y + filesBox!.height).toBeLessThanOrEqual(g!.pane.bottom + 1);
  await expect(page.getByLabel("Filter files by name")).toBeVisible();
  // The filter dropdown opens above the diff content and inside the viewport.
  await page.getByRole("button", { name: "File filters" }).click();
  const menu = page.getByRole("menu", { name: "File filters" });
  await expect(menu).toBeVisible();
  const menuBox = await menu.boundingBox();
  const viewport = page.viewportSize();
  expect(menuBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.y).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport!.height + 1);
});

test("bar spans the full pane width in split view and after sideways scrolling", async ({ page }) => {
  await page.getByRole("button", { name: "Split" }).click();
  await expect(page.locator(`${connFile} table.diff.split`)).toBeVisible();
  await scrollDiffToBottom(page);
  // Sideways-scroll every file body that can scroll; the bar must not move
  // with the content or leave a gap.
  await page.evaluate(() => {
    for (const w of document.querySelectorAll("#right .dwrap")) w.scrollTo(9999, 0);
  });
  const g = await geometry(page);
  expect(g).not.toBeNull();
  expect(Math.abs(g!.bar.x - g!.pane.x)).toBeLessThan(1.5);
  expect(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
});

test("bar stays one row at narrow widths, scrolling sideways instead of wrapping", async ({ page }) => {
  const wrap = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).flexWrap,
  );
  const overflowX = await page.evaluate(
    () => getComputedStyle(document.querySelector("#right .dtool") as Element).overflowX,
  );
  expect(wrap).toBe("nowrap");
  expect(overflowX).toBe("auto");
  // Narrow window: the source pane becomes the overlay; the bar is still a
  // single row spanning it.
  await page.setViewportSize({ width: 700, height: 800 });
  const ok = await page.evaluate((key) => window.__revealSource?.(`diff:${key}:650`), CONN);
  expect(ok).toBe(true);
  await expect(page.locator(`[id="L-${CONN}-650"].hl`)).toBeVisible();
  const g = await geometry(page);
  expect(g).not.toBeNull();
  // One row of pill buttons (~40px); two wrapped rows would be ~70px.
  expect(g!.bar.height).toBeLessThan(60);
  expect(Math.abs(g!.bar.width - g!.pane.width)).toBeLessThan(1.5);
  expect(Math.abs(g!.bar.y - (g!.pane.y + g!.stickH))).toBeLessThan(2.5);
});
