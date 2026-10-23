/** J252: glossary terms link in card text; hover shows definition + citation. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J252 glossary linking", () => {
  let svc: RunningService | null = null;
  let reviewId = "";
  let dataDir = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j252-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
    reviewId = (created.json as { review: { id: string } }).review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const s = snap.json as unknown as { glossary?: unknown[]; pages: { id: string; cards: { id: string }[] }[] };
      const root = s.pages.find((p) => p.id === "root");
      if ((s.glossary?.length ?? 0) >= 3 && root?.cards.some((c) => c.id === "central")) break;
      if (Date.now() > deadline) throw new Error("demo guide with glossary did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  test("hovering a linked term shows its definition and citation", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    const link = page.locator("#C-central a.gx[data-glossary]").first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const name = await link.getAttribute("data-glossary");
    expect(name).toBeTruthy();
    await link.hover();
    await expect(page.locator("#pop")).toContainText("headers view", { timeout: 30_000 });
    // Citation button inside the popover reveals the source.
    await expect(page.locator("#pop [data-src]")).toHaveCount(1);
  });
});
