/** J303 (#303): a thread quote spanning inline code and plain text still matches. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Select from the start of an inline-code span to a few words past
 * it — the same Range a drag across the code boundary makes. Finds the
 * first code span in the card that has following text (a trailing code
 * span has nothing to span into). */
async function selectAcrossCode(page: import("@playwright/test").Page, card: string): Promise<string> {
  return page.evaluate((sel: string) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`no card ${sel}`);
    for (const p of [...root.querySelectorAll("p.sel")]) {
      for (const code of [...p.querySelectorAll("code")].filter((c) => (c.textContent ?? "").trim() !== "")) {
        // All text nodes of the paragraph in order; the quote starts at
        // the first text inside the code span and ends a few words past
        // the span (siblings of the code element, not of its content).
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        const texts: Text[] = [];
        for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
        const startIdx = texts.findIndex((t) => code.contains(t));
        if (startIdx < 0) continue;
        const after = texts.slice(startIdx + 1).filter((t) => !code.contains(t) && t.data.trim() !== "");
        if (after.length === 0) continue;
        const endText = after[Math.min(after.length - 1, 2)]!;
        const endOffset = Math.min(12, endText.data.length);
        const range = document.createRange();
        range.setStart(texts[startIdx]!, 0);
        range.setEnd(endText, endOffset);
        const selection = window.getSelection();
        if (!selection) throw new Error("no selection");
        selection.removeAllRanges();
        selection.addRange(range);
        p.scrollIntoView({ block: "center" });
        p.setAttribute("data-j303-para", "1");
        // Same mouseup the drag path ends with, so the toolbar opens.
        (endText.parentElement ?? document).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return (code.textContent ?? "").trim().split(/\s+/)[0] ?? "";
      }
    }
    throw new Error("no code span with following text in guide card");
  }, card);
}

test.describe("J303 cross-element thread quotes", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j303-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("a quote spanning code and text marks the phrase, with no fallback chip", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // A paragraph whose code span has following text; the helper picks
    // the first suitable span, marks the paragraph and selects across it.
    const codeWord = await selectAcrossCode(page, "#C-problem");
    expect(codeWord.length).toBeGreaterThan(0);
    await expect(page.locator("#selbar")).toBeVisible({ timeout: 15_000 });
    // Explain fires immediately (no composer; Ask opens one): the thread
    // lands with a placeholder, then the replay agent fills the answer.
    await page.locator('#selbar [data-act="explain"]').click();

    const thread = page.locator("#C-problem section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();
    await expect(thread.locator('[data-reply][data-kind="explain"] .exp-b').first()).not.toBeEmpty({
      timeout: 90_000,
    });
    await thread.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
      timeout: 15_000,
    });

    // The mark covers the phrase across the code boundary (mark text holds
    // both the code word and the following words).
    const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${threadId}"]:not(.fnote)`).first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await expect(mark).toContainText(codeWord);
    // …and no duplicate fallback chip appears on the citations line.
    await expect(page.locator(`#C-problem [data-fallback="${threadId}"]:visible`)).toHaveCount(0, {
      timeout: 15_000,
    });
    // …nor a comment-thread chip for the agent thread (issue #303: the
    // `.th` chips belong to GuideThreads, which only tracks threads with
    // a reviewer comment — an agent thread must not show twice).
    await expect(page.locator(`#C-problem [data-tfallback="${threadId}"]:visible`)).toHaveCount(0, {
      timeout: 15_000,
    });
  });
});
