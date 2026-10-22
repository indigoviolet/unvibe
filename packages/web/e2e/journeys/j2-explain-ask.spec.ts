/** J2 (#188): Explain, Ask, follow-up, nested card, second opinion — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J2 explain ask follow-up nested", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("explain, ask with follow-up, nested explain, depth, second opinion", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Explain selected guide text; exactly one working indicator while it streams.
    await selectText(page, "#C-central", "fast path");
    await page.locator('#selbar [data-act="explain"]').click();
    const exp = page.locator("#C-central [data-expansion]").first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
    await expect(exp.locator(".working")).toHaveCount(0, { timeout: 30_000 });

    // Nested: select text inside the answer and Explain again.
    const word = await page.evaluate(() => {
      const text = document.querySelector("#C-central [data-expansion] .exp-b")?.textContent ?? "";
      return text.match(/[A-Za-z]{4,}/)?.[0] ?? "";
    });
    expect(word).not.toBe("");
    await selectText(page, "#C-central [data-expansion] .exp-b", word);
    await page.locator('#selbar [data-act="explain"]').click();
    const nested = exp.locator("[data-expansion]").first();
    await expect(nested).toBeVisible({ timeout: 15_000 });
    await expect(nested.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

    // Depth change rewrites the parent answer (visible change, not empty).
    const beforeDepth = await exp.locator(".exp-b").first().innerText();
    await exp.getByRole("button", { name: "Deeper" }).first().click();
    await expect.poll(async () => exp.locator(".exp-b").first().innerText(), { timeout: 60_000 }).not.toBe(beforeDepth);

    // Ask on guide text, then a follow-up in the same card.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem .ui-card.child[data-expansion]", { hasText: "What is line folding?" });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    await expect(card.locator(".lk[data-refs]").first()).toBeVisible({ timeout: 30_000 });

    // Follow-up: use the card's reply box if present; otherwise its suggestion.
    const replyBox = card.locator("textarea").first();
    if ((await replyBox.count()) > 0) {
      await replyBox.fill("Does the fast path still catch a fold that uses a bare LF?");
      const send = card.getByRole("button", { name: /ask|send|reply/i }).first();
      await send.click();
      await expect(card.locator(".exp-b").last()).not.toBeEmpty({ timeout: 60_000 });
    }

    // #204: the Ask card opened pinned inline — no floating class, no
    // pin/unpin control — and its persisted state says pinned.
    await expect(card).not.toHaveClass(/floating/);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    const cardId = await card.getAttribute("data-expansion");
    expect(cardId).toBeTruthy();
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const anns = (snapRes.json as { annotations?: { id: string; pinned?: boolean }[] }).annotations ?? [];
    expect(anns.find((a) => a.id === cardId)?.pinned).toBe(true);

    // Close collapses the card back to its mark; hovering the mark shows
    // the floating peek, and clicking the peek pins the card back.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await mark.hover();
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop")).toContainText(/fold/i);
    await page.locator(`#pop [data-open-expansion="${cardId}"]`).click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toHaveClass(/floating/);

    // Delete removes both the card and its mark, across a reload.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`)).toHaveCount(0);

    // Second opinion on the bare-LF finding (its replay recording is keyed to it).
    await page.goto(`${svc.origin}/review/${reviewId}/page/f-lf?token=${svc.token}`);
    await expect(page.locator("#page")).toBeVisible({ timeout: 30_000 });
    const soBtn = page.locator('button[aria-label^="Second opinion ("]').first();
    if ((await soBtn.count()) > 0 && (await soBtn.isEnabled())) {
      await soBtn.click();
      await expect(page.locator("[data-so]").first()).toBeVisible({ timeout: 60_000 });
    } else {
      // No distinct second-opinion model is configured in replay settings:
      // the control must say so visibly, never silently do nothing.
      await expect(page.locator('[data-so-ctl] .so-warn, button[aria-label="Second opinion needs a different model"]').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test("diff pane: explain opens pinned; close, mark, reopen, delete (#204)", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

    await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator(".dhunk .ui-card.child[data-expansion]").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    // Pinned inline in the diff too: no floating overlay, no pin control.
    await expect(card).not.toHaveClass(/floating/);
    await expect(page.locator(".dhunk .exp-float")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    const cardId = await card.getAttribute("data-expansion");
    expect(cardId).toBeTruthy();

    // Close collapses to the mark in the diff row; clicking the mark
    // reopens the card pinned.
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    const mark = page.locator(`#right mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await mark.click();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toHaveClass(/floating/);

    // Delete removes the card and its mark.
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
  });
});
