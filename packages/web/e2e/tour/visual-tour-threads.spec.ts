/**
 * Tour: threads (package D re-adds the frames packages C removed
 * from the gate in #363).
 *
 * On-demand only (`mise run visual-tour`): the thread states the owner
 * reviews as frames — the ask/explain/reply-link/collapsed/expanded
 * thread, the reply chrome (light + citations) and failed states, the
 * six thread-polish states, and the #381 reply footer. Behaviour for
 * all of these lives in `e2e/journeys/l4-threads.spec.ts`; this file
 * keeps just enough asserts to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview, createSeededDemoReview } from "../journeys/journey-helpers.js";
import { tourCombos } from "../tour-matrix.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));
const FRAMES = fileURLToPath(new URL("../../visual-tour/364", import.meta.url));
const FRAMES381 = fileURLToPath(new URL("../../visual-tour/381", import.meta.url));

/**
 * Let a programmatic scroll land: poll until the viewport stops moving
 * instead of sleeping a fixed window (#363 B2).
 */
async function settleScroll(page: Page): Promise<void> {
  let prev = "";
  await expect
    .poll(
      async () => {
        const cur = await page.evaluate(() => `${window.scrollX},${window.scrollY}`);
        const settled = prev !== "" && cur === prev;
        prev = cur;
        return settled;
      },
      { timeout: 10_000 },
    )
    .toBe(true);
}

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});


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
    await page.screenshot({ path: path.join(SHOTS, "j273-thread.png") });

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
    await page.screenshot({ path: path.join(SHOTS, "j273-replylink.png") });

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
    await page.screenshot({ path: path.join(SHOTS, "j273-collapsed.png") });
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0);
    await row.click();
    await expect(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(`#C-problem [data-thread="${threadId}"] [data-reply]`).first()).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "j273-expanded.png") });
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
      // Let the hover toolbar fade in: poll its opacity, never a fixed
      // window (#363 B2 — the frame must catch it fully shown, not fading).
      await expect
        .poll(
          () =>
            answer.evaluate((el) => {
              const c = el.querySelector(":scope > .ctl");
              return c ? getComputedStyle(c as HTMLElement).opacity : "missing";
            }),
          { timeout: 10_000 },
        )
        .toBe("1");
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
    await settleScroll(page);
    await checkChrome("light");
    await expl.locator("p.prose").first().hover();
    // Same fade-in wait as above: the light frame must catch the toolbar
    // fully shown (#363 B2).
    await expect
      .poll(
        () =>
          expl.evaluate((el) => {
            const c = el.querySelector(":scope > .ctl");
            return c ? getComputedStyle(c as HTMLElement).opacity : "missing";
          }),
        { timeout: 10_000 },
      )
      .toBe("1");
    await page.screenshot({ path: path.join(SHOTS, "j336-thread-light.png") });

    // End of the reply: citations, if any, all labelled.
    const replyAnswer = thread.locator("[data-ask-answer]").first();
    const replyChips = thread.locator(".lk[data-refs]");
    if ((await replyChips.count()) > 0) {
      await replyChips
        .first()
        .evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
      await settleScroll(page);
    } else {
      await replyAnswer.evaluate((el) => el.scrollIntoView({ block: "end", inline: "nearest" }));
      await settleScroll(page);
    }
    await page.screenshot({ path: path.join(SHOTS, "j336-citations-light.png") });
  });
});

