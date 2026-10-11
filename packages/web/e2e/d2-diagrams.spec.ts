/**
 * D2 diagrams in mock mode (D2 decision addendum): the mock review carries
 * a rendered D2 block (stand-in SVGs served by `mockApi.diagramSvg`) and an
 * unavailable block (no binary), so this spec exercises render, theme
 * switch, citation hover/click/keyboard, sizes, fallbacks and the `d2`
 * readiness callout without a service.
 */
import { expect, test } from "./network-guard.js";
import type { Locator, Page } from "@playwright/test";

const FLOW = "#B-b-mock-d2-flow";
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
 * popover).
 */
async function hoverFresh(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await locator.boundingBox();
  if (!box) throw new Error("anchor has no box");
  await page.mouse.move(8, 200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
}

test("D2 diagram renders in light with caption and citation anchors", async ({ page }) => {
  await gotoReview(page);
  const svg = page.locator(`${FLOW} .dg-svg svg`);
  await expect(svg).toBeVisible({ timeout: 15000 });
  await expect(page.locator(FLOW)).toContainText("unfolding before interpretation");
  const anchors = page.locator(`${FLOW} .dg-svg a[href][data-refs]`);
  await expect(anchors).toHaveCount(2);
  await expect(anchors.first()).toHaveAttribute("data-src", "diff:src-urllib3-connection.py:80-82");
  // Unverified citations are dimmed.
  await expect(page.locator(`${FLOW} .dg-svg a[data-unverified="true"]`)).toHaveCount(1);
  await expect(page.locator(`${FLOW} .dg-svg a[data-unverified="true"]`)).toHaveCSS(
    "opacity",
    "0.55",
  );
});

test("theme switch refetches the dark render", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg svg[data-mock-theme="light"]`)).toBeVisible({
    timeout: 15000,
  });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.locator(`${FLOW} .dg-svg svg[data-mock-theme="dark"]`)).toBeVisible({
    timeout: 10000,
  });
});

test("hover on a cited shape shows the code preview", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg svg`)).toBeVisible({ timeout: 15000 });
  await hoverFresh(page, page.locator(`${FLOW} .dg-svg a[data-refs]`).first());
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop .cite .loc").first()).toContainText("connection.py:80");
  await expect(page.locator("#pop .cite .snip").first()).not.toBeEmpty();
});

test("click on a cited shape reveals in the diff without changing the URL", async ({
  page,
}) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg svg`)).toBeVisible({ timeout: 15000 });
  const before = page.url();
  await page.locator(`${FLOW} .dg-svg a[data-refs]`).first().click();
  expect(page.url()).toBe(before);
  await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff");
  await expect(
    page.locator('[id="L-src-urllib3-connection.py-80"].hl'),
  ).toBeVisible({ timeout: 5000 });
});

test("keyboard Enter on a cited shape reveals without changing the URL", async ({ page }) => {
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg svg`)).toBeVisible({ timeout: 15000 });
  const before = page.url();
  const anchor = page.locator(`${FLOW} .dg-svg a[data-refs]`).first();
  await anchor.focus();
  await expect(anchor).toBeFocused();
  await page.keyboard.press("Enter");
  expect(page.url()).toBe(before);
  await expect(
    page.locator('[id="L-src-urllib3-connection.py-80"].hl'),
  ).toBeVisible({ timeout: 5000 });
});

test("800px window keeps the diagram readable with scroll, not breakage", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await gotoReview(page);
  await expect(page.locator(`${FLOW} .dg-svg svg`)).toBeVisible({ timeout: 15000 });
  const box = await page.locator(`${FLOW} .dg-svg svg`).boundingBox();
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
  await expect(link).toHaveAttribute("href", "/settings#environment");
  await link.click();
  await expect(page).toHaveURL(/\/settings#environment/);
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
            label: "d2",
            status: "warning",
            summary: "Diagrams need d2",
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
    "/settings#environment",
  );
  // Settings → Environment lists the same d2 item.
  await callout.getByRole("link", { name: "Settings" }).click();
  await expect(page.locator('[data-testid="env-d2"]')).toContainText("Diagrams need d2");
});

test("Add diagram in mock inserts a D2 block with a stand-in render", async ({ page }) => {
  await gotoReview(page);
  const card = page.locator("#C-central");
  const before = await card.locator(".dg-svg svg").count();
  await card.getByRole("button", { name: "Add diagram" }).click();
  await expect(card.locator(".dg-svg svg")).toHaveCount(before + 1, { timeout: 10000 });
});
