/** #206: one unplaceable anchor must not keep re-marking the whole page. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J206 anchor blink", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j206-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a placed highlight stays stable while another anchor cannot be placed", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // One Explain on the problem card: this anchor becomes unplaceable
    // when its host card is collapsed below.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="explain"]').click();
    const stuck = page.locator("#C-problem [data-expansion]").first();
    await expect(stuck).toBeVisible({ timeout: 15_000 });
    await expect(stuck.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    const stuckId = await stuck.getAttribute("data-expansion");
    expect(stuckId).toBeTruthy();

    // One Explain on the central card: this anchor places fine and its
    // highlight must then stay put.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const placed = page.locator("#C-central [data-expansion]").first();
    await expect(placed).toBeVisible({ timeout: 15_000 });
    await expect(placed.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    const placedId = await placed.getAttribute("data-expansion");
    expect(placedId).toBeTruthy();

    // Wait for the demo pipeline to settle: while snapshot patches keep
    // landing, each one legitimately re-arms the bounded retry (#206's
    // bound is per change), so give-up can only happen once it is quiet.
    await expect
      .poll(
        async () => {
          const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
          const jobs = (res.json as { jobs?: { state?: string }[] }).jobs ?? [];
          return jobs.filter((j) => ["queued", "running", "backing-off"].includes(j.state ?? "")).length;
        },
        { timeout: 120_000 },
      )
      .toBe(0);

    // Collapse the problem card: its blocks leave the page, so the
    // first anchor can never be placed on this page again.
    await page.locator("#C-problem").getByRole("button", { name: "Collapse" }).click();
    await expect(page.locator("#C-problem.collapsed")).toBeVisible({ timeout: 15_000 });

    // Watch the placed mark (and every footnote chip) for DOM churn.
    await page.evaluate((id) => {
      const w = window as unknown as { __blink: { mark: number; chip: number; any: number } };
      w.__blink = { mark: 0, chip: 0, any: 0 };
      const pageEl = document.getElementById("page")!;
      const touches = (n: Node): boolean => {
        const el = n instanceof Element ? n : n.parentElement;
        return !!el?.closest?.(`mark.anc[data-jump="${id}"], mark.anc[data-thr], [data-fallback], [data-tfallback]`);
      };
      const obs = new MutationObserver((records) => {
        for (const r of records) {
          w.__blink.any++;
          const nodes = [r.target, ...r.addedNodes, ...r.removedNodes];
          if (nodes.some(touches)) {
            if ([...r.addedNodes, ...r.removedNodes].some((n) => (n instanceof Element ? n : n.parentElement)?.closest?.("mark.anc"))) w.__blink.mark++;
            else w.__blink.chip++;
          }
        }
      });
      obs.observe(pageEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
    }, placedId);
    await page.waitForTimeout(3_000);
    const blink = await page.evaluate(
      () => (window as unknown as { __blink: { mark: number; chip: number; any: number } }).__blink,
    );
    // The placed mark is still there, and nothing re-marked or toggled
    // a chip while we watched (the unplaced anchor shows its chip once
    // and then everything is quiet).
    await expect(page.locator(`#C-central mark.anc[data-jump="${placedId}"]`)).toHaveCount(1);
    expect(blink.mark, `placed mark churned: ${JSON.stringify(blink)}`).toBe(0);
    expect(blink.chip, `footnote chip toggled: ${JSON.stringify(blink)}`).toBe(0);

    // The unplaced anchor is recorded on the Debug page, with its reason.
    // Reach it the way the owner does (the Debug link, no reload): the
    // record is client-side and a full page load would wipe it.
    await page.getByRole("link", { name: "Debug", exact: true }).click();
    const section = page.locator("[data-unplaced-anchors]");
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(section).toContainText(stuckId!, { timeout: 15_000 });
    await expect(section).toContainText("host not on the page");
  });
});
