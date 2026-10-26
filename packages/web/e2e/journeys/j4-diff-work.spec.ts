/** J4 (#188): diff work — folds, filters, reviewed, scores/plotlines — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { selectDiffRows } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const CONN = "src-urllib3-connection.py";
const TCONN = "test-test_connection.py";
const TSOCK = "test-with_dummyserver-test_socketlevel.py";

test.beforeEach(async ({ page }) => { await cpuThrottleFromEnv(page); });
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

  test("filters combine: file type AND plotline AND level (#190)", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile).toBeVisible({ timeout: 60_000 });
    // Wait for the hunk pass so every hunk carries a score and plotline.
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
    await expect(page.locator('.dhunk-h [data-scorepick="substantive"]').first()).toBeVisible({ timeout: 30_000 });

    // File-type filter first: Tests off hides both test files.
    await page.getByRole("button", { name: "Show file list" }).click();
    await page.getByRole("button", { name: "File filters" }).click();
    const menu = page.getByRole("menu", { name: "File filters" });
    await menu.getByText("Tests", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
    await expect(page.locator(`[id="F-${TSOCK}"]`)).toHaveCount(0);
    await expect(connFile).toBeVisible();

    // Plotline on top: the conn file stays, the test files stay hidden.
    await page.locator('[data-plotpick="unfold"]').first().click();
    await expect(page.locator('[data-filterchip="plotline"]')).toContainText("Plotline: Unfold folded values", { timeout: 15_000 });
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
    await expect(page.locator(`[id="F-${TSOCK}"]`)).toHaveCount(0);

    // Level on top of both; the chip names it as a floor.
    await page.locator('.dhunk-h [data-scorepick="substantive"]').first().click();
    await expect(page.locator('[data-filterchip="score"]')).toContainText("Score: substantive or higher", { timeout: 15_000 });
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);

    // Clearing one filter leaves the others exactly as they were.
    await page.locator('[data-filterchip="plotline"] button').click();
    await expect(page.locator('[data-filterchip="score"]')).toContainText("Score: substantive or higher");
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);
    await page.locator('[data-filterchip="score"] button').click();
    await expect(connFile).toBeVisible();
    await expect(page.locator(`[id="F-${TCONN}"]`)).toHaveCount(0);

    // Turning Tests back on brings the test files back.
    await page.getByRole("button", { name: "File filters" }).click();
    await page.getByRole("menu", { name: "File filters" }).getByText("Tests", { exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(`[id="F-${TCONN}"]`)).toBeVisible({ timeout: 15_000 });
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
      await selectDiffRows(page, CONN, fromLine, toLine);
    };
    const explainAndClose = async (): Promise<string> => {
      const beforeIds = ((await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { annotations: { id: string }[] }).annotations.map((a) => a.id);
      await page.locator('#selbar [data-act="explain"]').click();
      let newId: string | null = null;
      {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
          const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
          newId = ids.find((id) => !beforeIds.includes(id)) ?? null;
          if (newId || Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!newId) throw new Error("new diff thread did not appear");
      const card = page.locator(`.dhunk section.ithread[data-thread="${newId}"]`).first();
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      await card.getByRole("button", { name: "Close" }).click();
      await expect(page.locator(`.dhunk section.ithread[data-thread="${newId}"]`)).toBeHidden({ timeout: 10_000 });
      return newId;
    };

    // Across three rows inside one hunk.
    await dragSelect(86, 88);
    await explainAndClose();
    const marker = page.locator("mark.anc.range[data-jump]").first();
    await expect(marker).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[id="L-${CONN}-87"]`)).toHaveClass(/rng/);
    // Issue #261: the tightening keeps the gutter affordances — the
    // reopen marker still lives in the first gutter cell, and the new
    // numbers keep their comment tooltip.
    const markerCell = await marker.evaluate((el) => (el.closest("td.n") as HTMLTableCellElement | null)?.cellIndex ?? -1);
    expect(markerCell).toBe(0);
    const tip = await page.locator(`[id="L-${CONN}-87"] td.n.new`).getAttribute("data-tip");
    expect(tip).toMatch(/Comment on line 87|Show comment/);
    // The marker reopens the card.
    await marker.click();
    await expect(page.locator(".dhunk section.ithread[data-thread]").first()).toBeVisible({ timeout: 15_000 });
    await page.locator(".dhunk section.ithread[data-thread]").first().getByRole("button", { name: "Close" }).click();

    // Across a hunk boundary, over long lines: the selection runs to
    // several hundred characters, well past the old 300-char cap.
    await dragSelect(108, 650);
    await explainAndClose();
    const boundaryMarker = page.locator("mark.anc.range[data-jump]").last();
    await expect(boundaryMarker).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[id="L-${CONN}-650"]`)).toHaveClass(/rng/);
    await boundaryMarker.click();
    await expect(page.locator(".dhunk section.ithread[data-thread]").first()).toBeVisible({ timeout: 15_000 });
  });
});