// ---- j270-ask-retry.spec.ts (frames re-added) ----
test.describe("J270 ask follow-up failure and retry", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j270-data-"));
    // Slow the replay stream so the follow-up is reliably mid-flight at the kill.
    svc = await startService(dataDir, {
      agent: "replay",
      extraEnv: { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" },
    });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("failed follow-up shows Retry; retry lands a clean answer", async ({ page }) => {
    test.setTimeout(420_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Reply 1: Ask.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });

    // Reply 2: follow-up, killed mid-answer.
    const box = card.getByPlaceholder(/Ask a follow-up/);
    await expect(box).toBeVisible({ timeout: 15_000 });
    await box.fill("Does a cookie header change this?");
    await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
    // Issue #293: questions are separate entries — answers are `ask-answer`.
    // Wait for the follow-up pair to exist, then target the answer paired
    // with its question (stable under load).
    await expect(card.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
    const q2 = card.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
    await expect(q2).toBeVisible({ timeout: 30_000 });
    const q2Id = await q2.getAttribute("data-ask-question");
    expect(q2Id).toBeTruthy();
    const second = card.locator(`[data-ask-answer="${q2Id}"]`);
    await expect(second.locator(".working")).toBeVisible({ timeout: 30_000 });
    const deadOrigin = svc.origin;
    svc.killHard();
    // Hard kill mid-stream, then restart on the same data dir. Wait for
    // the dead port, not a fixed delay (#363 B2).
    await expect
      .poll(
        async () => {
          try {
            await fetch(deadOrigin);
            return "up";
          } catch {
            return "down";
          }
        },
        { timeout: 30_000 },
      )
      .toBe("down");
    svc = await startService(dataDir, { agent: "replay" });

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
    const after = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
    await expect(after).toBeVisible({ timeout: 30_000 });
    // The interrupted follow-up shows the failed banner with Retry — and
    // no toolbar or reply box on that turn. Wait for the reply to exist
    // first, then target the answer paired with the follow-up question
    // (stable under load; never an index into a half-rendered list).
    await expect(after.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
    const afterQ = after.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
    await expect(afterQ).toBeVisible({ timeout: 30_000 });
    const afterId = await afterQ.getAttribute("data-ask-question");
    expect(afterId).toBeTruthy();
    const failed = after.locator(`[data-ask-answer="${afterId}"]`);
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
    await page.screenshot({ path: path.join(SHOTS, "j270-failed.png") });
    await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
    await expect(failed.locator(".ctl")).toHaveCount(0);

    // Retry refills the same turn with a clean answer: no raw trailing
    // block, no cut-off start, no internal ids anywhere.
    await failed.getByRole("button", { name: "Retry" }).click();
    // The retried answer lands as blocks with no working marker (#336:
    // the toolbar itself stays hidden until hovered).
    await expect(failed.locator(".exp-b")).not.toBeEmpty({ timeout: 120_000 });
    await expect(failed.locator(".working")).toHaveCount(0, { timeout: 30_000 });
    await expect(after.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
    const retried = after.locator(".exp-b").nth(1);
    await expect(retried).not.toBeEmpty({ timeout: 60_000 });
    await expect(retried).not.toContainText('{"contribute"');
    await expect(retried).not.toContainText("ann_");
    await expect(after).not.toContainText("no failed turn");
    // Any toast (e.g. from the retry) carries plain words, never an id.
    const toast = page.locator("#toast");
    if ((await toast.count()) > 0) {
      await expect(toast).not.toContainText("ann_");
    }
  });
});


// ---- j364-thread-polish.spec.ts (frames re-added) ----
interface Reply364 {
  id: string;
  kind: string;
  question: string | null;
  linkTo?: string;
  blocks: unknown[];
  error?: string | null;
  /** Issue #364: soft-delete tombstone (epoch ms). */
  deletedAt?: number;
}

interface Thread364 {
  id: string;
  type: string;
  anchor: { quotedText?: string; host: { kind: string } };
  open: boolean;
  postedAt?: number;
  replies: Reply364[];
}

async function threads364(svc: RunningService, reviewId: string): Promise<Thread364[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((snap.json as { annotations?: Thread364[] }).annotations ?? []) as Thread364[];
}


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
    // Pin our thread by ID: closing it unmounts its section, after which
    // `.first()` would resolve to another open thread (e.g. a suggestion).
    const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);

    const askBody = mine.locator('[data-reply][data-kind="ask"] .exp-b').first();
    await expect(askBody).not.toBeEmpty({ timeout: 60_000 });
    const word = await askBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
    expect(word).not.toBe("");
    await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="ask"] .exp-b`, word);
    await page.locator('#selbar [data-act="explain"]').click();
    await expect
      .poll(async () => (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(2);


    // Ask inside the thread uses the Reply box chip — no second composer.
    // (Select fresh words in the explain turn: the ask turn's words now
    // carry the in-thread reply link, and selecting a link hides the bar.)
    const explainBody = mine.locator('[data-reply][data-kind="explain"] .exp-b').first();
    await expect(explainBody).not.toBeEmpty({ timeout: 60_000 });
    const word2 = await explainBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
    expect(word2).not.toBe("");
    await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="explain"] .exp-b`, word2);
    await page.locator('#selbar [data-act="ask"]').click();
    await expect(mine.locator('[data-pending-thread]')).toHaveCount(0);
    const chip = mine.locator('[data-quote-chip]');
    await expect(chip).toBeVisible({ timeout: 10_000 });
    // Frame 4: the Reply box with its quote chip.
    await chip.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${FRAMES}/reply-chip.png` });
    await mine.locator('textarea[aria-label="Reply"]').fill("And then?");
    await mine.getByRole("button", { name: "Reply", exact: true }).click();
    await expect
      .poll(async () => (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(3);

    // Frame 1: several turns with bands + spacing — turn 3 at the top,
    // so its tinted band reads right under the previous turn's divider.
    const turn3 = (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)!.replies[2]!.id;
    await page.locator(`[data-turn="${turn3}"]`).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${FRAMES}/turns.png` });

    // The margin icon sits on the highlight's first line; closing the
    // thread leaves the icon, and clicking it reopens the thread.
    const margin = page.locator(`[data-thr-margin~="${threadId}"]`);
    await expect(margin).toBeVisible({ timeout: 15_000 });
    // Frame 2: the margin icon on the highlight.
    await margin.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${FRAMES}/margin-icon.png` });
    await mine.locator('button[aria-label="Close"]').click();
    await expect(mine).toBeHidden({ timeout: 15_000 });
    await expect(margin).toBeVisible({ timeout: 15_000 });
    // Like a human: the icon is seen mid-viewport, never half-hidden
    // under the sticky review bar (a minimal scroll-into-view can park
    // it there, where no click can ever land). Click in page context:
    // the data-tip tooltip is pointer-events:none so it never blocks
    // real input, but it trips Playwright's strict hit-target check and
    // its synthetic mouse sequence never lands (proven by probe: DOM
    // click reopens every time, Playwright click only sometimes).
    await margin.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await margin.evaluate((el) => (el as HTMLElement).click());
    // Diagnose at the snapshot level: did the open flag land?
    await expect
      .poll(async () => (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)?.open ?? false, {
        timeout: 15_000,
      })
      .toBe(true);
    await expect(mine).toBeVisible({ timeout: 15_000 });

    // The reverse link scrolls to the highlight and flashes it. Agent
    // threads carry no inline highlight of their own, so the link falls
    // back to the margin marker's line and flashes that instead.
    const srcLink = mine.locator('[data-src-link]').first();
    await expect(srcLink).toBeVisible();
    await srcLink.click();
    await expect(margin).toHaveClass(/flash/, { timeout: 15_000 });
    // Frame 3: the reverse link target mid-flash. The click's smooth
    // scroll is still animating, so park the margin instantly (cancelling
    // it) and shoot at once — well inside the ~2s flash.
    await margin.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior }));
    await page.screenshot({ path: `${FRAMES}/reverse-flash.png` });

    // Per-reply delete tombstones the turn (an answer goes with its
    // question — one stored turn); later turns stay. No confirm appears.
    const beforeDel = await threads364(svc!, reviewId);
    const explainReply = beforeDel.find((t) => t.id === threadId)!.replies.find((r) => r.kind === "explain")!;
    const turns = mine.locator(':scope > .turn');
    await expect(turns).toHaveCount(3, { timeout: 30_000 });
    const second = turns.nth(1);
    await second.hover();
    await second.getByRole("button", { name: "Delete reply" }).first().click();
    await expect
      .poll(
        async () =>
          (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
            ?.deletedAt ?? 0,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const tomb = mine.locator(`[data-tombstone="${explainReply.id}"]`);
    await expect(tomb).toBeVisible({ timeout: 15_000 });
    await expect(tomb).toContainText(/Reply deleted/);
    // Frame 5: the tombstone holding its turn's place.
    await tomb.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${FRAMES}/tombstone.png` });

    // The tombstone survives a reload; Undelete restores the turn exactly.
    await page.reload();
    await expect(page.locator(`section.ithread[data-thread="${threadId}"]`)).toBeVisible({ timeout: 30_000 });
    const tombAfter = page.locator(`[data-tombstone="${explainReply.id}"]`);
    await expect(tombAfter).toBeVisible({ timeout: 15_000 });
    await tombAfter.getByRole("button", { name: "Undelete" }).click();
    await expect
      .poll(
        async () =>
          (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
            ?.deletedAt,
        { timeout: 30_000 },
      )
      .toBeUndefined();
    await expect(page.locator(`[data-reply="${explainReply.id}"]`)).toBeVisible({ timeout: 15_000 });
    // Frame 6: the thread after a reply was deleted and restored.
    await page.getByText("What is line folding?", { exact: false }).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: `${FRAMES}/after-delete.png` });

    // Deleting every remaining live turn deletes the thread itself.
    // Settle each delete before the next: clicking again while the
    // tombstone patch is still in flight would wait forever on a
    // button that is about to disappear.
    for (let i = 0; i < 4; i++) {
      const snap = (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId);
      if (!snap) break; // thread already gone
      const liveIds = snap.replies.filter((r) => !r.deletedAt).map((r) => r.id);
      if (liveIds.length === 0) break;
      const victim = liveIds[0]!;
      const first = mine.locator(':scope > .turn:not(:has([data-tombstone]))').first();
      await first.hover();
      await first.getByRole("button", { name: "Delete reply" }).first().click();
      // Either its tombstone appears, or (last live turn) the thread goes.
      await expect
        .poll(async () => {
          const t = (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId);
          if (!t) return "gone";
          return t.replies.find((r) => r.id === victim)?.deletedAt ? "tomb" : "live";
        }, { timeout: 30_000 })
        .not.toBe("live");
    }
    await expect
      .poll(async () => (await threads364(svc!, reviewId)).find((t: Thread364) => t.id === threadId), { timeout: 30_000 })
      .toBeUndefined();
    await expect(page.locator(`section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 30_000 });
  });
});

// ---- J374 margin pill (issue #374): one pill per paragraph, inside the
// gutter, in every theme and width. Slim set: 1440-light plus the
// tour-matrix named keeps (dark + 960); the full matrix runs on demand.
test.describe("J374 margin pill", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";
  // Thread ids by seed name (pills show counts, never thread text).
  const ids: Record<string, string> = {};

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j374-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
    // One pill per block: problem#b1's threads (first-line, unquoted,
    // mid-paragraph) share one pill; problem#b2 and buildup's list block
    // each get one single-thread pill. Guide comments start closed; the
    // pills show regardless.
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const pages = (snap.json as { pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[] }).pages ?? [];
    const card = (id: string) => pages.find((p) => p.id === "root")?.cards.find((c) => c.id === id);
    const seeds: { name: string; blockId: string; quote: string; text: string }[] = [
      { name: "first", blockId: `problem#${card("problem")?.blocks[0]?.id}`, quote: "HTTP/1.1 servers", text: "First-line note" },
      { name: "unquoted", blockId: `problem#${card("problem")?.blocks[0]?.id}`, quote: "", text: "Unquoted note" },
      { name: "mid", blockId: `problem#${card("problem")?.blocks[0]?.id}`, quote: "value continues on the next line", text: "Mid-paragraph note" },
      { name: "single", blockId: `problem#${card("problem")?.blocks[1]?.id}`, quote: "built the headers", text: "Second paragraph note" },
      { name: "list", blockId: `buildup#${card("buildup")?.blocks.find((b) => b.id === "b2")?.id}`, quote: "They return early when a value has no CRLF.", text: "List note" },
    ];
    for (const seed of seeds) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId: seed.blockId },
        quote: seed.quote,
        text: seed.text,
      });
      if (made.status !== 201) throw new Error(`seed failed: ${JSON.stringify(made.json)}`);
      ids[seed.name] = (made.json as { id: string }).id;
    }
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  for (const combo of tourCombos("threads", [
    { name: "1440-light", width: 1440, dark: false },
    { name: "1440-dark", width: 1440, dark: true },
    { name: "960-light", width: 960, dark: false },
  ] as const)) {
    test(`margin pill, pair, collapsed and list (${combo.name})`, async ({ page }) => {
      test.setTimeout(240_000);
      if (!svc) throw new Error("no service");
      await page.setViewportSize({ width: combo.width, height: 900 });
      if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
      const suffix = combo.name;
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("#C-buildup")).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready).catch(() => {});

      // Issue #374: one pill per block — the b1 threads (first-line,
      // unquoted, mid-paragraph) share one pill naming the block's full
      // count. The pill sits inside the card gutter, glyph and count
      // side by side.
      const pair = page.locator(`#C-problem [data-thr-margin~="${ids.first}"]`);
      await expect(pair).toBeVisible({ timeout: 15_000 });
      await expect(pair).toHaveAttribute("data-thr-margin", new RegExp(`${ids.mid}`));
      const pairCount = await pair.evaluate((el) => (el.getAttribute("data-thr-margin") ?? "").split(/\s+/).filter(Boolean).length);
      expect(pairCount).toBeGreaterThanOrEqual(3);
      await expect(pair).toHaveAttribute("data-tip", `${pairCount} threads`);
      await pair.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await settleScroll(page);
      const geom = await pair.evaluate((el) => {
        const box = (r: DOMRect) => ({ top: r.top, left: r.left, bottom: r.bottom, right: r.right });
        const card = el.closest("section.ui-card");
        const pill = box(el.getBoundingClientRect());
        return {
          pill,
          card: card instanceof Element ? box(card.getBoundingClientRect()) : null,
        };
      });
      expect(geom.card).not.toBeNull();
      if (geom.card) {
        expect(geom.pill.left).toBeGreaterThanOrEqual(geom.card.left);
        expect(geom.pill.right).toBeLessThanOrEqual(geom.card.right);
      }
      await page.screenshot({ path: `${FRAMES}/margin-pill-${suffix}.png` });

      if (!combo.dark && combo.width === 1440) {
        // Single-thread pill on the second paragraph.
        const single = page.locator(`#C-problem [data-thr-margin~="${ids.single}"]`);
        await expect(single).toBeVisible({ timeout: 15_000 });
        await expect(single).toHaveAttribute("data-tip", "1 thread");
        await single.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await settleScroll(page);
        await page.screenshot({ path: `${FRAMES}/margin-single-${suffix}.png` });

        // A collapsed card shows exactly one pill carrying the card's
        // total thread count (per-block pills would stack on one line).
        const expandedTotal = await page.evaluate(() => {
          const pills = document.querySelectorAll("#C-problem [data-thr-margin]");
          return [...pills].reduce(
            (sum, el) => sum + (el.getAttribute("data-thr-margin") ?? "").split(/\s+/).filter(Boolean).length,
            0,
          );
        });
        expect(expandedTotal).toBeGreaterThan(1);
        await page.locator("#C-problem > .chead").getByRole("button", { name: "Collapse" }).click();
        await expect(page.locator("#C-problem")).toHaveClass(/collapsed/, { timeout: 10_000 });
        const collapsedPills = page.locator("#C-problem [data-thr-margin]");
        await expect(collapsedPills).toHaveCount(1, { timeout: 15_000 });
        await expect(collapsedPills.first()).toHaveAttribute("data-tip", `${expandedTotal} threads`);
        await expect(collapsedPills.first()).toContainText(String(expandedTotal));
        await collapsedPills.first().evaluate((el) => el.scrollIntoView({ block: "center" }));
        await settleScroll(page);
        await page.screenshot({ path: `${FRAMES}/margin-collapsed-${suffix}.png` });
        await page.locator("#C-problem > .chead").getByRole("button", { name: "Expand" }).click();
        await expect(page.locator("#C-problem")).not.toHaveClass(/collapsed/, { timeout: 10_000 });

        // List blocks get the same gutter treatment.
        const list = page.locator(`#C-buildup [data-thr-margin~="${ids.list}"]`);
        await expect(list).toBeVisible({ timeout: 15_000 });
        await list.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await settleScroll(page);
        await page.screenshot({ path: `${FRAMES}/margin-list-${suffix}.png` });
      }
    });
  }
});

