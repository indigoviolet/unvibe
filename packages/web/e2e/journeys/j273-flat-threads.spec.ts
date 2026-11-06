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

/** Reply chrome geometry (#336): avatar vs first-line centres, and the
 * hover toolbar vs the first text line. The toolbar keeps its wrap space
 * while hidden, so its rect is measurable before hover; hover only
 * changes visibility. An agent reply is prose-first (text on the avatar's
 * line, `inline`) or list-first (content below the avatar, the #331
 * fallback): the first text line is a paragraph/heading or a list item. */
async function replyChrome(reply: Locator): Promise<{
  avCenter: number;
  avBottom: number;
  firstCenter: number;
  firstTop: number;
  inline: boolean;
  lineCount: number;
  secondRight: number | null;
  secondTop: number | null;
  bands: { top: number; left: number; bottom: number; right: number }[];
  replyRight: number;
  ctl: { top: number; left: number; bottom: number; right: number } | null;
  first: { top: number; left: number; bottom: number; right: number };
} | null> {
  return reply.evaluate((el) => {
    const av = el.querySelector(":scope > .av");
    const text =
      el.querySelector(":scope > p") ??
      el.querySelector(
        ":scope > .exp-b .blk:first-child > p.prose, :scope > .exp-b .blk:first-child > h3.subhead",
      ) ??
      el.querySelector(":scope > .exp-b .blk:first-child li");
    if (!(av instanceof HTMLElement) || !(text instanceof HTMLElement)) return null;
    const a = av.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(text);
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return null;
    const box = (r: DOMRect): { top: number; left: number; bottom: number; right: number } => ({
      top: r.top,
      left: r.left,
      bottom: r.bottom,
      right: r.right,
    });
    const ctl = el.querySelector(":scope > .ctl");
    // Range rects fragment at inline elements (code, links, chips), so
    // group them into visual lines by vertical overlap (fragment tops
    // on one line spread several px across mixed fonts) before
    // measuring line spans.
    const bands: DOMRect[][] = [];
    for (const r of rects) {
      const band = bands.find((b) => {
        const top = Math.min(...b.map((x) => x.top));
        const bottom = Math.max(...b.map((x) => x.bottom));
        return r.top <= bottom - 2 && r.bottom >= top + 2;
      });
      if (band) band.push(r);
      else bands.push([r]);
    }
    const merged = bands.map((b) => ({
      top: Math.min(...b.map((r) => r.top)),
      left: Math.min(...b.map((r) => r.left)),
      bottom: Math.max(...b.map((r) => r.bottom)),
      right: Math.max(...b.map((r) => r.right)),
    }));
    const firstLine = merged[0]!;
    return {
      avCenter: (a.top + a.bottom) / 2,
      avBottom: a.bottom,
      firstCenter: (firstLine.top + firstLine.bottom) / 2,
      firstTop: firstLine.top,
      inline: text.tagName !== "LI",
      lineCount: merged.length,
      secondRight: merged.length >= 2 ? merged[1]!.right : null,
      secondTop: merged.length >= 2 ? merged[1]!.top : null,
      bands: merged,
      replyRight: (el as HTMLElement).getBoundingClientRect().right,
      ctl: ctl instanceof HTMLElement ? box(ctl.getBoundingClientRect()) : null,
      first: firstLine,
    };
  });
}

