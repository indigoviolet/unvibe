/** J242 (#242): Plotlines card — no numbers, hunk-count chips, a
 * builds-on chip that goes to the earlier plotline, titles in full —
 * against the real service in replay (the demo has two plotlines
 * where one builds on the other). */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J242 plotlines card", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j242-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("plotlines read as chips, builds-on goes to the earlier plotline", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const box = page.locator(".plotlines");
    await expect(box).toBeVisible({ timeout: 15_000 });
    // Two plotlines where one builds on the other, plus Other.
    await expect(box.locator(".plname", { hasText: "Unfold folded values" })).toBeVisible();
    await expect(box.locator(".plname", { hasText: "Prove the unfolding works" })).toBeVisible();
    // #242: no numbering; every row carries its hunk count as a chip
    // in the same trailing slot.
    await expect(box.locator(".plorder")).toHaveCount(0);
    await expect(box.locator(".ui-row .ui-badge", { hasText: /hunks?/ }).first()).toBeVisible();
    // Builds on names the earlier plotline in a chip.
    const chip = box.locator('[data-buildson="unfold"]');
    await expect(chip).toContainText("Unfold folded values");
    await expect(box.locator(".plbuilds")).toContainText("Builds on");

    // Titles show in full: nothing is ellipsized, long titles wrap.
    const truncated = await box.locator(".plname").evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
    );
    expect(truncated).toEqual([]);

    await checkLayout(page, "j242-plotlines");

    // The builds-on chip goes to the earlier plotline: the diff
    // filters to it and its first hunk scrolls into view.
    await chip.click();
    await expect(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold folded values", {
      timeout: 15_000,
    });
    const inView = await page.evaluate(() => {
      const el = document.querySelector("[data-hunk]");
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    expect(inView).toBe(true);
    await checkLayout(page, "j242-plotlines-filtered");
  });
});
