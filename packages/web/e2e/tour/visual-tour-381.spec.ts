/**
 * #381 tour: the thread reply footer — follow-up chips with inline code
 * (one long wrapping suggestion, one short), no "Follow up:" label, and
 * the icon-only quoted-passage button. 1440px light only (single frame;
 * the slim default).
 *
 * On-demand only (`mise run visual-tour -- visual-tour-381.spec.ts`):
 * behaviour lives in `e2e/journeys/l4-threads.spec.ts`; this file keeps
 * just enough asserts to prove the framed state. Requires
 * `mise run build` first.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { checkLayout } from "../layout-check.js";
import { apiJson, createSeededDemoReview } from "../journeys/journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour/381", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

/**
 * Let a programmatic scroll land: poll until the viewport stops moving
 * instead of sleeping a fixed window (#363 B2).
 */
async function settleScroll(page: import("@playwright/test").Page): Promise<void> {
  let prev = "";
  await expect
    .poll(
      async () => {
        const cur = await page.evaluate(() => `${window.scrollX},${window.scrollY}`);
        const settled = prev !== "" && cur === prev;
        prev = cur;
        return settled;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.describe("381 reply footer", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  const reviewId = "tour-381";

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour381-data-"));
    // Static seeded review: no jobs, so the footer never mutates mid-frame.
    createSeededDemoReview(dataDir, reviewId);
    svc = await startService(dataDir, { agent: "none", label: "tour381" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reply footer with code chips, no label, icon button (1440-light)", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    // The seeded explain answer's follow-up block: one long (wrapping)
    // backticked suggestion and one short one (real-service fixture
    // content, not a mock).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const anns = (
      snap.json as {
        annotations?: {
          id: string;
          replies?: { blocks?: { type: string; items?: { label: string }[] }[] }[];
        }[];
      }
    ).annotations ?? [];
    const seeded = anns.find((a) =>
      (a.replies ?? []).some((r) =>
        (r.blocks ?? []).some(
          (b) => b.type === "follow-up" && (b.items ?? []).some((i) => i.label.includes("`")),
        ),
      ),
    );
    if (!seeded) throw new Error("no seeded reply with a backticked follow-up");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    const mine = page.locator(`section.ithread[data-thread="${seeded.id}"]`);
    await expect(mine).toBeVisible({ timeout: 30_000 });
    const footer = mine.locator(".follow").first();
    await expect(footer).toBeVisible({ timeout: 15_000 });
    const chips = footer.locator("button");
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: "keep the line ending" }).locator("code").first()).toContainText(
      "http.client",
    );
    await expect(footer).not.toContainText("Follow up:");
    const rev = mine.getByRole("button", { name: "Show the quoted passage" }).first();
    await expect(rev).toBeVisible();
    await footer.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await settleScroll(page);
    await checkLayout(page, "381-reply-footer");
    await page.screenshot({ path: path.join(SHOTS, "reply-footer-1440-light.png") });
  });
});
