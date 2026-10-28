/** J302 (#302): collapsed thread links read differently from glossary terms. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J302 collapsed thread marks and previews", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j302-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a collapsed thread shows a highlighted mark with a glyph, and a pinned-style preview", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Ask on guide text starts a thread; closing it leaves a collapsed mark.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator("#C-problem section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();
    await expect(thread.locator("[data-ask-answer] .exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
    await thread.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // The collapsed mark: soft highlight, one thread glyph, no dotted underline.
    const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${threadId}"]`).first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await expect(mark.locator("svg.thg")).toHaveCount(1);
    const decoration = await mark.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(decoration).toBe("none");
    const bg = await mark.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");

    // Hovering previews the thread as pinned: kind badge, AI avatar, reply count.
    await mark.hover();
    const pop = page.locator("#pop");
    await expect(pop.locator(".pv-thr")).toBeVisible({ timeout: 15_000 });
    await expect(pop.locator(".pv-thr .kind-ask")).toContainText("ask");
    await expect(pop.locator(".pv-thr .av.ai")).toBeVisible();
    await expect(pop.locator(".pv-thr")).toContainText(/1 reply|2 replies/);
    await expect(pop).toContainText("Click to pin here");
  });

  test("a glossary term keeps the dotted underline and a labelled preview", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
    const link = page.locator("#C-central a.gx[data-glossary]").first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    // Glossary keeps the light dotted underline — never the thread highlight.
    const decoration = await link.evaluate((el) => getComputedStyle(el).textDecorationStyle);
    expect(decoration).toBe("dotted");
    await expect(link.locator("svg.thg")).toHaveCount(0);
    await link.hover();
    const pop = page.locator("#pop");
    await expect(pop.locator(".pv-label", { hasText: "Glossary" })).toBeVisible({ timeout: 30_000 });
  });
});
