/**
 * #218 tour: review toolbars, menus (comments, filters, review via
 * Submit), popovers, the selection toolbar and tooltips — every theme
 * (Default/Studio/Console), light and dark, at 1440px and ~960px.
 * Demo data only (the bundled fixture + replay agent). Screenshots land
 * in the git-ignored `visual-tour/218/` folder; generic checks assert
 * menus/popovers stay inside the viewport with no page overflow and no
 * overlap with card headers.
 * Requires `mise run build` first.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { selectText } from "./select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { checkLayout } from "./layout-check.js";

const exec = promisify(execFile);
const SHOTS = fileURLToPath(new URL("../visual-tour/218", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

let dataDir = "";
let svc: RunningService | null = null;
let reviewId = "";

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour218-data-"));
  svc = await startService(dataDir, { agent: "replay" });
  const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as { review: { id: string } };
  reviewId = created.review.id;
  const deadline = Date.now() + 90_000;
  for (;;) {
    const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
      pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
    };
    const root = snap.pages.find((p) => p.id === "root");
    if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0)) break;
    if (Date.now() > deadline) throw new Error("guide did not fill in time");
    await new Promise((r) => setTimeout(r, 1000));
  }
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  rmSync(dataDir, { recursive: true, force: true });
});

/** Menus/popovers/selbar/tip fully inside the viewport; no page overflow. */
async function checkFloating(page: Page, step: string): Promise<void> {
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth);
  expect(overflow, `${step}: horizontal page overflow ${overflow}px`).toBeLessThanOrEqual(1);
  const bad = await page.evaluate(() => {
    for (const sel of [".cmenu", ".fmenu", ".submit", "#pop", "#selbar", "#tip"]) {
      for (const el of document.querySelectorAll(sel)) {
        if ((el as HTMLElement).hidden || getComputedStyle(el).display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < -1 || r.right > window.innerWidth + 1 || r.top < -1 || r.bottom > window.innerHeight + 1) {
          return `${sel} outside viewport ${JSON.stringify({ l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) })}`;
        }
        // A tooltip/popover must not cover an open card's header.
        if (sel === "#tip" || sel === "#pop") {
          for (const h of document.querySelectorAll(".ui-card.child > .exp-h, .ui-card > .ui-card-header")) {
            const hr = h.getBoundingClientRect();
            if (r.left < hr.right && r.right > hr.left && r.top < hr.bottom && r.bottom > hr.top) {
              return `${sel} overlaps a card header`;
            }
          }
        }
      }
    }
    return null;
  });
  expect(bad, `${step}: ${bad ?? ""}`).toBeNull();
}

const COMBOS = [
  { theme: "default", scheme: "light", width: 1440 },
  { theme: "default", scheme: "dark", width: 1440 },
  { theme: "default", scheme: "light", width: 960 },
  { theme: "default", scheme: "dark", width: 960 },
  { theme: "studio", scheme: "light", width: 1440 },
  { theme: "studio", scheme: "dark", width: 1440 },
  { theme: "studio", scheme: "light", width: 960 },
  { theme: "studio", scheme: "dark", width: 960 },
  { theme: "console", scheme: "light", width: 1440 },
  { theme: "console", scheme: "dark", width: 1440 },
  { theme: "console", scheme: "light", width: 960 },
  { theme: "console", scheme: "dark", width: 960 },
] as const;

for (const combo of COMBOS) {
  const suffix = `${combo.theme}-${combo.scheme}-${combo.width}`;
  test(`218 tour (${suffix})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(180_000);
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.scheme === "dark") await page.emulateMedia({ colorScheme: "dark" });
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: combo.theme });
    await page.addInitScript((theme) => {
      try { localStorage.setItem("unvibe:ui-theme", theme); } catch { /* boot falls back */ }
    }, combo.theme);
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", { timeout: 30_000 });
    await expect(page.locator("html")).toHaveAttribute("data-ui-theme", combo.theme);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    const shot = async (name: string): Promise<void> => {
      await checkFloating(page, `${suffix}-${name}`);
      await checkLayout(page, `${suffix}-${name}`);
      await page.screenshot({ path: path.join(SHOTS, `${name}-${suffix}.png`) });
    };

    // Review toolbar (review bar + guide card toolbar).
    await page.locator("#C-problem").scrollIntoViewIfNeeded();
    await shot("toolbar");

    // Selection toolbar over guide text.
    await selectText(page, "#C-problem", "used to let a server continue");
    await expect(page.locator("#selbar")).toBeVisible();
    await shot("selbar");
    await page.keyboard.press("Escape");
    await expect(page.locator("#selbar")).toBeHidden();

    // Hover popover on a dotted concept link.
    const cite = page.locator('#page a.cx[data-link="concept:obs-fold"]').first();
    if (await cite.count()) {
      await cite.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await cite.hover();
      await page.locator("#pop").waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
      if (await page.locator("#pop").isVisible().catch(() => false)) await shot("popover");
      await page.mouse.move(4, 4);
      await page.locator("#pop").waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    }

    // Tooltip on a card toolbar button.
    const tipBtn = page.locator("#C-problem [data-tip]").first();
    if (await tipBtn.count()) {
      await tipBtn.hover();
      await page.locator("#tip").waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
      if (await page.locator("#tip").isVisible().catch(() => false)) await shot("tooltip");
      await page.mouse.move(4, 4);
    }

    // Comments menu.
    await page.getByRole("button", { name: /Comments/ }).first().click();
    await expect(page.locator(".cmenu")).toBeVisible();
    await shot("menu-comments");
    await page.keyboard.press("Escape");
    await expect(page.locator(".cmenu")).toHaveCount(0);

    // Submit (review) panel.
    await page.getByRole("button", { name: /Submit review/ }).first().click();
    await expect(page.locator(".submit")).toBeVisible();
    await shot("menu-review");
    await page.keyboard.press("Escape");

    // Diff toolbar + file-filter menu.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });
    await shot("toolbar-diff");
    await page.getByRole("button", { name: "Show file list" }).click({ timeout: 10_000 }).catch(() => {});
    await page.getByRole("button", { name: "File filters" }).click({ timeout: 15_000 });
    await expect(page.getByRole("menu", { name: "File filters" })).toBeVisible();
    await shot("menu-filters");
    await page.keyboard.press("Escape");
    await apiJson(svc.origin, svc.token, "PUT", "/api/settings", { uiTheme: "default" });
  });
}
