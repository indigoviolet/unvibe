/** J15 (#188): multi-turn conversation — follow-ups, a restart, an access change. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J15 multi-turn conversation", () => {
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

  test("follow-ups stay in one card across a restart and an access-mode change", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Turn 1: Ask.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    const followUp = async (question: string): Promise<void> => {
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect(box).toBeVisible({ timeout: 15_000 });
      const answersBefore = await card.locator(".exp-b").count();
      await box.fill(question);
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      await expect
        .poll(async () => card.locator(".exp-b").count(), { timeout: 60_000 })
        .toBeGreaterThan(answersBefore);
      await expect(card.locator(".exp-b").last()).not.toBeEmpty({ timeout: 60_000 });
      // Still the same single card for this conversation.
      await expect(page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" })).toHaveCount(1);
    };

    // Turn 2: follow-up in the same session/card.
    await followUp("Does a cookie header change this?");

    // Restart in between: the conversation is still there, in the same card.
    await svc.stop();
    svc = await startService(dataDir, { agent: "replay" });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 30_000 });
    // #204: the card survives the restart pinned inline, with no
    // pin/unpin control.
    await expect(card).not.toHaveClass(/floating/);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    // Both earlier turns are still in the one card after the restart.
    await expect(card.locator(".exp-b")).toHaveCount(2, { timeout: 30_000 });
    await expect(card).toContainText("What is line folding?");
    await expect(card).toContainText("Does a cookie header change this?");

    // Turn 3 (post-restart): the agent gets the card's earlier turns, so
    // the answer lands in context — the job's prompt (Debug's record)
    // carries the earlier questions, and the card keeps all three turns.
    await followUp("What about ordering?");
    await expect(card.locator(".exp-b")).toHaveCount(3, { timeout: 30_000 });
    if (!svc) throw new Error("no service");
    const jobsRes = await apiJson(svc, "GET", `/api/jobs?review=${reviewId}`);
    const askJobs = ((jobsRes.json as { jobs?: { id: string; kind: string }[] }).jobs ?? []).filter((j) => j.kind === "ask");
    expect(askJobs.length).toBeGreaterThanOrEqual(3);
    const lastAsk = askJobs[askJobs.length - 1]!;
    const promptRes = await apiJson(svc, "GET", `/api/jobs/${lastAsk.id}/prompt`);
    const promptText = (promptRes.json as { promptSnapshot?: string }).promptSnapshot ?? "";
    // Rebuilt-or-loaded, the post-restart turn's context includes the
    // earlier turns of this card (never a fresh, context-less start).
    expect(promptText).toContain("What is line folding?");
    // The Debug page lists that job for the review.
    await page.goto(`${svc.origin}/review/${reviewId}/debug?token=${svc.token}`);
    await expect(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("body")).toContainText(/ask/i, { timeout: 30_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(card).toBeVisible({ timeout: 60_000 });

    // Access-mode change in between: turn full access on, then keep talking.
    await page.goto(`${svc.origin}/settings?token=${svc.token}`);
    await page.getByRole("tab", { name: "Access" }).click();
    await page.getByRole("button", { name: "Turn on full access…" }).click();
    await page.getByRole("button", { name: "I understand, turn on full access" }).click();
    await expect(page.locator('[data-testid="access-state"]')).toContainText("Full access is on", { timeout: 15_000 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(card).toBeVisible({ timeout: 60_000 });

    // Turn 4: the same card still answers.
    await followUp("And does the regex stay fast?");
  });
});
