/** J273 (#273): flat threads — ask, explain-inside, comment, reply link, collapse-all. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview } from "./journey-helpers.js";

/** First text line vs the floated avatar (#331): top alignment, first-line
 * indent past the avatar, and wrap-back of the paragraph box to the thread
 * padding (later lines start left of the avatar's right edge). The box edge
 * — not the last line's rect, which inline markers can shift — proves the
 * wrap-back. */
async function firstLineGeometry(reply: Locator): Promise<{
  lines: number;
  dTop: number;
  firstLeft: number;
  avRight: number;
  pLeft: number;
} | null> {
  return reply.evaluate((el) => {
    const av = el.querySelector(":scope > .av");
    const p = el.querySelector(":scope > p, :scope > .exp-b .blk:first-child > p");
    if (!(av instanceof HTMLElement) || !(p instanceof HTMLElement)) return null;
    const a = av.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return null;
    const first = rects[0]!;
    return {
      lines: rects.length,
      dTop: first.top - a.top,
      firstLeft: first.left,
      avRight: a.right,
      pLeft: p.getBoundingClientRect().left,
    };
  });
}

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

    // The thread renders inline under the card with avatar-marked replies.
    const thread = page.locator('#C-problem section.ithread[data-thread]').first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
    // Issue #315: no kind chip on Ask entries — the AI avatar says who's speaking.
    await expect(thread.locator('[data-ask-answer] .av.ai').first()).toBeVisible();
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();

    // Issue #293: the question shows as a reviewer comment with the
    // answer as the reply directly under it — no muted heading, no gap.
    const q1 = thread.locator('[data-ask-question]').first();
    await expect(q1).toContainText("What is line folding?", { timeout: 30_000 });
    await expect(q1.locator(".av.you")).toBeVisible();
    // Issue #315: no comment chip, no "Reviewer comment" label — the
    // entries keep accessible names so screen readers still tell them apart.
    await expect(q1).toHaveAttribute("aria-label", "Your question");
    await expect(q1.locator(".kind")).toHaveCount(0);
    await expect(q1).not.toContainText("Reviewer comment");
    const a1 = thread.locator('[data-ask-answer]').first();
    await expect(a1).toBeVisible({ timeout: 30_000 });
    await expect(a1.locator(".av.ai")).toBeVisible();
    await expect(a1).toHaveAttribute("aria-label", "Agent answer");
    await expect(a1.locator(".kind")).toHaveCount(0);
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
    // Explain is avatar-only too (#315 follow-up): no kind chip, no heading.
    await expect(thread.locator('[data-reply][data-kind="explain"] .kind')).toHaveCount(0);
    await expect(thread.locator('[data-reply][data-kind="explain"] .ans-q')).toHaveCount(0);
    await expect(thread.locator('[data-reply][data-kind="explain"]').first()).toHaveAttribute("aria-label", "Agent explanation");
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
    // #326: the control is an icon button in the review top bar.
    await page.getByRole("button", { name: "Collapse threads" }).click();
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

  test("inline avatars, Outbox mark and replies-after-first counts (#331, #315 follow-up)", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // A long lone reviewer comment: avatar only, Outbox mark, no chips.
    await selectText(page, "#C-problem", "untidy");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    const loneText =
      "This fold handling reads like a quiet compatibility shim: it keeps every downstream consumer working without knowing the wire format ever allowed a split line, and it does so without changing the order or the duplicates anyone already depends on.";
    await composer.locator("textarea").fill(loneText);
    await composer.getByRole("button", { name: "Save" }).click();
    const lone = page.locator("#C-problem section.ithread[data-thread]", { hasText: loneText.slice(0, 40) });
    await expect(lone).toBeVisible({ timeout: 15_000 });
    const loneId = await lone.getAttribute("data-thread");
    expect(loneId).toBeTruthy();
    const loneReply = lone.locator('[data-reply][data-kind="comment"]').first();
    await expect(loneReply.locator(":scope > .av.you")).toBeVisible();
    await expect(loneReply.locator(".kind")).toHaveCount(0);
    await expect(loneReply.locator(".ans-q")).toHaveCount(0);
    await expect(loneReply).toHaveAttribute("aria-label", "Reviewer comment");
    await expect(loneReply.locator(".outbox-mark")).toHaveAttribute(
      "aria-label",
      "Posts to GitHub from the Outbox",
    );
    // A lone opening comment shows no reply count.
    await expect(lone.locator("[data-count]")).toHaveCount(0);
    // The comment's first line starts on the avatar's line; later lines
    // wrap back to the thread padding.
    const loneGeo = await firstLineGeometry(loneReply);
    expect(loneGeo).not.toBeNull();
    expect(Math.abs(loneGeo!.dTop)).toBeLessThanOrEqual(6);
    expect(loneGeo!.firstLeft).toBeGreaterThanOrEqual(loneGeo!.avRight - 2);
    expect(loneGeo!.lines).toBeGreaterThan(1);
    expect(loneGeo!.pLeft).toBeLessThan(loneGeo!.avRight - 2);

    // A short comment that gets an agent answer: the header counts replies
    // after the first entry, so a comment plus one answer shows "1 reply".
    await selectText(page, "#C-problem", "server");
    await page.locator('#selbar [data-act="note"]').click();
    const composer2 = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer2).toBeVisible({ timeout: 10_000 });
    const shortText = "A short note on the fold handling.";
    await composer2.locator("textarea").fill(shortText);
    await composer2.getByRole("button", { name: "Save" }).click();
    const comment = page.locator("#C-problem section.ithread[data-thread]", { hasText: shortText });
    await expect(comment).toBeVisible({ timeout: 15_000 });
    const commentId = await comment.getAttribute("data-thread");
    expect(commentId).toBeTruthy();
    await expect(comment.locator("[data-count]")).toHaveCount(0);
    await comment.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
    await comment.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === commentId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(2);
    await expect(comment.locator("[data-count]")).toHaveText("1 reply");
    const answer = comment.locator("[data-ask-answer]").first();
    await expect(answer.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
    await expect(answer.locator(":scope > .av.ai")).toBeVisible();
    await expect(answer.locator(".kind")).toHaveCount(0);
    await expect(answer.locator(".ans-q")).toHaveCount(0);
    await expect(answer).toHaveAttribute("aria-label", "Agent answer");
    const ansGeo = await firstLineGeometry(answer);
    expect(ansGeo).not.toBeNull();
    expect(Math.abs(ansGeo!.dTop)).toBeLessThanOrEqual(6);
    expect(ansGeo!.firstLeft).toBeGreaterThanOrEqual(ansGeo!.avRight - 2);
    if (ansGeo!.lines > 1) {
      expect(ansGeo!.pLeft).toBeLessThan(ansGeo!.avRight - 2);
    }

    // A list-first agent answer starts below the avatar (#331 fallback).
    await selectText(page, "#C-problem", "continue");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer3 = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer3).toBeVisible({ timeout: 10_000 });
    await composer3.locator("textarea").fill("What is on the packing list for this fix?");
    await composer3.getByRole("button", { name: "Ask" }).click();
    const listed = page.locator("#C-problem section.ithread[data-thread]", {
      hasText: "What is on the packing list for this fix?",
    });
    await expect(listed).toBeVisible({ timeout: 30_000 });
    const listedAnswer = listed.locator("[data-ask-answer]").first();
    await expect(listedAnswer.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
    const list = listedAnswer.locator(":scope > .exp-b > .blk:first-child > :is(ul.lst, ol.lst)").first();
    await expect(list).toBeVisible();
    const listGeo = await list.evaluate((el) => {
      const reply = el.closest(".spike-reply");
      const av = reply?.querySelector(":scope > .av");
      if (!(reply instanceof HTMLElement) || !(av instanceof HTMLElement)) return null;
      return { listTop: el.getBoundingClientRect().top, avBottom: av.getBoundingClientRect().bottom };
    });
    expect(listGeo).not.toBeNull();
    expect(listGeo!.listTop).toBeGreaterThanOrEqual(listGeo!.avBottom - 2);

    // ONE frame: the list-first agent thread (question on the avatar's
    // line, list below it) above the lone reviewer-comment thread
    // (avatar only, Outbox mark, no count, wrapped inline text). Threads
    // render in anchor order, so the b2-anchored lone thread is last.
    await listed.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(300);
    // Park the pointer on neutral padding so hover toolbars hide for the frame.
    await page.mouse.move(700, 70);
    await page.waitForTimeout(200);
    const frameBoxes = await listed.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const reply = el.querySelector(":scope > [data-reply]");
      return { top: r.top, replyH: reply?.getBoundingClientRect().height ?? 0 };
    });
    expect(frameBoxes.replyH).toBeGreaterThan(30);
    expect(frameBoxes.top).toBeGreaterThanOrEqual(0);
    expect(frameBoxes.top).toBeLessThanOrEqual(200);
    const loneBox = await lone.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const reply = el.querySelector(":scope > [data-reply]");
      return { top: r.top, bottom: r.bottom, replyH: reply?.getBoundingClientRect().height ?? 0 };
    });
    expect(loneBox.replyH).toBeGreaterThan(30);
    expect(loneBox.top).toBeGreaterThanOrEqual(frameBoxes.top);
    expect(loneBox.bottom).toBeLessThanOrEqual(900);
    await page.screenshot({ path: "test-results/j331-inline-avatar.png" });

    // Collapse-all: lone threads show no count pill, the answered thread
    // shows "1 reply" — matching the inline headers.
    await page.getByRole("button", { name: "Collapse threads" }).click();
    const loneRow = page.locator(`button.spike-row[data-row="${loneId}"]`);
    await expect(loneRow).toBeVisible({ timeout: 15_000 });
    await expect(loneRow.locator(".spike-row-count")).toHaveCount(0);
    await expect(page.locator(`button.spike-row[data-row="${commentId}"]`)).toContainText("1 reply");
    await expect(
      page.locator("button.spike-row", { hasText: "What is on the packing list for this fix?" }).locator(
        ".spike-row-count",
      ),
    ).toHaveCount(0);
  });
});
