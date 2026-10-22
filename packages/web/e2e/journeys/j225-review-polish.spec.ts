/** J225B (#225): review-page polish — action-only tooltips, filter /
 * fold / hide-uninteresting icons, no shared-context line, and the
 * generic layout check on the review page (real service). */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J225 review polish", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j225-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("tooltips are action-only, icons read as filters/fold pair, no shared-context line", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // No shared-context line on the review page (#225).
    await expect(page.locator("[data-shared-indicator]")).toHaveCount(0);
    await expect(page.getByText(/kept \d+ notes? from your conversations/)).toHaveCount(0);
    await checkLayout(page, "j225-guide");

    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

    const fold = page.getByRole("button", { name: "Fold all", exact: true });
    const unfold = page.getByRole("button", { name: "Unfold all", exact: true });
    await expect(fold).toHaveAttribute("data-tip", "Fold the code");
    await expect(unfold).toHaveAttribute("data-tip", "Unfold the code");
    // Mirrored pair: the two buttons render different icons.
    const foldSvg = await fold.locator("svg").innerHTML();
    const unfoldSvg = await unfold.locator("svg").innerHTML();
    expect(foldSvg).not.toBe(unfoldSvg);

    await expect(page.getByRole("button", { name: "Refresh" })).toHaveAttribute(
      "data-tip",
      "Check the branch for new commits",
    );
    await expect(page.getByRole("button", { name: "Hide uninteresting" })).toHaveAttribute(
      "data-tip",
      "Hide uninteresting",
    );

    // Review filter: funnel icon, action-only tooltip, active dot.
    const reviewFilter = page.getByRole("button", { name: "Review filters" });
    await expect(reviewFilter).toHaveAttribute("data-tip", "Reviewed and GitHub comment filters");
    await expect(reviewFilter).toHaveAttribute("aria-pressed", "false");
    await expect(reviewFilter.locator("[data-filter-active]")).toHaveCount(0);
    await reviewFilter.click();
    const menu = page.getByRole("menu", { name: "Review filters" });
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitemcheckbox", { name: /Reviewed/ }).click();
    await expect(reviewFilter).toHaveAttribute("aria-pressed", "true");
    await expect(reviewFilter.locator("[data-filter-active]")).toHaveCount(1);
    await expect(reviewFilter).toHaveAttribute("data-tip", "Reviewed and GitHub comment filters");
    await page.keyboard.press("Escape");

    // No toolbar tooltip carries agent/summary/state commentary.
    const tips = await page.locator(".dtool [data-tip]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-tip") ?? ""),
    );
    for (const tip of tips) {
      expect(tip).not.toMatch(/agent|summar|\(|;/i);
    }

    await checkLayout(page, "j225-diff");
  });
});
