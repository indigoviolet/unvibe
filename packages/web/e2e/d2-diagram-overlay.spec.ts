/**
 * Expanded diagram overlay in mock mode (issue #47): Expand opens the
 * full-window dialog, wheel/buttons zoom, drag pans, Reset restores,
 * Esc closes with focus back on Expand; citation hover previews and
 * click-to-reveal keep working inside the overlay, in both themes.
 */
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";

const BLOCK = "#C-g-flow #B-b1";
const DIALOG = '[role="dialog"][aria-label="Expanded diagram"]';

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await expect(page.locator(`${BLOCK} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

async function openOverlay(page: Page): Promise<void> {
  await page.locator(`${BLOCK} .dg-expand`).click();
  await expect(page.locator(DIALOG)).toBeVisible();
  await expect(page.locator(`${DIALOG} .dg-ov-doc .dg-svg > svg`)).toBeVisible({
    timeout: 15000,
  });
}

function overlayTransform(page: Page): Promise<string> {
  return page.locator(".dg-ov-doc").evaluate((el) => (el as HTMLElement).style.transform);
}

/**
 * Hover an anchor deterministically (copied from `d2-diagrams.spec.ts`:
 * Playwright's `hover()` may scroll with the pointer already over the
 * target, and a scroll with a stationary pointer must NOT open the
 * popover). Waits for scroll quiet, then aims at the anchor's own line
 * boxes until the cursor verifiably lands on it.
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
    w.__lastScrollAt = Date.now();
    if (!w.__scrollHook) {
      w.__scrollHook = true;
      document.addEventListener(
        "scroll",
        () => {
          w.__lastScrollAt = Date.now();
        },
        true,
      );
    }
  });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400,
    { polling: 250, timeout: 10_000 },
  );
  await page.mouse.move(8, 200);
  const measure = (): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    locator.evaluate((target) => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const rs = target.getClientRects();
      for (let i = 0; i < rs.length; i++) out.push({ x: rs[i].x, y: rs[i].y, width: rs[i].width, height: rs[i].height });
      return out;
    });
  for (let i = 0; i < 4; i++) {
    const rects = await measure();
    if (rects.length === 0) throw new Error("anchor has no rects");
    const r = rects[Math.min(i, rects.length - 1)];
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    const onAnchor = await locator.evaluate(
      (target, p: { x: number; y: number }) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return !!hit && (hit === target || target.contains(hit));
      },
      { x, y },
    );
    if (onAnchor) return;
  }
  throw new Error("hover missed the anchor after 4 aims (layout still shifting?)");
}

test("expand opens the overlay and locks the page behind it", async ({ page }) => {
  await gotoReview(page);
  await page.locator(`${BLOCK} .dg-expand`).click();
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(page.evaluate(() => document.body.style.overflow)).resolves.toBe("hidden");
});

test("zoom buttons, wheel zoom, drag pan, reset, Esc close", async ({ page }) => {
  await gotoReview(page);
  await openOverlay(page);
  const zoom = page.locator(`${DIALOG} .dg-zoom`);
  // The overlay opens fitted: the whole 1379-wide diagram is visible.
  const fitLabel = (await zoom.textContent()) ?? "";
  expect(fitLabel).toMatch(/^\d+%$/);
  const fit = await overlayTransform(page);
  expect(fit).not.toBe("translate(0px, 0px) scale(1)");

  // Buttons zoom around the viewport center.
  await page.locator(`${DIALOG} button[aria-label="Zoom in"]`).click();
  await expect.poll(() => overlayTransform(page), { timeout: 5000 }).not.toBe(fit);
  const zoomedLabel = (await zoom.textContent()) ?? "";
  expect(Number.parseInt(zoomedLabel, 10)).toBeGreaterThan(Number.parseInt(fitLabel, 10));

  // Wheel zooms further (around the pointer).
  const view = page.locator(`${DIALOG} .dg-ov-view`);
  const box = await view.boundingBox();
  if (!box) throw new Error("overlay viewport has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const zoomed = await overlayTransform(page);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => overlayTransform(page), { timeout: 5000 }).not.toBe(zoomed);

  // Drag pans (a real mouse drag fires pointer events, like touch).
  const before = await overlayTransform(page);
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + 420, box.y + 360, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => overlayTransform(page), { timeout: 5000 }).not.toBe(before);

  // Reset restores the fitted view.
  await page.locator(`${DIALOG} button[aria-label="Reset view"]`).click();
  await expect(zoom).toContainText(fitLabel);
  expect(await overlayTransform(page)).toBe(fit);

  // Esc closes and focus returns to the Expand control.
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
  await expect(page.locator(`${BLOCK} .dg-expand`)).toBeFocused();
});

test("citation hover and click keep working inside the overlay", async ({ page }) => {
  await gotoReview(page);
  await openOverlay(page);
  const anchor = page.locator(`${DIALOG} .dg-ov-doc .dg-svg a[data-refs]`).first();
  await hoverFresh(page, anchor);
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:650");
  const before = page.url();
  await anchor.click();
  expect(page.url()).toBe(before);
  await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
  await expect(page.locator('[id="L-src-urllib3-connection.py-650"].hl')).toBeVisible({
    timeout: 5000,
  });
});

test("theme switch while expanded swaps the render", async ({ page }) => {
  await gotoReview(page);
  await openOverlay(page);
  const host = page.locator(`${DIALOG} .dg-ov-doc .dg-svg`);
  await expect(host).toContainText("HTTPMessage");
  const lightHtml = await host.innerHTML();
  expect(lightHtml).toContain("#FFFFFF");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect.poll(() => host.innerHTML(), { timeout: 10000 }).toContain("1E1E2E");
  // The swapped render keeps its size (no blank overlay).
  const box = await page.locator(`${DIALOG} .dg-ov-doc .dg-svg > svg`).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(500);
  // Close still works after the swap.
  await page.keyboard.press("Escape");
  await expect(page.locator(DIALOG)).toBeHidden();
});

/**
 * Fit-to-view (#47 follow-up): after open and after Reset, the whole
 * diagram — including citation badges that draw outside the SVG viewBox —
 * lies inside the overlay's usable area with (near-)equal margins, and
 * the scale never exceeds 100%. Wide (1379) and small (340) diagrams at
 * desktop and small viewports.
 */
interface FitBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

async function overlayFit(page: Page): Promise<{ content: FitBox; box: FitBox; zoomPct: number }> {
  return page.evaluate(() => {
    const view = document.querySelector(".dg-ov-view") as HTMLElement;
    const svg = document.querySelector(".dg-ov-doc .dg-svg > svg") as SVGSVGElement;
    const cs = getComputedStyle(view);
    const padL = Number.parseFloat(cs.paddingLeft);
    const padR = Number.parseFloat(cs.paddingRight);
    const padT = Number.parseFloat(cs.paddingTop);
    const padB = Number.parseFloat(cs.paddingBottom);
    const v = view.getBoundingClientRect();
    const content: FitBox = {
      left: v.left + view.clientLeft + padL,
      top: v.top + view.clientTop + padT,
      right: v.left + view.clientLeft + view.clientWidth - padR,
      bottom: v.top + view.clientTop + view.clientHeight - padB,
    };
    // Union the svg box with the badge overflow (appendix icons paint
    // outside the svg element box even with overflow: visible).
    const r = svg.getBoundingClientRect();
    let l = r.left;
    let t = r.top;
    let rr = r.right;
    let b = r.bottom;
    for (const g of svg.querySelectorAll("g.appendix-icon")) {
      const gr = (g as SVGGraphicsElement).getBoundingClientRect();
      l = Math.min(l, gr.left);
      t = Math.min(t, gr.top);
      rr = Math.max(rr, gr.right);
      b = Math.max(b, gr.bottom);
    }
    const zoomText = document.querySelector(".dg-zoom")?.textContent ?? "0%";
    return { content, box: { left: l, top: t, right: rr, bottom: b }, zoomPct: Number.parseInt(zoomText, 10) };
  });
}

function expectFitted(fit: { content: FitBox; box: FitBox; zoomPct: number }): void {
  const { content, box, zoomPct } = fit;
  expect(zoomPct).toBeLessThanOrEqual(100);
  expect(box.left).toBeGreaterThanOrEqual(content.left - 0.5);
  expect(box.right).toBeLessThanOrEqual(content.right + 0.5);
  expect(box.top).toBeGreaterThanOrEqual(content.top - 0.5);
  expect(box.bottom).toBeLessThanOrEqual(content.bottom + 0.5);
  const marginL = box.left - content.left;
  const marginR = content.right - box.right;
  const marginT = box.top - content.top;
  const marginB = content.bottom - box.bottom;
  expect(Math.abs(marginL - marginR)).toBeLessThanOrEqual(2);
  expect(Math.abs(marginT - marginB)).toBeLessThanOrEqual(2);
}

/** Poll-friendly fitted check (assertion failures become retries). */
async function isFitted(page: Page): Promise<boolean> {
  try {
    expectFitted(await overlayFit(page));
    return true;
  } catch {
    return false;
  }
}

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 800, height: 700 },
]) {
  for (const target of [
    { block: "#B-b1", name: "wide diagram" },
    { block: "#B-b-mock-d2-edge", name: "small diagram" },
  ]) {
    test(`fit centers the whole ${target.name} at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await gotoReview(page);
      await page.locator(`#C-g-flow ${target.block} .dg-expand`).click();
      await expect(page.locator(DIALOG)).toBeVisible();
      await expect(page.locator(`${DIALOG} .dg-ov-doc .dg-svg > svg`)).toBeVisible({
        timeout: 15000,
      });
      // Fit settles asynchronously once the SVG adopts: poll the end state.
      await expect.poll(() => isFitted(page), { timeout: 10000 }).toBe(true);
      // Zoom + pan away, then Reset returns to the same fitted state.
      await page.locator(`${DIALOG} button[aria-label="Zoom in"]`).click();
      const view = page.locator(`${DIALOG} .dg-ov-view`);
      const viewBox = await view.boundingBox();
      if (!viewBox) throw new Error("overlay viewport has no box");
      await page.mouse.move(viewBox.x + 200, viewBox.y + 200);
      await page.mouse.down();
      await page.mouse.move(viewBox.x + 320, viewBox.y + 260, { steps: 8 });
      await page.mouse.up();
      await page.locator(`${DIALOG} button[aria-label="Reset view"]`).click();
      await expect.poll(() => isFitted(page), { timeout: 10000 }).toBe(true);
      await page.keyboard.press("Escape");
      await expect(page.locator(DIALOG)).toBeHidden();
    });
  }
}
