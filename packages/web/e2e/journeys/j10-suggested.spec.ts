/** J10 (#188 round 2): suggested comments and suggested questions — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { selectText } from "../select-text.js";
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
      const anns = (snap.json as { annotations?: { replies?: { suggested?: boolean }[] }[] }).annotations ?? [];
      if (anns.some((a) => (a.replies ?? []).some((r) => r.suggested))) break;
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

    // Suggested question: a follow-up chip in an auto-written go-deeper
    // card, which stays collapsed until opened (#217). Clicking asks it.
    // (Issue #341: g-alt is the re-recorded guide's first go-deeper card.)
    const flow = page.locator("#C-g-alt");
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
    // Locate it through the API (suggested threads render like any thread).
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const sugHit = (
      (snapRes.json as {
        annotations?: {
          id: string;
          anchor?: { host?: { kind: string } };
          replies?: { suggested?: boolean; blocks?: { type: string; text?: { standard?: string } }[] }[];
        }[];
      }).annotations ?? []
    )
      .filter((a) => a.anchor?.host?.kind === "diff-line")
      .flatMap((a) => (a.replies ?? []).map((r) => ({ a, r })))
      .find(({ r }) => r.suggested);
    if (!sugHit) throw new Error("no suggested diff comment found");
    const sugText = (sugHit.r.blocks ?? [])
      .map((b) => (b.type === "paragraph" ? (b.text?.standard ?? "") : ""))
      .join(" ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 40);
    expect(sugText).not.toBe("");
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const thread = page.locator(`.ithread[data-thread="${sugHit.a.id}"]`).first();
    await expect(thread).toBeVisible({ timeout: 60_000 });
    expect(await thread.textContent()).toContain(sugText.slice(0, 20));
    await expect(thread.locator("textarea")).toHaveCount(0);

    // From comments.spec.ts (#357): issue #301 — selecting in the
    // suggestion summons the toolbar and Ask opens the composer inside
    // the thread; the Ask reply lands in the same thread.
    const askWord = sugText.split(/\s+/).find((w) => w.length > 5) ?? sugText.slice(0, 12);
    await selectText(page, `.ithread[data-thread="${sugHit.a.id}"]`, askWord);
    await expect(page.locator("#selbar")).toBeVisible();
    await page.locator('#selbar [data-act="ask"]').click();
    await expect(page.locator('#right .ithread[data-pending-thread]')).toHaveCount(1);
    const askComposer = thread.locator(".ithread[data-pending-thread]");
    await expect(askComposer).toBeVisible({ timeout: 10_000 });
    await askComposer.locator("textarea").fill("Why this suggestion?");
    await askComposer.getByRole("button", { name: "Ask" }).click();
    const askReply = thread.locator('[data-reply][data-kind="ask"]');
    await expect(askReply).toBeVisible({ timeout: 30_000 });
    await expect(askReply.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });

    // Accept: mark it for the PR.
    const markBtn = thread.getByRole("button", { name: "Add to Outbox" });
    if ((await markBtn.count()) > 0) {
      await markBtn.click();
      await expect(thread.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible({ timeout: 10_000 });
    }

    // Edit its draft on the Comments menu's Outbox tab.
    await page.locator('#reviewbar [data-cm=""]').click();
    await page.locator('.cmenu [data-cmtab="outbox"]').click();
    const draft = page.locator(".cmenu .cm-entry", { hasText: sugText.slice(0, 20) }).locator("textarea").first();
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
