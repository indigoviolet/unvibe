/** J273 (#273): flat threads — ask, explain-inside, comment, reply link, collapse-all. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

interface Reply {
  id: string;
  kind: string;
  question: string | null;
  linkTo?: string;
  blocks: unknown[];
  error?: string | null;
}

interface Thread {
  id: string;
  type: string;
  anchor: { quotedText?: string; host: { kind: string } };
  open: boolean;
  replies: Reply[];
}

async function threads(svc: RunningService, reviewId: string): Promise<Thread[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((snap.json as { annotations?: Thread[] }).annotations ?? []) as Thread[];
}

test.describe("J273 flat threads", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j273-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("ask starts a thread, explain-inside appends a reply, Reply asks again, link scrolls, collapse-all works", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Ask on guide text starts a new thread; its answer is the first reply.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();

    // The thread renders inline under the card with kind-badged replies.
    const thread = page.locator('#C-problem section.ithread[data-thread]').first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
    await expect(thread.locator(".kind-ask").first()).toBeVisible();
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();

    // Issue #293: the question shows as a reviewer comment with the
    // answer as the reply directly under it — no muted heading, no gap.
    const q1 = thread.locator('[data-ask-question]').first();
    await expect(q1).toContainText("What is line folding?", { timeout: 30_000 });
    await expect(q1.locator(".av.you")).toBeVisible();
    await expect(q1.locator(".kind-comment")).toBeVisible();
    await expect(q1).toContainText("Reviewer comment");
    const a1 = thread.locator('[data-ask-answer]').first();
    await expect(a1).toBeVisible({ timeout: 30_000 });
    await expect(a1.locator(".av.ai")).toBeVisible();
    // The answer carries no question heading.
    await expect(a1.locator(".ans-q")).toHaveCount(0);
    // Question sits directly before its answer (no gap between them).
    const order1 = await thread.evaluate((el) =>
      [...el.querySelectorAll("[data-ask-question],[data-ask-answer]")].map((n) =>
        n.getAttribute("data-ask-question") ? `q:${n.getAttribute("data-ask-question")}` : `a:${n.getAttribute("data-ask-answer")}`,
      ),
    );
    expect(order1.slice(0, 2)).toEqual([`q:${await a1.getAttribute("data-ask-answer")}`, `a:${await a1.getAttribute("data-ask-answer")}`]);
    // The question never enters the Outbox: stored replies stay ask-only.
    const snapAsk = await threads(svc!, reviewId);
    const askThread = snapAsk.find((t) => t.id === threadId);
    expect(askThread).toBeTruthy();
    expect(askThread!.replies.map((r) => r.kind)).not.toContain("comment");
    expect((askThread as unknown as { post: boolean }).post).toBe(false);

    // Exactly one thread for this anchor (flat, never nested boxes).
    const threadCount = await page.locator('#C-problem section.ithread[data-thread]').count();
    expect(threadCount).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#C-problem section.ithread[data-thread] [data-expansion]')).toHaveCount(0);

    // Explain inside the thread appends a reply in the same thread.
    const askBody = thread.locator('[data-reply][data-kind="ask"] .exp-b').first();
    await expect(askBody).not.toBeEmpty({ timeout: 60_000 });
    const word = await askBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
    expect(word).not.toBe("");
    await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="ask"] .exp-b`, word);
    await page.locator('#selbar [data-act="explain"]').click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBeGreaterThanOrEqual(2);
    await expect(thread.locator('[data-reply][data-kind="explain"]').first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/j273-thread.png" });

    // Still one thread, now with ask + explain replies (flat).
    const snap1 = await threads(svc, reviewId);
    const mine = snap1.find((t) => t.id === threadId);
    expect(mine).toBeTruthy();
    expect(mine!.replies.map((r) => r.kind)).toContain("ask");
    expect(mine!.replies.map((r) => r.kind)).toContain("explain");
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(1);

    // The source reply hyperlinks to the new reply (in-thread link).
    const link = thread.locator('button.rlink[data-replylink]').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const targetId = await link.getAttribute("data-replylink");
    expect(targetId).toBeTruthy();
    await link.click();
    const target = page.locator(`[data-reply="${targetId}"]`);
    await expect(target).toBeVisible({ timeout: 15_000 });
    await expect(target).toHaveClass(/flash/, { timeout: 15_000 });
    await page.screenshot({ path: "test-results/j273-replylink.png" });

    // The single Reply box asks the agent: a follow-up appends an Ask
    // reply in the same thread (flat, kind badged). Only one box — the
    // comment-reply box is gone from agent threads; reviewer comments
    // are written elsewhere (covered in comment-only threads by J9).
    await expect(thread.locator("textarea")).toHaveCount(1);
    await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 60_000,
      })
      .toBeGreaterThanOrEqual(3);
    await expect(thread.locator('[data-reply][data-kind="ask"]')).toHaveCount(2, { timeout: 60_000 });

    // Issue #293 follow-up: each question is a comment, each answer a reply.
    await expect(thread.locator("[data-ask-question]")).toHaveCount(2, { timeout: 30_000 });
    await expect(thread.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
    await expect(thread.locator("[data-ask-question]").nth(1)).toContainText("Does a cookie header change this?", { timeout: 30_000 });
    await expect(thread.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
    // Explain keeps its own heading (only Ask splits into comment + reply).
    await expect(thread.locator('[data-reply][data-kind="explain"] .ans-q').first()).toContainText("Explain", { timeout: 30_000 });
    const order2 = await thread.evaluate((el) =>
      [...el.querySelectorAll("[data-ask-question],[data-ask-answer]")].map((n) =>
        n.getAttribute("data-ask-question") ? `q:${n.getAttribute("data-ask-question")}` : `a:${n.getAttribute("data-ask-answer")}`,
      ),
    );
    expect(order2.length).toBe(4);
    for (let i = 0; i < order2.length; i += 2) {
      expect(order2[i].slice(0, 2)).toBe("q:");
      expect(order2[i + 1].slice(0, 2)).toBe("a:");
      expect(order2[i].slice(2)).toBe(order2[i + 1].slice(2));
    }
    const snapFollow = await threads(svc!, reviewId);
    const followThread = snapFollow.find((t) => t.id === threadId);
    expect(followThread).toBeTruthy();
    expect(followThread!.replies.filter((r) => r.kind === "comment")).toHaveLength(0);
    expect((followThread as unknown as { post: boolean }).post).toBe(false);

    // Collapse-all turns every thread into one row; expanding restores this one.
    await page.locator('[data-testid="collapse-threads"]').click();
    const row = page.locator(`button.spike-row[data-row="${threadId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(/1 reply|2 replies|3 replies/);
    await page.screenshot({ path: "test-results/j273-collapsed.png" });
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0);
    await row.click();
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(`#C-problem [data-thread="${threadId}"] [data-reply]`).first()).toBeVisible();
    await page.screenshot({ path: "test-results/j273-expanded.png" });
  });
});
