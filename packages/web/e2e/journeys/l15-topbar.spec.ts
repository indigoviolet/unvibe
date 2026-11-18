/**
 * L15 — top-bar visual pass (#407).
 *
 * The review bar after the Tabler + borderless + quiet-toggle pass:
 * - every review-bar icon button (Home, Refresh, Debug, Copy guide,
 *   ?, Collapse threads on the seeded demo; Re-do on a PR-backed
 *   scratch review, since Re-do is never offered for demo reviews)
 *   carries no `bd` class and no visible border — while the PR link
 *   chip (scratch PR review) keeps its box;
 * - the pressed pane segment is the quiet selected look (a light
 *   ink-mix tint, ink text, semibold) — never Submit review's solid
 *   ink fill — with text contrast that reads in both schemes;
 * - icons draw from the Tabler 24-grid at 16px (every review-bar and
 *   card-toolbar `svg.ic`).
 *
 * Boots: ONE agent:none service over the seeded demo review, plus ONE
 * agent:none service with fake `gh` over a scratch PR review.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import {
  createScratchReview,
  createSeededDemoReview,
  fakeServicePath,
  git as helperGit,
  makeScratchRepo,
  realGitPath,
  writeFakeGh,
  writeFakeGitOffline,
  writeFakeShell,
} from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("L15 top-bar visual pass", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l15-data-"));
    reviewId = createSeededDemoReview(dataDir, "l15-topbar");
    svc = await startService(dataDir, { agent: "none", label: "l15topbar" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: import("@playwright/test").Page, dark = false): Promise<void> {
    const s = service();
    await page.setViewportSize({ width: 1440, height: 900 });
    if (dark) await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#reviewbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold", { timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
  }

  test("review-bar icon buttons are borderless; the PR chip keeps its box", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    const bar = page.locator("#reviewbar");
    // Every button the issue lists that the demo review shows (Re-do
    // is never offered for demo reviews, so it is covered on a scratch
    // review below).
    for (const [role, name] of [
      ["link", "Back to the start page"],
      ["button", "Refresh"],
      ["link", "Debug"],
      ["button", "Copy guide as Markdown"],
      ["button", "Collapse threads"],
    ] as const) {
      await expect(bar.getByRole(role, { name }), name).toBeVisible();
    }
    // #418: the global "?" term mode is gone from the bar.
    await expect(bar.getByRole("button", { name: "Pick terms you don't understand" })).toHaveCount(0);
    // None carries the boxed class, and none draws a visible border
    // (plain `.ib` keeps a transparent 1px border for sizing, like the
    // card action buttons it now matches).
    const boxed = await bar.locator(".ib").evaluateAll((els) =>
      els.map((el) => ({
        label: el.getAttribute("aria-label") ?? "",
        bd: el.classList.contains("bd"),
        border: getComputedStyle(el).borderTopColor,
      })),
    );
    expect(boxed.length).toBeGreaterThan(0);
    for (const b of boxed) {
      expect(b.bd, `${b.label} still has bd`).toBe(false);
      expect(b.border, `${b.label} border`).toBe("rgba(0, 0, 0, 0)");
    }
  });


  for (const dark of [false, true] as const) {
    test(`pressed segment is the quiet selected look, Submit stays solid (${dark ? "dark" : "light"})`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await openReview(page, dark);
      const pressed = page.locator('.seg button[aria-pressed="true"]').first();
      await expect(pressed).toBeVisible();
      const submit = page.locator('.ra .ui-btn[data-variant="primary"]');
      await expect(submit).toBeVisible();
      const colors = await page.evaluate(() => {
        const seg = document.querySelector('.seg button[aria-pressed="true"]')!;
        const btn = document.querySelector('.ra .ui-btn[data-variant="primary"]')!;
        const cs = getComputedStyle(seg);
        const bs = getComputedStyle(btn);
        return {
          segBg: cs.backgroundColor,
          segColor: cs.color,
          segWeight: cs.fontWeight,
          submitBg: bs.backgroundColor,
          surfaceBg: getComputedStyle(document.body).backgroundColor,
        };
      });
      // Not the solid ink fill: differs from Submit's background, and
      // Submit's own fill is fully opaque.
      expect(colors.segBg, "pressed segment matches Submit").not.toBe(colors.submitBg);
      expect(colors.submitBg, "Submit not solid").toMatch(/^rgb\(/);
      // Not invisible either: a real (composited) fill over the surface.
      expect(colors.segBg, "pressed segment transparent").not.toBe("rgba(0, 0, 0, 0)");
      expect(colors.segBg, "pressed segment is the surface").not.toBe(colors.surfaceBg);
      // Ink text, semibold.
      expect(Number(colors.segWeight) >= 600, `weight ${colors.segWeight}`).toBe(true);
      // Text reads against the tinted fill (composite over the page
      // surface first): 4.5:1 in both schemes.
      const ratio = await page.evaluate(
        ({ fg, bg, surface }) => {
          const parse = (c: string): [number, number, number, number] => {
            // getComputedStyle serializes color-mix() as color(srgb …).
            const m = c.match(/color\(srgb ([0-9.]+) ([0-9.]+) ([0-9.]+) \/ ([0-9.]+)\)/);
            if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, Number(m[4])];
            const r = c.match(/rgba?\(([^)]+)\)/)!;
            const [rr, gg, bb, aa] = r[1].split(",").map(Number);
            return [rr!, gg!, bb!, aa ?? 1];
          };
          const lum = ([r, g, b]: [number, number, number]): number => {
            const f = (v: number): number => {
              const s = v / 255;
              return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
          };
          const [fr, fg_, fb] = parse(fg);
          const [br, bg_, bb, ba] = parse(bg);
          const [sr, sg, sb] = parse(surface);
          const cr = br * ba + sr * (1 - ba);
          const cg = bg_ * ba + sg * (1 - ba);
          const cb = bb * ba + sb * (1 - ba);
          const l1 = lum([fr, fg_, fb]);
          const l2 = lum([cr, cg, cb]);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        },
        { fg: colors.segColor, bg: colors.segBg, surface: colors.surfaceBg },
      );
      expect(ratio, `contrast ${ratio}`).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("icons draw from the Tabler 24-grid at 16px", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page);
    // Review-bar icons: every one is a 24-grid Tabler drawing sized 16px
    // (the old set was a 16-grid at 14px).
    const barIcons = await page.locator("#reviewbar svg.ic").evaluateAll((els) =>
      els.map((el) => ({
        viewBox: el.getAttribute("viewBox"),
        width: getComputedStyle(el).width,
        paths: el.querySelectorAll("path,circle,rect").length,
      })),
    );
    expect(barIcons.length).toBeGreaterThan(0);
    for (const icon of barIcons) {
      expect(icon.viewBox).toBe("0 0 24 24");
      expect(icon.width).toBe("16px");
      expect(icon.paths).toBeGreaterThan(0);
    }
    // Card toolbar icons follow the same mapping.
    const cardIcons = await page.locator("#C-problem .ctl svg.ic").evaluateAll((els) =>
      els.map((el) => ({
        viewBox: el.getAttribute("viewBox"),
        width: getComputedStyle(el).width,
      })),
    );
    expect(cardIcons.length).toBeGreaterThan(0);
    for (const icon of cardIcons) {
      expect(icon.viewBox).toBe("0 0 24 24");
      expect(icon.width).toBe("16px");
    }
    // Every other icon on the page (string-rendered avatars and thread
    // marks included) comes from the same 24-grid mapping. Widths vary
    // by context (gutter icons shrink via CSS), so only the grid is
    // asserted here.
    const pageIcons = await page.locator("#page svg.ic").evaluateAll((els) =>
      els.map((el) => el.getAttribute("viewBox")),
    );
    expect(pageIcons.length).toBeGreaterThan(0);
    for (const viewBox of pageIcons) expect(viewBox).toBe("0 0 24 24");
  });
});

// Re-do + the PR chip on a PR-backed review (the seeded demo is a demo
// review: Re-do never shows there and its identity never links out).
// ---------------------------------------------------------------------------

test.describe("L15 PR review bar", () => {
  const OWNER = "example-org";
  const NAME = "example-repo";
  const PR = 7;
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l15-repo-"));
    await makeScratchRepo(repoDir);
    await helperGit(repoDir, "remote", "add", "origin", `https://github.com/${OWNER}/${NAME}.git`);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l15-pr-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l15-pr-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-l15-pr-bin-"));
    writeFakeGh(fakeBin, logDir, await helperGit(repoDir, "rev-parse", "feature"));
    writeFakeGitOffline(fakeBin, realGitPath());
    const fakeShell = writeFakeShell(fakeBin);
    svc = await startService(dataDir, {
      agent: "none",
      extraEnv: { SHELL: fakeShell, PATH: fakeServicePath(fakeBin) },
    });
    reviewId = await createScratchReview(svc, repoDir, { pr: PR });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("re-do is borderless; the PR chip keeps its box", async ({ page }) => {
    if (!svc) throw new Error("no service");
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const bar = page.locator("#reviewbar");
    await expect(bar).toBeVisible({ timeout: 30_000 });
    for (const [role, name] of [
      ["link", "Back to the start page"],
      ["button", "Refresh"],
      ["link", "Debug"],
      ["button", "Re-do guide"],
    ] as const) {
      await expect(bar.getByRole(role, { name }), name).toBeVisible({ timeout: 30_000 });
    }
    const borderless = await bar.locator(".ib").evaluateAll((els) =>
      els.map((el) => ({
        label: el.getAttribute("aria-label") ?? "",
        bd: el.classList.contains("bd"),
        border: getComputedStyle(el).borderTopColor,
      })),
    );
    expect(borderless.length).toBeGreaterThan(0);
    for (const b of borderless) {
      expect(b.bd, `${b.label} still has bd`).toBe(false);
      expect(b.border, `${b.label} border`).toBe("rgba(0, 0, 0, 0)");
    }
    // The PR link chip keeps its box, with the state icon inside it.
    const chip = bar.locator('a[title="Open PR on GitHub"]');
    await expect(chip).toContainText(`${OWNER}/${NAME}#${PR}`, { timeout: 15_000 });
    expect(await chip.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  });
});
