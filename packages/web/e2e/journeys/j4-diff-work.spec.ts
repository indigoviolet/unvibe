/** J4 (#188): diff work — folds, filters, reviewed, scores/plotlines — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";

test.describe("J4 diff work", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j4-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("fold, filter, reviewed survives reload, scores and plotlines filter", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile).toBeVisible({ timeout: 60_000 });
    // Hunk passes land asynchronously; wait until every hunk carries a score
    // (an unscored hunk matches any score filter, so filtering earlier lies).
    await expect
      .poll(
        async () => {
          const snap = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
          const states = (snap.json as { hunkStates?: { score?: string }[] }).hunkStates ?? [];
          return states.filter((s) => s.score).length;
        },
        { timeout: 90_000 },
      )
      .toBe(8);
    await expect(page.locator(".dhunk-h .score-dot").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.dhunk-h .score-dot[data-score="substantive"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".dhunk-h .ptag", { hasText: "Unfold folded values" }).first()).toBeVisible({ timeout: 30_000 });

    // Plotline filter: only the conn file serves that thread.
    await page.locator('[data-plotpick="unfold"]').first().click();
    await expect(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold folded values", { timeout: 15_000 });
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
    await page.locator('[data-filterchip="plotline"] button').click();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });

    // Score filter: substantive hunks are the conn change (from the recordings).
    await page.locator('.dhunk-h [data-scorepick="substantive"]').first().click();
    await expect(page.locator('[data-filterchip="score"]')).toContainText("Score: substantive", { timeout: 15_000 });
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
    await page.locator('[data-filterchip="score"] button').click();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });

    // Mark a file reviewed; it survives reload.
    await connFile.getByRole("checkbox", { name: "Mark reviewed" }).first().click();
    await expect(connFile.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(connFile).toBeVisible({ timeout: 60_000 });
    await expect(connFile.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
    // Unfold it again for the summary step.
    await connFile.getByRole("button", { name: "Show code" }).first().click();

    // File list opens and names the files in the diff.
    const filterBtn = page.getByRole("button", { name: "Show file list" });
    if ((await filterBtn.count()) > 0) {
      await filterBtn.first().click();
      await expect(page.locator(".flist")).toContainText("connection.py", { timeout: 15_000 });
    }
  });

  test("multi-line Explain keeps a reopen marker when closed (#189)", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Unfold all" }).click({ timeout: 10_000 }).catch(() => {});

    const dragSelect = async (fromLine: number, toLine: number): Promise<void> => {
      const from = page.locator(`[id="L-${CONN}-${fromLine}"] td.c`);
      const to = page.locator(`[id="L-${CONN}-${toLine}"] td.c`);
      await from.scrollIntoViewIfNeeded();
      const a = await from.boundingBox();
      const b = await to.boundingBox();
      if (!a || !b) throw new Error("no drag boxes");
      await page.mouse.move(a.x + 6, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + Math.min(120, b.width - 6), b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
      await expect(page.locator("#selbar")).toBeVisible({ timeout: 10_000 });
    };
    const explainAndClose = async (): Promise<void> => {
      await page.locator('#selbar [data-act="explain"]').click();
      const card = page.locator(".dhunk .card.child.floating").first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      await card.getByRole("button", { name: "Close" }).click();
      await expect(card).toBeHidden({ timeout: 10_000 });
    };

    // Across three rows inside one hunk.
    await dragSelect(86, 88);
    await explainAndClose();
    const marker = page.locator("mark.anc.range[data-jump]").first();
    await expect(marker).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[id="L-${CONN}-87"]`)).toHaveClass(/rng/);
    // The marker reopens the card.
    await marker.click();
    await expect(page.locator(".dhunk .card.child.floating").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".dhunk .card.child.floating").first().getByRole("button", { name: "Close" }).click();

    // Across a hunk boundary (last row of hunk 1 to first row of hunk 2).
    await dragSelect(108, 650);
    await explainAndClose();
    const boundaryMarker = page.locator("mark.anc.range[data-jump]").last();
    await expect(boundaryMarker).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[id="L-${CONN}-650"]`)).toHaveClass(/rng/);
    await boundaryMarker.click();
    await expect(page.locator(".dhunk .card.child.floating").first()).toBeVisible({ timeout: 15_000 });
  });
});