// ---- #381 reply footer (chips with inline code, no label, icon reverse link) ----
test.describe("381 reply footer", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  const reviewId = "tour-381";

  test.beforeAll(async () => {
    mkdirSync(FRAMES381, { recursive: true });
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-tour381-data-"));
    // Static seeded review: no jobs, so the footer never mutates mid-frame.
    createSeededDemoReview(dataDir, reviewId);
    // Scene-local tweak (the shared fixture is untouched): lengthen the
    // seeded backticked suggestion so it wraps onto two lines at 1440 —
    // the original complaint was how wrapped chips looked.
    const db = new DatabaseSync(path.join(dataDir, "unvibe.db"));
    try {
      const row = db
        .prepare("SELECT snapshot FROM review_snapshots WHERE review_id = ?")
        .get(reviewId) as { snapshot: string };
      const snap = JSON.parse(row.snapshot) as {
        annotations: { replies: { blocks: { type: string; items?: { label: string }[] }[] }[] }[];
      };
      const fu = snap.annotations[0]!.replies[0]!.blocks.find((b) => b.type === "follow-up")!;
      fu.items![0]!.label =
        "Does `http.client` keep the line ending when a folded line ends in a bare `\\n`, " +
        "and would `_normalize_header_value` leave that value untouched?";
      db.prepare("UPDATE review_snapshots SET snapshot = ?, updated_at = ? WHERE review_id = ?").run(
        JSON.stringify(snap),
        Date.now(),
        reviewId,
      );
    } finally {
      db.close();
    }
    svc = await startService(dataDir, { agent: "none", label: "tour381" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("reply footer with code chips, no label, icon button (1440-light)", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.setViewportSize({ width: 1440, height: 900 });
    // The seeded explain answer's follow-up block: one long (wrapping)
    // backticked suggestion and one short one (real-service fixture
    // content, not a mock).
    const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const anns = (
      snap.json as {
        annotations?: {
          id: string;
          replies?: { blocks?: { type: string; items?: { label: string }[] }[] }[];
        }[];
      }
    ).annotations ?? [];
    const seeded = anns.find((a) =>
      (a.replies ?? []).some((r) =>
        (r.blocks ?? []).some(
          (b) => b.type === "follow-up" && (b.items ?? []).some((i) => i.label.includes("`")),
        ),
      ),
    );
    if (!seeded) throw new Error("no seeded reply with a backticked follow-up");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});

    const mine = page.locator(`section.ithread[data-thread="${seeded.id}"]`);
    await expect(mine).toBeVisible({ timeout: 30_000 });
    const footer = mine.locator(".follow").first();
    await expect(footer).toBeVisible({ timeout: 15_000 });
    const chips = footer.locator("button");
    await expect(chips).toHaveCount(2);
    const long = chips.filter({ hasText: "keep the line ending" });
    await expect(long.locator("code").first()).toContainText("http.client");
    // The long suggestion wraps onto two lines at 1440 (one line ≈ 27px).
    expect.soft((await long.boundingBox())?.height ?? 0, "long chip wraps").toBeGreaterThan(32);
    await expect(footer).not.toContainText("Follow up:");
    const rev = mine.getByRole("button", { name: "Show the quoted passage" }).first();
    await expect(rev).toBeVisible();
    await footer.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
    await settleScroll(page);
    await page.screenshot({ path: path.join(FRAMES381, "reply-footer-1440-light.png") });
  });
});
