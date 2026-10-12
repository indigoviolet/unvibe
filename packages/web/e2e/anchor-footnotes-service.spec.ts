/**
 * Anchor footnotes over the real service (issue #72, PRD §4.7).
 *
 * Real service (`mise run build` first) + `UNVIBE_AGENT: "replay"` demo
 * review via the shared harness:
 * explanation closed → depth change loses the phrase → footnote chip on the
 * citations line (highlight gone) → click chip re-opens the explanation →
 * switch back → highlight returns, chip hidden again.
 *
 * Quote "fast path" lives in central#b4 at standard but not at deep, so a
 * standard→deep step (instant, stored levels) orphans the anchor and the
 * service flags it stale (see `cards-stale.test.ts`).
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "./network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import type { Page } from "@playwright/test";

const exec = promisify(execFile);

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

async function apiJson(origin: string, token: string, method: string, urlPath: string, body?: unknown): Promise<unknown> {
  const args = ["-s", "-X", method, `${origin}${urlPath}`, "-H", `Authorization: Bearer ${token}`, "-H", "content-type: application/json"];
  if (body !== undefined) args.push("-d", JSON.stringify(body));
  const { stdout } = await exec("curl", args);
  return JSON.parse(stdout);
}

test.describe("anchor footnotes over the real service (replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-footnotes-data-"));
    svc = await startService(dataDir, { agent: "replay", label: "footnotes" });
    const created = (await apiJson(svc.origin, svc.token, "POST", "/api/reviews", { repoId: "demo" })) as {
      review: { id: string };
    };
    reviewId = created.review.id;
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
        pages: { id: string; cards: { id: string; blocks: unknown[] }[] }[];
      };
      const root = snap.pages.find((p) => p.id === "root");
      const ready =
        root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0) &&
        root?.cards.some((c) => c.id === "central" && c.blocks.length > 0);
      if (ready) break;
      if (Date.now() > deadline) throw new Error("guide did not fill in time");
      await new Promise((r) => setTimeout(r, 1000));
    }
  });

  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function openReview(page: Page): Promise<void> {
    if (!svc) throw new Error("service not running");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  test("closed explanation → deep → chip → open → back → highlight", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("service not running");
    await openReview(page);

    // Create a closed expansion on central#b4 with the standard-only phrase.
    const created = (await apiJson(svc.origin, svc.token, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "explain",
      quote: "fast path",
      anchor: { where: "block", blockId: "central#b4" },
    })) as { annotationId: string; jobId?: string };
    const annId = created.annotationId;
    if (created.jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = (await apiJson(svc.origin, svc.token, "GET", `/api/reviews/${reviewId}`)) as {
          annotations: { id: string; expansion?: { blocks: unknown[] } }[];
        };
        const ann = cur.annotations.find((a) => a.id === annId);
        if (ann?.expansion && ann.expansion.blocks.length > 0) break;
        if (Date.now() > deadline) throw new Error("expansion did not fill in time");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    // Close it so only the dotted highlight remains.
    await apiJson(svc.origin, svc.token, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "close",
      annotationId: annId,
    });
    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // At standard the dotted highlight lands and the footnote stays hidden.
    // (Highlight marks live in the paragraph text; footnote chips live in
    // `.lo` — exclude `.fnote` so the two are never confused.)
    const mark = page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    const chip = page.locator(`#C-central .lo mark.fnote.exl[data-jump="${annId}"]`);
    await expect(chip).toBeHidden({ timeout: 10_000 });

    // Step to deep (stored levels: instant, no agent). The phrase is gone,
    // so the highlight drops and the chip appears on the citations line.
    await page.locator("#C-central > .ctl").getByRole("button", { name: "Deeper" }).click();
    await expect(
      page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`),
    ).toHaveCount(0, {
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
    await expect(expCard).toBeVisible({
      timeout: 15_000,
    });

    // Close it again so the return trip asserts the closed highlight path.
    await expCard.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`#C-central [data-expansion="${annId}"]`)).toHaveCount(0, {
      timeout: 10_000,
    });

    // Switching back restores the highlight and hides the chip.
    await page.locator("#C-central > .ctl").getByRole("button", { name: "Simpler" }).click();
    await expect(
      page.locator(`#C-central mark.anc.exl[data-jump="${annId}"]:not(.fnote)`).first(),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(chip).toBeHidden({ timeout: 10_000 });
  });
});
