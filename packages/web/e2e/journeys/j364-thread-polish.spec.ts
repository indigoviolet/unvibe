/** J364 (#364): thread polish — per-reply delete, margin icon, reverse link, one composer. */
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
  postedAt?: number;
  replies: Reply[];
}

async function threads(svc: RunningService, reviewId: string): Promise<Thread[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((snap.json as { annotations?: Thread[] }).annotations ?? []) as Thread[];
}

const FRAMES = "/tmp/364-frames";

test.describe("J364 thread polish", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j364-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("delete a reply, margin icon opens, reverse link flashes, Ask uses the Reply chip", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Ask on guide text starts a thread; Explain inside appends a turn.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator("#C-problem section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();

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
      .toBe(2);

    // Frame 1: several turns with bands + spacing.
    await page.screenshot({ path: `${FRAMES}/turns.png` });

    // Ask inside the thread uses the Reply box chip — no second composer.
    await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="ask"] .exp-b`, word);
    await page.locator('#selbar [data-act="ask"]').click();
    await expect(thread.locator('[data-pending-thread]')).toHaveCount(0);
    const chip = thread.locator('[data-quote-chip]');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    // Frame 4: the Reply box with its quote chip.
    await page.screenshot({ path: `${FRAMES}/reply-chip.png` });
    await thread.locator('textarea[aria-label="Reply"]').fill("And then?");
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(3);

    // The margin icon sits on the highlight's first line; closing the
    // thread leaves the icon, and clicking it reopens the thread.
    const margin = page.locator(`[data-thr-margin="${threadId}"]`);
    await expect(margin).toBeVisible({ timeout: 15_000 });
    // Frame 2: the margin icon on the highlight.
    await page.screenshot({ path: `${FRAMES}/margin-icon.png` });
    await thread.locator('button[aria-label="Close"]').click();
    await expect(thread).toBeHidden({ timeout: 15_000 });
    await expect(margin).toBeVisible({ timeout: 15_000 });
    await margin.click();
    await expect(thread).toBeVisible({ timeout: 15_000 });

    // The reverse link scrolls to the highlight and flashes it.
    const srcLink = thread.locator('[data-src-link]').first();
    await expect(srcLink).toBeVisible();
    await srcLink.click();
    const mark = page.locator(`#page mark.anc[data-thr="${threadId}"]`).first();
    await expect(mark).toHaveClass(/flash/, { timeout: 15_000 });
    // Frame 3: the reverse link target mid-flash.
    await page.screenshot({ path: `${FRAMES}/reverse-flash.png` });

    // Per-reply delete: removing an answer removes its question turn;
    // later turns stay. No confirm appears.
    const turns = thread.locator(':scope > .turn');
    await expect(turns).toHaveCount(3, { timeout: 30_000 });
    const second = turns.nth(1);
    await second.hover();
    await second.getByRole("button", { name: "Delete reply" }).first().click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 30_000,
      })
      .toBe(2);
    await expect(thread.locator(':scope > .turn')).toHaveCount(2, { timeout: 30_000 });
    // Frame 5: the thread after a reply was deleted.
    await page.screenshot({ path: `${FRAMES}/after-delete.png` });

    // Deleting every remaining turn deletes the thread itself.
    for (let i = 0; i < 2; i++) {
      const first = thread.locator(':scope > .turn').first();
      await first.hover();
      await first.getByRole("button", { name: "Delete reply" }).first().click();
    }
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId), { timeout: 30_000 })
      .toBeUndefined();
    await expect(page.locator(`section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 30_000 });
  });
});