function intersects(
  a: { top: number; left: number; bottom: number; right: number },
  b: { top: number; left: number; bottom: number; right: number },
): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
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

  test("inline avatars and replies-after-first counts (#331, #315 follow-up)", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // A long lone reviewer comment: avatar only, no chips, no mark.
    // Issue #341: "untidy" is gone with the re-record; note on plain text.
    await selectText(page, "#C-problem", "whitespace");
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
    await expect(loneReply.locator(".outbox-mark")).toHaveCount(0);
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

    // Issue #341: no recorded ask answer starts with a list (the old
    // fixture's packing-list answer did), so the list-first scene has no
    // fixture instance — the #331 fallback stays covered by the reply
    // chrome test below, which branches on prose-first vs list-first.

    // Collapse-all: lone threads show no count pill, the answered thread
    // shows "1 reply" — matching the inline headers.
    await page.getByRole("button", { name: "Collapse threads" }).click();
    const loneRow = page.locator(`button.spike-row[data-row="${loneId}"]`);
    await expect(loneRow).toBeVisible({ timeout: 15_000 });
    await expect(loneRow.locator(".spike-row-count")).toHaveCount(0);
    await expect(page.locator(`button.spike-row[data-row="${commentId}"]`)).toContainText("1 reply");
  });

  test("reply chrome: controls never overlap, chips never empty, avatars centred (#336)", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // One thread: a one-line human comment plus an agent answer.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="note"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    const humanText = "Fold handling looks right.";
    await composer.locator("textarea").fill(humanText);
    await composer.getByRole("button", { name: "Save" }).click();
    const thread = page.locator("#C-problem section.ithread[data-thread]", {
      hasText: humanText,
    });
    await expect(thread).toBeVisible({ timeout: 15_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();
    await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(2);
    const human = thread.locator('[data-reply][data-kind="comment"]').first();
    const answer = thread.locator("[data-ask-answer]").first();
    await expect(answer.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });

    // Explain "Fold" inside the thread appends a prose-first explain reply
    // in the same thread (flat): its recording is deterministic, so the
    // agent-avatar-centring assertion always has an inline case.
    await selectText(page, `#C-problem section.ithread[data-thread="${threadId}"]`, "Fold");
    await page.locator('#selbar [data-act="explain"]').click();
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(3);
    const expl = thread.locator('[data-reply][data-kind="explain"]').first();
    await expect(expl.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });

    // No citation chip in the thread renders with empty text.
    const chips = thread.locator(".lk[data-refs]");
    const chipCount = await chips.count();
    for (let i = 0; i < chipCount; i++) {
      expect(((await chips.nth(i).textContent()) ?? "").trim()).not.toBe("");
    }

    // Avatars centre on their own first line's box (agent serif prose and
    // human sans alike), and the hovered toolbar never covers the text. A
    // list-first agent answer keeps the #331 fallback (content below the
    // avatar) instead of a centred first line.
    const checkChrome = async (label: string): Promise<void> => {
      // #336 follow-up: the toolbar float shortens at most the first
      // line. A non-final wrapped line always spans its available width,
      // so when a third line exists the second must reach the reply's
      // right edge — otherwise the float is still pushing line 2.
      const expectFullSecondLine = (
        geo: NonNullable<Awaited<ReturnType<typeof replyChrome>>>,
        what: string,
      ): void => {
        // The float must not reach the second line at all.
        if (geo.lineCount >= 2 && geo.ctl && geo.secondTop !== null) {
          expect(
            geo.ctl.bottom,
            `${label}: ${what} toolbar stays clear of the second line`,
          ).toBeLessThanOrEqual(geo.secondTop + 1);
        }
        // So the second line spans nearly the full width. The slack is
        // word-wrap leftover (a long word left ~80px in dark mode);
        // the defect left a toolbar-wide ~250px gap, which this
        // still catches comfortably.
        if (geo.lineCount >= 3) {
          expect(
            geo.secondRight,
            `${label}: ${what} second line spans full width`,
          ).toBeGreaterThanOrEqual(geo.replyRight - 128);
        }
      };
      const humanGeo = await replyChrome(human);
      expect(humanGeo, `${label}: human chrome measurable`).not.toBeNull();
      expect(humanGeo!.inline, `${label}: human comment flows inline`).toBe(true);
      expect(
        Math.abs(humanGeo!.avCenter - humanGeo!.firstCenter),
        `${label}: human avatar centred`,
      ).toBeLessThanOrEqual(2);
      const ansGeo = await replyChrome(answer);
      expect(ansGeo, `${label}: agent chrome measurable`).not.toBeNull();
      if (ansGeo!.inline) {
        expect(
          Math.abs(ansGeo!.avCenter - ansGeo!.firstCenter),
          `${label}: agent avatar centred`,
        ).toBeLessThanOrEqual(2);
        expectFullSecondLine(ansGeo!, "agent answer");
      } else {
        expect(
          ansGeo!.firstTop,
          `${label}: list-first answer starts below the avatar`,
        ).toBeGreaterThanOrEqual(ansGeo!.avBottom - 2);
      }
      await answer.hover();
      await page.waitForTimeout(400);
      const hovered = await replyChrome(answer);
      expect(hovered?.ctl, `${label}: toolbar present`).not.toBeNull();
      expect(
        intersects(hovered!.ctl!, hovered!.first),
        `${label}: toolbar clear of first line`,
      ).toBe(false);
      // The explain reply is prose-first by its recording: the agent
      // avatar centres on its first line.
      const explGeo = await replyChrome(expl);
      expect(explGeo, `${label}: explain chrome measurable`).not.toBeNull();
      expect(explGeo!.inline, `${label}: explain reply flows inline`).toBe(true);
      expect(
        Math.abs(explGeo!.avCenter - explGeo!.firstCenter),
        `${label}: explain avatar centred`,
      ).toBeLessThanOrEqual(2);
      expectFullSecondLine(explGeo!, "explain reply");
    };

    // Light: thread top in view, prose-first explain reply hovered so the
    // toolbar shows.
    await thread.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));
    await page.waitForTimeout(300);
    await checkChrome("light");
    await expl.locator("p.prose").first().hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/j336-thread-light.png" });

    // End of the reply: citations, if any, all labelled.
    const replyAnswer = thread.locator("[data-ask-answer]").first();
    const replyChips = thread.locator(".lk[data-refs]");
    if ((await replyChips.count()) > 0) {
      await replyChips
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await page.waitForTimeout(300);
    } else {
      await replyAnswer.evaluate((el) => el.scrollIntoView({ block: "end", inline: "nearest" }));
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: "test-results/j336-citations-light.png" });
  });
});
