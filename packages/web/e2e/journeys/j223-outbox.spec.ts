/** J223: Outbox marking + Markdown export on a branch review (no PR). */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { apiJson, createScratchReview, makeScratchRepo } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J223 outbox export (branch review)", () => {
  let repoDir = "", dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  const appKey = fileKeyForPath("src/app.py");

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j223-repo-"));
    await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j223-data-"));
    svc = await startService(dataDir);
    reviewId = await createScratchReview(svc, repoDir);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir]) rmSync(d, { recursive: true, force: true });
  });

  test("branch comment is in the Outbox by default and exports as Markdown", async ({ page, context }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });

    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible();
    await slot.locator("textarea").fill("Branch-only thought");
    await slot.getByRole("button", { name: "Save" }).click();
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "Branch-only thought" });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    // Marking works with no PR: new comments are in the Outbox by default.
    await expect(thread.getByRole("button", { name: "In the Outbox · click to remove" })).toBeVisible();

    const exported = await apiJson(svc, "GET", `/api/reviews/${reviewId}/outbox`);
    expect(exported.status).toBe(200);
    const body = exported.json as unknown as { markdown: string; count: number };
    expect(body.count).toBe(1);
    expect(body.markdown).toContain("# Comments on ");
    expect(body.markdown).toContain("## src/app.py:2");
    expect(body.markdown).toContain("Branch-only thought");

    // The menu is one list with three counted sections (#226): the marked
    // comment sits in the Outbox only, with its draft and the export box.
    await page.locator('#reviewbar [data-cm=""]').click();
    const menu = page.locator(".cmenu");
    await expect(menu.locator('[data-cmsec="review"]')).toHaveAttribute("aria-label", "This review, 0 comments");
    await expect(menu.locator('[data-cmsec="review"]')).toContainText("Everything is marked for the Outbox below.");
    await expect(menu.locator('[data-cmsec="outbox"]')).toHaveAttribute("aria-label", "Outbox, 1 comments");
    await expect(menu.locator('[data-cmsec="outbox"]')).toContainText("Branch-only thought");
    // Entries under a file group show only their line, not the file again
    // (the export box below keeps the full anchor by design, #223).
    await expect(menu.locator('[data-cmsec="outbox"] .cmgroup')).toHaveText("src/app.py");
    await expect(menu.locator('[data-cmsec="outbox"] [data-cjump]')).toContainText(":2");
    await expect(menu.locator('[data-cmsec="outbox"] [data-cjump]')).not.toContainText("src/app.py:2");
    await expect(menu.locator('[data-cmsec="github"]')).toHaveAttribute("aria-label", "On GitHub, 0 threads");
    await expect(menu.locator('[data-cmsec="github"]')).toContainText("No review comments on GitHub yet.");
    const box = menu.locator("[data-outbox-md]");
    await expect(box).toBeVisible({ timeout: 10_000 });
    await expect(box).toContainText("Branch-only thought");
    await menu.locator("[data-copy-outbox]").click();
    await expect(page.locator("body")).toContainText("Copied the Outbox Markdown", { timeout: 5_000 }).catch(() => {});
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    if (clip) expect(clip).toContain("Branch-only thought");

    // Removing from the Outbox returns the thread to This review and hides
    // the export box; the three counts still add up to the one thread.
    await page.locator(".cmenu [data-cmclose]").click();
    await thread.getByRole("button", { name: "In the Outbox · click to remove" }).click();
    await expect(thread.getByRole("button", { name: "Add to Outbox" })).toBeVisible({ timeout: 10_000 });
    await page.locator('#reviewbar [data-cm=""]').click();
    await expect(page.locator(".cmenu [data-outbox-md]")).toHaveCount(0);
    await expect(page.locator('.cmenu [data-cmsec="review"]')).toHaveAttribute("aria-label", "This review, 1 comments");
    await expect(page.locator('.cmenu [data-cmsec="review"]')).toContainText("Branch-only thought");
    await expect(page.locator('.cmenu [data-cmsec="outbox"]')).toContainText("Nothing in the Outbox yet.");
    const empty = await apiJson(svc, "GET", `/api/reviews/${reviewId}/outbox`);
    expect((empty.json as unknown as { count: number }).count).toBe(0);
  });
});
