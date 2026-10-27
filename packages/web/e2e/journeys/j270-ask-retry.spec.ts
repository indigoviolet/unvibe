/** J270 (#270): an Ask follow-up that fails mid-answer, then Retry. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J270 ask follow-up failure and retry", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j270-data-"));
    // Slow the replay stream so the follow-up is reliably mid-flight at the kill.
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
    });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("failed follow-up shows Retry; retry lands a clean answer", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Reply 1: Ask.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    // Reply 2: follow-up, killed mid-answer.
    const box = card.getByPlaceholder(/Ask a follow-up/);
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill("Does a cookie header change this?");
    await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
    // Issue #293: questions are separate entries — answers are `ask-answer`.
    // Wait for the follow-up pair to exist, then target the answer paired
    // with its question (stable under load).
    await expect(card.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
    const q2 = card.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
    await expect(q2).toBeVisible({ timeout: 30_000 });
    const q2Id = await q2.getAttribute("data-ask-question");
    expect(q2Id).toBeTruthy();
    const second = card.locator(`[data-ask-answer="${q2Id}"]`);
    await expect(second.locator(".working")).toBeVisible({ timeout: 30_000 });
    svc.killHard();
    await page.waitForTimeout(500);
    svc = await startService(dataDir, { agent: "replay" });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
    const after = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
    await expect(after).toBeVisible({ timeout: 30_000 });
    // The interrupted follow-up shows the failed banner with Retry — and
    // no toolbar or reply box on that turn. Wait for the reply to exist
    // first, then target the answer paired with the follow-up question
    // (stable under load; never an index into a half-rendered list).
    await expect(after.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
    const afterQ = after.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
    await expect(afterQ).toBeVisible({ timeout: 30_000 });
    const afterId = await afterQ.getAttribute("data-ask-question");
    expect(afterId).toBeTruthy();
    const failed = after.locator(`[data-ask-answer="${afterId}"]`);
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
    await page.screenshot({ path: "test-results/j270-failed.png" });
    await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
    await expect(failed.locator(".ctl")).toHaveCount(0);

    // Retry refills the same turn with a clean answer: no raw trailing
    // block, no cut-off start, no internal ids anywhere.
    await failed.getByRole("button", { name: "Retry" }).click();
    // The retried (latest) answer gets its toolbar back; earlier answers
    // keep theirs hidden until hover.
    await expect(failed.locator(".ctl")).toBeVisible({ timeout: 120_000 });
    await expect(after.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
    const retried = after.locator(".exp-b").nth(1);
    await expect(retried).not.toBeEmpty({ timeout: 60_000 });
    await expect(retried).not.toContainText('{"contribute"');
    await expect(retried).not.toContainText("ann_");
    await expect(after).not.toContainText("no failed turn");
    // Any toast (e.g. from the retry) carries plain words, never an id.
    const toast = page.locator("#toast");
    if ((await toast.count()) > 0) {
      await expect(toast).not.toContainText("ann_");
    }
  });
});
