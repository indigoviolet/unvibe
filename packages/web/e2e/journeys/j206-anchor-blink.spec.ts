/** #206: one unplaceable anchor must not keep re-marking the whole page. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createSeededDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J206 anchor blink", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j206-data-"));
    reviewId = createSeededDemoReview(dataDir, "j206-seed");
    svc = await startService(dataDir, { agent: "replay" });
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

  // Merged from anchor-footnotes-service.spec.ts (#256, issue #72, PRD
  // §4.7): closed explanation → depth change loses the phrase → footnote
  // chip on the citations line (highlight gone) → click chip re-opens
  // the explanation → switch back → highlight returns, chip hidden.
  // Quote "fast path" lives in central#b4 at standard but not at deep, so
  // a standard→deep step (instant, stored levels) orphans the anchor.
  test("closed explanation → deep → chip → open → back → highlight", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Create a closed expansion on central#b4 with the standard-only phrase.
    const created = await apiJson(svc, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "explain",
      quote: "fast path",
      anchor: { where: "block", blockId: "central#b4" },
    });
    const annId = (created.json as { annotationId: string; jobId?: string }).annotationId;
    if ((created.json as { jobId?: string }).jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
        const ann = ((cur.json as { annotations: { id: string; turns?: { blocks: unknown[] }[] }[] }).annotations ?? []).find(
          (a) => a.id === annId,
        );
        if ((ann?.turns?.[0]?.blocks.length ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error("conversation did not fill in time");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // Close it so only the dotted highlight remains.
    await apiJson(svc, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "close",
      annotationId: annId,
    });
    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // At standard the dotted highlight lands and the footnote stays hidden.
    const mark = page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    const chip = page.locator(`#C-central .lo mark.fnote.exl[data-jump="${annId}"]`);
    await expect(chip).toBeHidden({ timeout: 10_000 });

    // Step to deep (stored levels: instant, no agent). The phrase is gone,
    // so the highlight drops and the chip appears on the citations line.
    await page.locator("#C-central > .ctl").getByRole("button", { name: "Deeper" }).click();
    await expect(page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(chip).toBeVisible({ timeout: 15_000 });
    // The chip shares the citations row, not a full-width stub: the chip's
    // closest `.lo` also holds the <> citations chip.
    const sameRow = await chip.evaluate((el) => {
      const lo = el.closest(".lo");
      return !!lo && !!lo.querySelector("button.lk[data-refs]");
    });
    expect(sameRow).toBe(true);
    await expect(page.locator("#C-central .linkstub")).toHaveCount(0);

    // Clicking the chip re-opens the explanation in place.
    await chip.click();
    const expCard = page.locator(`#C-central [data-expansion="${annId}"]`).first();
    await expect(expCard).toBeVisible({ timeout: 15_000 });

    // Close it again so the return trip asserts the closed highlight path.
    await expCard.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`#C-central [data-expansion="${annId}"]`)).toHaveCount(0, { timeout: 10_000 });

    // Switching back restores the highlight and hides the chip.
    await page.locator("#C-central > .ctl").getByRole("button", { name: "Simpler" }).click();
    await expect(page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(chip).toBeHidden({ timeout: 10_000 });
  });
});
