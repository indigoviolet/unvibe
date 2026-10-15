/** J9 (#188 round 2): comment reply, edit, close/reopen, delete — stubbed gh. */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { fileKeyForPath } from "@unvibe/shared";
import { createScratchReview, makeScratchRepo, writeFakeGh } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
const appKey = fileKeyForPath("src/app.py");

test.describe("J9 comment edges", () => {
  let repoDir = "", dataDir = "", logDir = "", fakeBin = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    repoDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-repo-"));
    const repo = await makeScratchRepo(repoDir);
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-data-"));
    logDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-gh-"));
    fakeBin = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-bin-"));
    writeFakeGh(fakeBin, logDir, repo.headSha);
    const fakeShell = path.join(fakeBin, "fakeshell");
    writeFileSync(fakeShell, `#!/bin/sh\nprintf "__UNVIBE_PATH_START__%s__UNVIBE_PATH_END__\\n" "${fakeBin}:$PATH"\n`, { mode: 0o755 });
    svc = await startService(dataDir, { extraEnv: { SHELL: fakeShell, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ""}` } });
    reviewId = await createScratchReview(svc, repoDir, { pr: 1 });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    for (const d of [repoDir, dataDir, logDir, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  test("reply, edit draft, close and reopen, then delete", async ({ page }) => {
    test.setTimeout(180_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 60_000 });

    // Create, then reply in the thread.
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    const slot = page.locator(`[id="F-${appKey}"] .ithread[data-pending-thread]`);
    await expect(slot).toBeVisible();
    await slot.locator("textarea").fill("First version of this note.");
    await slot.getByRole("button", { name: "Save" }).click();
    const thread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
    await expect(thread).toBeVisible({ timeout: 10_000 });
    await thread.getByPlaceholder("Reply…").fill("A reply to myself.");
    await thread.getByRole("button", { name: "Reply" }).click();
    await expect(thread).toContainText("A reply to myself.", { timeout: 10_000 });

    // Edit the For-PR draft in the Comments menu; it persists across reopen.
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmf="pr"]').click();
    const draft = page.locator(".cmenu textarea[id^='ob-']").first();
    await expect(draft).toBeVisible({ timeout: 10_000 });
    await draft.fill("Edited version of this note.");
    await page.waitForResponse(
      (r) => r.url().includes("/comments/") && r.request().method() === "PATCH" && r.ok(),
      { timeout: 10_000 },
    );
    await page.keyboard.press("Escape");
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmf="pr"]').click();
    await expect(page.locator(".cmenu textarea[id^='ob-']").first()).toHaveValue("Edited version of this note.");
    await page.keyboard.press("Escape");

    // Close leaves the thread; clicking the line reopens it.
    const openThread = page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version of this note." });
    await expect(openThread).toBeVisible({ timeout: 10_000 });
    await openThread.getByRole("button", { name: "Close" }).click();
    await expect(openThread).toHaveCount(0, { timeout: 10_000 });
    await page.locator(`[id="L-${appKey}-2"] td.n.new`).click();
    await expect(openThread).toBeVisible({ timeout: 10_000 });

    // Delete removes it for good.
    await openThread.getByRole("button", { name: "Delete" }).click();
    await expect(openThread).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await expect(page.locator(`[id="F-${appKey}"]`)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`[id="F-${appKey}"] .ithread[data-thread]`, { hasText: "First version" })).toHaveCount(0);
  });
});
