/** J13 (#188 round 2): hunk summaries — activate, delete, summarize again, fold all. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const CONN = "src-urllib3-connection.py";

test.describe("J13 hunk summaries", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j13-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const states = (snap.json as { hunkStates?: { summary?: string }[] }).hunkStates ?? [];
      if (states.filter((s) => s.summary).length >= 8) break;
      if (Date.now() > deadline) throw new Error("hunk summaries did not land");
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("summary activates as a card, delete removes it, Summarize restores it, Fold all folds", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    const connFile = page.locator(`[id="F-${CONN}"]`);
    await expect(connFile).toBeVisible({ timeout: 60_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click().catch(() => {});

    const idle = connFile.locator("p[data-hunksum]").first();
    await expect(idle).toBeVisible({ timeout: 60_000 });
    const summariesBefore = await connFile.locator("p[data-hunksum]").count();

    // Activate: clicking the idle summary opens it as a card.
    await idle.click();
    const card = connFile.locator(".dhunk [data-expansion]").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 30_000 });

    // Delete: card and its summary are both gone.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(connFile.locator(".dhunk [data-expansion]")).toHaveCount(0, { timeout: 15_000 });
    await expect(connFile.locator("p[data-hunksum]")).toHaveCount(summariesBefore - 1, { timeout: 15_000 });

    // Summarize on demand: the replay hunk pass writes it again as idle text.
    await connFile.getByRole("button", { name: "Summarize" }).first().click();
    await expect(connFile.locator("p[data-hunksum]")).toHaveCount(summariesBefore, { timeout: 60_000 });

    // Fold all (diff toolbar): hunks fold behind their headers.
    await page.getByRole("button", { name: "Fold all", exact: true }).click();
    await expect(connFile.getByRole("button", { name: "Show code" }).first()).toBeVisible({ timeout: 15_000 });
  });
});
