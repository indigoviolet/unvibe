/**
 * D2 diagrams in mock mode (D2 decision addendum): the mock review carries
 * the fixture's real pre-rendered D2 block (fixture SVGs served by
 * `mockApi.diagramSvg`) plus seeded edge cases — an unverified-anchor
 * block and an unavailable block (no binary) — so this spec exercises
 * render, theme switch, citation hover/click/keyboard, sizes, fallbacks
 * and the `d2` readiness callout without a service.
 */
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";

// Fixture's real diagram block (card g-flow, hash f23beae236cc0685).
const FLOW = "#C-g-flow #B-b1";
const EDGE = "#B-b-mock-d2-edge";
const UNAVAILABLE = "#B-b-mock-d2-unavailable";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/**
 * Hover an anchor deterministically (same reason as `guide.spec.ts`:
 * Playwright's `hover()` may scroll with the pointer already over the
 * target, and a scroll with a stationary pointer must NOT open the
 * popover). Waits for scroll quiet, then aims at the anchor's own line
 * boxes (a wrapped anchor's union-box center can land on plain text)
 * until the cursor verifiably lands on it.
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

test("D2 diagram renders in light with caption and citation anchors", async ({ page }) => {
  await gotoReview(page);
  const svg = page.locator(`${FLOW} .dg-svg > svg`);
  await expect(svg).toBeVisible({ timeout: 15000 });
  await expect(page.locator(FLOW)).toContainText("Where a response's headers go");
  const anchors = page.locator(`${FLOW} .dg-svg a[href][data-refs]`);
  await expect(anchors).toHaveCount(2);
  await expect(anchors.first()).toHaveAttribute(
    "data-src",
    "diff:src-urllib3-connection.py:650-651",
  );
  // The served light render carries the light palette.
  await expect(page.locator(`${FLOW} .dg-svg`)).toContainText("HTTPMessage", { timeout: 5000 });
});

test("unverified citations are dimmed", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${EDGE} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  const unverified = page.locator(`${EDGE} .dg-svg a[data-unverified="true"]`);
  await expect(unverified).toHaveCount(1);
  await expect(unverified).toHaveCSS("opacity", "0.55");
});

test("theme switch refetches the dark render", async ({ page }) => {
  await gotoReview(page);
  const host = page.locator(`${FLOW} .dg-svg`);
  await expect(host.locator(":scope > svg")).toBeVisible({ timeout: 15000 });
  await expect(host).toContainText("HTTPMessage");
  const lightHtml = await host.innerHTML();
  expect(lightHtml).toContain("#FFFFFF");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect
    .poll(async () => host.innerHTML(), { timeout: 10000 })
    .toContain("1E1E2E");
  const darkHtml = await host.innerHTML();
  expect(darkHtml).not.toBe(lightHtml);
});

test("hover on a cited shape shows the code preview", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  await hoverFresh(page, page.locator(`${FLOW} .dg-svg a[data-refs]`).first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:650");
  await expect(page.locator("#pop .cite .snip").first()).not.toBeEmpty();
});

test("click on a cited shape reveals in the diff without changing the URL", async ({
  page,
}) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  const before = page.url();
  await page.locator(`${FLOW} .dg-svg a[data-refs]`).first().click();
  expect(page.url()).toBe(before);
  await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
  await expect(
    page.locator('[id="L-src-urllib3-connection.py-650"].hl'),
  ).toBeVisible({ timeout: 5000 });
});

test("keyboard Enter on a cited shape reveals without changing the URL", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  const before = page.url();
  const anchor = page.locator(`${FLOW} .dg-svg a[data-refs]`).first();
  await anchor.focus();
  await expect(anchor).toBeFocused();
  await page.keyboard.press("Enter");
  expect(page.url()).toBe(before);
  await expect(
    page.locator('[id="L-src-urllib3-connection.py-650"].hl'),
  ).toBeVisible({ timeout: 5000 });
});

test("wide diagram keeps labels legible and scrolls inside the card (#16)", async ({
  page,
}) => {
  await gotoReview(page);
  const svg = page.locator(`${FLOW} .dg-svg > svg`);
  await expect(svg).toBeVisible({ timeout: 15000 });
  // The 1379-wide flow diagram floors at ceil(1379 * 12.5 / 16) = 1078px,
  // so its 16px labels render at the guide's 12.5px small text instead of
  // shrinking; the card scrolls horizontally and the page does not grow.
  await expect.poll(() => svg.evaluate((el) => (el as SVGSVGElement).style.minWidth)).toBe("1078px");
  const effective = await svg.evaluate((el) => {
    const r = (el as SVGSVGElement).getBoundingClientRect();
    return (16 * r.width) / 1379;
  });
  expect(effective).toBeGreaterThanOrEqual(12.4);
  const scrolled = await page.locator(`${FLOW}`).evaluate((el) => {
    const dg = el.querySelector(".dg") as HTMLElement;
    return dg.scrollWidth - dg.clientWidth;
  });
  expect(scrolled).toBeGreaterThan(100);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("diagram wears the guide palette in light and dark (#16)", async ({ page }) => {
  await gotoReview(page);
  const shape = page.locator(`${FLOW} .dg-svg rect.stroke-B1`).first();
  const label = page.locator(`${FLOW} .dg-svg text.fill-N1`).first();
  await expect(shape).toBeVisible({ timeout: 15000 });
  const light = await shape.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { fill: cs.fill, stroke: cs.stroke };
  });
  // D2's default blue (#0D32B2 on #F7F8FE) is remapped: teal borders on
  // surface fills, ink labels.
  expect(light).toEqual({ fill: "rgb(255, 255, 255)", stroke: "rgb(11, 110, 120)" });
  expect(await label.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(27, 31, 39)");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect
    .poll(() => shape.evaluate((el) => getComputedStyle(el).stroke), { timeout: 10000 })
    .toBe("rgb(86, 194, 203)");
  expect(await shape.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(25, 29, 35)");
  expect(await label.evaluate((el) => getComputedStyle(el).fill)).toBe("rgb(229, 232, 237)");
});

test("800px window keeps the diagram readable with scroll, not breakage", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg > svg`)).toBeVisible({ timeout: 15000 });
  const box = await page.locator(`${FLOW} .dg-svg > svg`).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  // The diagram container scrolls rather than overflowing the page.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("unavailable binary shows the source with a Settings note", async ({ page }) => {
  await gotoReview(page);
  const fallback = page.locator(`${UNAVAILABLE} .dg-fallback`);
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("needs-binary");
  await expect(fallback).toContainText("Diagrams need");
  const link = fallback.getByRole("link", { name: /Settings → Environment/ });
  await expect(link).toHaveAttribute("href", "/settings?tab=environment");
  await link.click();
  await expect(page).toHaveURL(/\/settings\?tab=environment/);
  await expect(page.locator("#environment")).toBeVisible();
});

test("d2 warning readiness shows a callout linking to Settings → Environment", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "unvibe.mock.readiness",
      JSON.stringify({
        checks: [
          { id: "git", label: "git", status: "ok", summary: "git found", fix: "", settingsAnchor: "#environment" },
          { id: "gh", label: "gh (GitHub CLI)", status: "ok", summary: "gh ready", fix: "", settingsAnchor: "#environment" },
          {
            id: "d2",
            label: "Diagrams · d2",
            status: "warning",
            summary: "Diagrams need d2 (not found on login-shell PATH)",
            fix: "Install d2 (see Settings → Environment), or diagrams show their source.",
            settingsAnchor: "#environment",
          },
          { id: "agent:main", label: "Agent · main", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:small", label: "Agent · small", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agent:secondOpinion", label: "Agent · second opinion", status: "ok", summary: "ready", fix: "", settingsAnchor: "#models" },
          { id: "agents-distinct", label: "Second opinion independence", status: "ok", summary: "ok", fix: "", settingsAnchor: "#models" },
        ],
        generatedAt: Date.now(),
        cached: false,
      }),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  const callout = page.locator('[data-testid="readiness-callout-d2"]');
  await expect(callout).toContainText("Diagrams need d2");
  await expect(callout.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/settings?tab=environment",
  );
  // Settings → Environment lists the same d2 item.
  await callout.getByRole("link", { name: "Settings" }).click();
  await expect(page.locator('[data-testid="env-d2"]')).toContainText("Diagrams need d2");
});

test("Add diagram in mock inserts a D2 block with a stand-in render", async ({ page }) => {
  await gotoReview(page);
  const card = page.locator("#C-central");
  const before = await card.locator(".dg-svg > svg").count();
  await card.getByRole("button", { name: "Add diagram" }).click();
  await expect(card.locator(".dg-svg > svg")).toHaveCount(before + 1, { timeout: 10000 });
});
