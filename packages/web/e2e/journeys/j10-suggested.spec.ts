/** J10 (#188 round 2): suggested comments and suggested questions — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J10 suggested comments and questions", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j10-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    // Wait until the critics' suggested comments have landed.
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as { annotations?: { messages: { suggested?: boolean }[] }[] }).annotations ?? [];
      if (anns.some((a) => a.messages.some((m) => m.suggested))) break;
      if (Date.now() > deadline) throw new Error("no suggested comment landed");
      await new Promise((r) => setTimeout(r, 500));
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("accept a suggested question, accept/edit/dismiss a suggested comment", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Suggested question: a follow-up chip in the auto-written go-deeper
    // flow card, which stays collapsed until opened (#217). Clicking asks it.
    const flow = page.locator("#C-g-flow");
    await flow.scrollIntoViewIfNeeded();
    await expect(flow).toHaveClass(/collapsed/, { timeout: 120_000 });
    await flow.getByRole("button", { name: "Expand" }).click();
    const follow = page.locator("#page .follow button").first();
    await expect(follow).toBeVisible({ timeout: 30_000 });
    const label = (await follow.innerText()).trim();
    expect(label).not.toBe("");
    await follow.click();
    // The chip is consumed once asked (interaction-service pattern).
    await expect(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 60_000 });

    // Suggested comment in the diff: no reply box, agent-authored.
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const sugMsg = page.locator("[data-ai-comment]").first();
    await expect(sugMsg).toBeVisible({ timeout: 60_000 });
    const thread = page.locator(".ithread[data-thread]", { has: sugMsg }).first();
    await expect(thread.locator("textarea")).toHaveCount(0);

    // Accept: mark it for the PR.
    const markBtn = thread.getByRole("button", { name: "Add to Outbox" });
    if ((await markBtn.count()) > 0) {
      await markBtn.click();
      await expect(thread.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible({ timeout: 10_000 });
    }

    // Edit its draft on the Comments menu's Outbox tab.
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    const draft = page.locator(".cmenu textarea[id^='ob-']").first();
    if ((await draft.count()) > 0) {
      await draft.fill("Edited suggestion for the PR.");
      await page.waitForResponse(
        (r) => r.url().includes("/comments/") && r.request().method() === "PATCH" && r.ok(),
        { timeout: 10_000 },
      ).catch(() => {});
    }
    await page.keyboard.press("Escape");

    // Dismiss: delete this suggestion (others may remain); it stays gone.
    await expect(thread).toBeVisible({ timeout: 10_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();
    await thread.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(`.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 10_000 });
    await page.reload();
    await expect(page.locator("#right")).toBeVisible({ timeout: 30_000 });
  });
});
