/** J15 (#188, reworked #273): multi-turn thread — follow-ups, a restart, an access change. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J15 multi-turn thread", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j15-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("follow-ups stay in one thread across a restart and an access-mode change", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Reply 1: Ask starts the thread.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"] .exp-b').first()).not.toBeEmpty({ timeout: 60_000 });

    const followUp = async (question: string): Promise<void> => {
      const box = thread.getByPlaceholder(/Ask a follow-up/);
      await expect(box).toBeVisible({ timeout: 15_000 });
      const answersBefore = await thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]').count();
      await box.fill(question);
      await thread.getByRole("button", { name: "Ask" }).last().click();
      await expect
        .poll(async () => thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]').count(), { timeout: 60_000 })
        .toBeGreaterThan(answersBefore);
      await expect(thread.locator('[data-reply] .exp-b').last()).not.toBeEmpty({ timeout: 60_000 });
      // Still the same single thread for this conversation.
      await expect(page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" })).toHaveCount(1);
    };

    // Reply 2: follow-up in the same session/thread.
    await followUp("Does a cookie header change this?");

    // Restart in between: the thread is still there, with both replies.
    await svc.stop();
    svc = await startService(dataDir, { agent: "replay" });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply] .exp-b').first()).not.toBeEmpty({ timeout: 30_000 });
    // #204: the thread survives the restart pinned inline, with no
    // pin/unpin control.
    await expect(thread).not.toHaveClass(/floating/);
    await expect(thread.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    // Both earlier replies are still in the one thread after the restart.
    await expect(thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]')).toHaveCount(2, { timeout: 30_000 });
    await expect(thread).toContainText("What is line folding?");
    await expect(thread).toContainText("Does a cookie header change this?");

    // Reply 3 (post-restart): the agent gets the thread's earlier replies.
    await followUp("What about ordering?");
    await expect(thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]')).toHaveCount(3, { timeout: 30_000 });
    if (!svc) throw new Error("no service");
    const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
    const askJobs = ((jobsRes.json as { jobs?: { id: string; kind: string }[] }).jobs ?? []).filter((j) => j.kind === "ask");
    expect(askJobs.length).toBeGreaterThanOrEqual(3);
    const lastAsk = askJobs[askJobs.length - 1]!;
    const promptRes = await apiJson(svc, "GET", `/api/jobs/${lastAsk.id}`);
    const promptText = (promptRes.json as { job?: { promptSnapshot?: string } }).job?.promptSnapshot ?? "";
    expect(promptText).toContain("What is line folding?");
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/ask/i, { timeout: 30_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(thread).toBeVisible({ timeout: 60_000 });

    // Access-mode change in between: turn full access on, then keep talking.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("button", { name: "Turn on full access…" }).click();
    await page.getByRole("button", { name: "I understand, turn on full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Full access is on", { timeout: 15_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(thread).toBeVisible({ timeout: 60_000 });

    // Reply 4: the same thread still answers.
    await followUp("And does the regex stay fast?");
  });

  test("a sent follow-up stays sent across a reload", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Does the fast path still catch a fold that uses a bare LF?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator('#C-central section.ithread[data-thread]', {
      hasText: "Does the fast path still catch a fold",
    });
    await expect(thread.first()).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply] .exp-b').first()).not.toBeEmpty({ timeout: 30_000 });

    const box = thread.locator('textarea[aria-label="Ask a follow-up"]');
    await box.fill("never mind");
    await thread.getByRole("button", { name: "Clear" }).click();
    await expect(box).toHaveValue("");
    await box.fill("And a bare LF?");
    await thread.getByRole("button", { name: "Ask" }).last().click();
    await expect(box).toHaveValue("", { timeout: 5000 });
    await expect(thread.locator("[data-reply]").nth(1)).toContainText("bare LF", { timeout: 30_000 });
    await expect(box).toHaveValue("");

    await page.reload();
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete", { timeout: 30_000 });
    const again = page.locator('#C-central section.ithread[data-thread]', {
      hasText: "Does the fast path still catch a fold",
    });
    await expect(again.first()).toBeVisible({ timeout: 30_000 });
    await expect(again.locator("[data-reply]").nth(1)).toContainText("bare LF", { timeout: 30_000 });
    await expect(again.locator('textarea[aria-label="Ask a follow-up"]')).toHaveValue("");
  });
});
