/** J303 (#303): a thread quote spanning inline code and plain text still matches. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Select from inside the first inline-code span of a guide paragraph to a
 * few words past it — the same Range a drag across the code boundary makes. */
async function selectAcrossCode(page: import("@playwright/test").Page, para: string): Promise<string> {
  return page.evaluate((sel: string) => {
    const p = document.querySelector(sel);
    if (!p) throw new Error(`no paragraph ${sel}`);
    const code = p.querySelector("code");
    if (!code || !code.firstChild) throw new Error("no inline code in paragraph");
    const after: Text[] = [];
    let node: Node | null = code.firstChild;
    while (node && after.length < 3) {
      node = node.nextSibling;
      if (node && node.nodeType === Node.TEXT_NODE && (node as Text).data.trim() !== "") {
        after.push(node as Text);
      } else if (node && node.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let t = walker.nextNode();
        while (t && after.length < 3) {
          if ((t as Text).data.trim() !== "") after.push(t as Text);
          t = walker.nextNode();
        }
      }
    }
    if (after.length === 0) throw new Error("no text after the code span");
    const endText = after[after.length - 1]!;
    const endOffset = Math.min(12, endText.data.length);
    const range = document.createRange();
    range.setStart(code.firstChild, 0);
    range.setEnd(endText, endOffset);
    const selection = window.getSelection();
    if (!selection) throw new Error("no selection");
    selection.removeAllRanges();
    selection.addRange(range);
    // Same mouseup the drag path ends with, so the toolbar opens.
    (endText.parentElement ?? document).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return `${(code.textContent ?? "").trim()} ${(endText.data.slice(0, endOffset)).trim()}`.trim();
  }, para);
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

    // First paragraph with inline code under the problem card.
    const para = await page.evaluate(() => {
      const card = document.querySelector("#C-problem");
      const ps = [...(card?.querySelectorAll("p.sel") ?? [])];
      const hit = ps.find((p) => p.querySelector("code"));
      if (!hit) return null;
      hit.scrollIntoView({ block: "center" });
      hit.setAttribute("data-j303-para", "1");
      return 'p.sel[data-j303-para="1"]';
    });
    expect(para).toBeTruthy();
    const span = await selectAcrossCode(page, para!);
    const codeWord = span.split(" ")[0]!;
    expect(codeWord.length).toBeGreaterThan(0);
    await expect(page.locator("#selbar")).toBeVisible({ timeout: 15_000 });
    await page.locator('#selbar [data-act="explain"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("test");
    await composer.getByRole("button", { name: "Save" }).click();

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
  });
});
