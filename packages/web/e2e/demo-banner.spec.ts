/**
 * Demo banner geometry (issue #341 follow-up): the banner must be a full,
 * readable slim strip that takes its own row in the layout — never
 * overlapped by the guide/source panes — in both demos and both widths.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { startStaticServer, type StaticServer } from "./static-server.js";

const DEMO_DIST = fileURLToPath(new URL("../dist-demo", import.meta.url));

async function expectFullBanner(page: Page): Promise<void> {
  const banner = page.locator('[data-testid="demo-banner"]');
  await expect(banner).toBeVisible({ timeout: 15000 });
  await expect(banner).toContainText("Demo: a recorded Unvibe review of urllib3#5020");
  await expect(banner).toContainText("Install Unvibe");
  const box = await banner.boundingBox();
  if (!box) throw new Error("banner has no bounding box");
  // A readable strip, not a clipped sliver.
  expect(box.height).toBeGreaterThanOrEqual(24);
  // Nothing covers it: the element at its center belongs to the banner.
  const top = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.closest('[data-testid="demo-banner"]') ? "banner" : el.tagName + "." + (el.className ?? "")) : "none";
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(top).toBe("banner");
  // The guide pane starts at or below the banner's bottom edge.
  const guideTop = await page.evaluate(() => document.querySelector("#page")?.getBoundingClientRect().top ?? -1);
  expect(guideTop).toBeGreaterThanOrEqual(Math.floor(box.y + box.height) - 1);
}

test.describe("demo banner takes its own row", () => {
  for (const width of [1440, 960]) {
    test(`in-app demo at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/review/demo");
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30000,
      });
      await expectFullBanner(page);
    });
  }
});

test.describe("demo banner on the static demo", () => {
  test.skip(!existsSync(DEMO_DIST), "needs `mise run demo:build` first");
  let demo: StaticServer | null = null;
  test.beforeAll(async () => {
    demo = await startStaticServer(DEMO_DIST, "/demo");
  });
  test.afterAll(async () => {
    await demo?.stop().catch(() => {});
    demo = null;
  });
  for (const width of [1440, 960]) {
    test(`static demo at ${width}px`, async ({ page }) => {
      if (!demo) throw new Error("no static server");
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${demo.origin}/#/review/demo`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30000,
      });
      await expectFullBanner(page);
      await expect(page.locator('[data-testid="demo-banner"] button')).toContainText("Reset demo");
    });
  }
});
