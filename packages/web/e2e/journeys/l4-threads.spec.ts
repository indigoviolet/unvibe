/**
 * L4 — Threads: Explain and Ask (#363 package C).
 *
 * The thread area in usage order: explain/ask/follow-up/nested-explain/
 * depth on guide cards, Ask + comment sharing one diff line, diff threads
 * pinned inline with the Reply-box quote chip, streamed-patch answers
 * with citations, the writing state, page/conversation depth principles,
 * flat threads (ask/explain-inside/Reply/link/collapse-all, avatars,
 * reply counts, reply chrome), multi-turn threads across restart and
 * access-mode change, suggested questions/comments, thread polish
 * (per-reply delete tombstone + Undelete, margin icon, reverse link,
 * turn bands, one composer), and the no-agent state.
 *
 * Boots: ONE fast replay service for every demo-backed step (seeded
 * reviews for scroll-free flows, fresh demo reviews per thread-mutating
 * test so journeys never share mutable state); ONE slow replay service
 * for the writing/recovery steps (pending, retry, closed, draft-kept);
 * ONE agent:none service for the no-agent state. Restarts in the
 * recovery steps reuse the slow service's data dir.
 *
 * Absorbs: `j2-explain-ask` (all 9 tests), `j214-explain-in-comment`
 * (both), `j270-ask-retry`, `j271-ask-pending` (both), `j272-ask-closed`,
 * `j15-multi-turn` (both), `j273-flat-threads` (all 3), `j10-suggested`,
 * `j364-thread-polish`, the ask-inside-appends test left in
 * `diff-pinned.spec.ts` (as a diff-pane chip step on the real service),
 * and the tour's ask-trio behaviour (writing state #203, retry #270,
 * pending #271, ask-thread #293 — behaviour without frames).
 *
 * Guards kept: #204 (pinned threads open inline, never overlaying, no
 * pin control, persisted pinned); #293 (question as reviewer entry,
 * answer directly under it, no muted heading, no gap); #315 (no kind
 * chips — avatar only — with accessible names); #331 (avatar centres on
 * the first line, later lines wrap back); #336 (reply toolbar reveals on
 * hover only, never overlaps text, second line spans full width);
 * #364 (per-reply "Delete reply" vs thread "Delete thread", tombstone +
 * Undelete, margin icon, reverse link, turn bands, one composer with a
 * removable quote chip); #270/#271/#272 (failed follow-up banner +
 * Retry, pending box keeps its draft, closed mid-answer records the
 * failure); #147 (app-initiated scroll keeps the toolbar, a later scroll
 * hides it); #203 (while writing: no toolbar, no reply box); #46 (no
 * streamed agent text — fixed label only); #301 (Hunk-toolbar Summarize
 * cycle lives in the L5 polish test).
 *
 * Brittleness fixed here (#363 §4): the `j2:282/285` 150/600 ms toolbar
 * grace sleeps (B2 — a scroll then a `toBeHidden` poll, no fixed
 * window); the `j2:670` 2 s Generate-loop sleep (B2 — poll the pending
 * count down instead); the `j273:516-554` 300/400 ms hover/scroll
 * settles (B2 — hover then assert the toolbar visible before the atomic
 * read; drops the screenshot-positioning scrolls); the
 * `j270:64`/`j271:136`/`j272:78` 500 ms post-kill sleeps (B2 — dropped:
 * `startService` resolves on listening, the goto + visible asserts are
 * the gate); the `j3:142` 1 s post-submit sleep lives in L5.
 *
 * Frames removed (tour owns them; package D re-adds): j273's
 * thread/collapsed/expanded/replylink shots, j336's thread-light and
 * citations shots, j270's failed shot, j364's six /tmp frames
 * (reply-chip, turns, margin-icon, reverse-flash, tombstone,
 * after-delete), and the tour's writing/ask-retry/ask-pending/ask-thread
 * scenes. No `shot()`/`screenshot` lines remain in the gate.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import { apiJson, createDemoReview, createSeededDemoReview } from "./journey-helpers.js";

test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});
test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

/** Slow replay: answers fill over chunks so pending/writing states are observable. */
const SLOW_ENV = { UNVIBE_REPLAY_DELAY_MS: "50", UNVIBE_REPLAY_CHUNK_CHARS: "20" };

/**
 * Click a reply-toolbar button (#336: the toolbar reveals on hover or
 * keyboard focus, and is visibility:hidden otherwise — invisible to both
 * the accessibility tree and focus(). Hover first so the button resolves
 * and takes focus, then focus so the reveal survives the click's
 * scroll-into-view, then click with full actionability checks on).
 * Card toolbars (.chead .ctl) need none of this — they are opacity-only.
 */
async function clickReplyControl(reply: Locator, label: string): Promise<void> {
  const btn = reply.locator(`.ctl button[aria-label="${label}"]`);
  await reply.hover();
  await btn.evaluate((el) => (el as HTMLElement).focus());
  await btn.click();
}

async function waitForNewThread(
  svc: RunningService,
  reviewId: string,
  before: string[],
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
    const fresh = ids.find((id) => !before.includes(id));
    if (fresh) return fresh;
    if (Date.now() > deadline) throw new Error("new thread did not appear");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function threadIds(svc: RunningService, reviewId: string): Promise<string[]> {
  const res = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
}

/** First text line vs the floated avatar (#331): top alignment, first-line
 * indent past the avatar, and wrap-back of the paragraph box to the thread
 * padding (later lines start left of the avatar's right edge). The box edge
 * — not the last line's rect, which inline markers can shift — proves the
 * wrap-back. One synchronous evaluate (atomic, #363 B1). */
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
 * fallback). One synchronous evaluate (atomic, #363 B1). */
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
  /** Issue #364: soft-delete tombstone (epoch ms). */
  deletedAt?: number;
}

interface Thread {
  id: string;
  type: string;
  anchor: { quotedText?: string; host: { kind: string } };
  open: boolean;
  pinned?: boolean;
  post?: boolean;
  replies: Reply[];
}

async function threads(svc: RunningService, reviewId: string): Promise<Thread[]> {
  const snap = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
  return ((snap.json as { annotations?: Thread[] }).annotations ?? []) as Thread[];
}

// ---------------------------------------------------------------------------
// Fast replay service: every demo-backed step below.
// ---------------------------------------------------------------------------

test.describe("L4 threads on the demo (fast replay)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l4-data-"));
    createSeededDemoReview(dataDir, "l4-explain");
    createSeededDemoReview(dataDir, "l4-diff");
    createSeededDemoReview(dataDir, "l4-depth-page");
    createSeededDemoReview(dataDir, "l4-depth-conv");
    createSeededDemoReview(dataDir, "l4-nesting");
    svc = await startService(dataDir, { agent: "replay", label: "l4demo" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!svc) throw new Error("no service");
    return svc;
  }

  async function openReview(page: Page, reviewId: string): Promise<void> {
    const s = service();
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
  }

  /** Ask on guide text; returns the thread locator and id. */
  async function askOnGuide(page: Page, host: string, quote: string, question: string): Promise<{ thread: Locator; threadId: string }> {
    const s = service();
    const reviewId = page.url().split("/review/")[1]!.split(/[/?#]/)[0]!;
    await selectText(page, host, quote);
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator(`${host} .ithread[data-pending-thread]`);
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill(question);
    const before = await threadIds(s, reviewId);
    await composer.getByRole("button", { name: "Ask" }).click();
    const threadId = await waitForNewThread(s, reviewId, before);
    const thread = page.locator(`${host} section.ithread[data-thread="${threadId}"]`).first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    return { thread, threadId };
  }

  test("explain, ask, follow-up and nested explain stay flat; depth rewrites", async ({ page, context }) => {
    test.setTimeout(300_000);
    const s = service();
    // Our explain thread's id, captured at creation (the replay pipeline
    // can append suggestion threads between steps, so "last" is not ours).
    let explainId = "";
    await openReview(page, "l4-explain");

    await test.step("a partial selection snaps to whole words", async () => {
      // Moved from comments.spec.ts (#258): a partial selection snaps to
      // whole words (the toolbar quotes "optional", not "ptional").
      const snapped = await selectText(page, "#C-central", "ptional", 0, 7);
      expect.soft(snapped).toBe("optional");
      await page.keyboard.press("Escape");
    });

    await test.step("Explain opens a thread that streams exactly one working indicator", async () => {
      // ("optional whitespace" is card-only, so a fresh thread opens.)
      const before = await threadIds(s, "l4-explain");
      await selectText(page, "#C-central", "optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      const expId = await waitForNewThread(s, "l4-explain", before);
      explainId = expId;
      const exp = page.locator(`#C-central section.ithread[data-thread="${expId}"]`).first();
      await expect.soft(exp).toBeVisible({ timeout: 15_000 });
      await expect.soft(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
      await expect.soft(exp.locator(".working")).toHaveCount(0, { timeout: 30_000 });
    });

    await test.step("copy on the answer copies it as Markdown (#377)", async () => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
      const exp = page.locator(`#C-central section.ithread[data-thread="${explainId}"]`).first();
      await exp.hover();
      await exp.locator("[data-copy-reply]").first().click();
      await expect.soft(page.locator("#toast")).toContainText("Copied as Markdown", { timeout: 10_000 });
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
      expect.soft(clip.startsWith("## ")).toBe(true);
      expect.soft(clip).toMatch(/fold|helper|space/i);
      expect.soft(clip).not.toContain("[[");
    });

    await test.step("in-thread Explain appends a reply in the same thread, with a source link", async () => {
      const threadId = explainId;
      const exp = page.locator(`#C-central section.ithread[data-thread="${threadId}"]`).first();
      const word = await exp.locator(".exp-b").first().evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "");
      expect(word).not.toBe("");
      await selectText(page, `#C-central section.ithread[data-thread="${threadId}"] .exp-b`, word);
      await page.locator('#selbar [data-act="explain"]').click();
      // Same thread gains a second agent reply (flat, never nested boxes).
      await expect
        .soft.poll(async () => exp.locator('[data-reply][data-kind="explain"], [data-reply][data-kind="ask"]').count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(2);
      await expect.soft(exp.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 60_000 });
      // The source reply hyperlinks to the new reply.
      await expect.soft(exp.locator('button.rlink[data-replylink]').first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(`#C-central section.ithread[data-thread="${threadId}"]`)).toHaveCount(1);
    });

    await test.step("depth rewrites the parent answer", async () => {
      const threadId = explainId;
      const exp = page.locator(`#C-central section.ithread[data-thread="${threadId}"]`).first();
      const beforeDepth = await exp.locator(".exp-b").first().innerText();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect.soft.poll(async () => exp.locator(".exp-b").first().innerText(), { timeout: 60_000 }).not.toBe(beforeDepth);
    });

    await test.step("Ask opens a pinned thread; the question is a reviewer entry", async () => {
      const { thread: card, threadId: cardId } = await askOnGuide(page, "#C-problem", "folded", "What is line folding?");
      await expect.soft(card.locator('[data-reply][data-kind="ask"] .exp-b').first()).not.toBeEmpty({ timeout: 60_000 });
      // Issue #293: the question shows as a reviewer entry, not a muted heading.
      await expect.soft(card.locator("[data-ask-question]").first()).toContainText("What is line folding?", { timeout: 30_000 });
      await expect.soft(card.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
      // #204: the Ask card opened pinned inline — no floating class, no
      // pin/unpin control — and its persisted state says pinned.
      await expect.soft(card).not.toHaveClass(/floating/);
      await expect.soft(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
      const snapRes = await apiJson(s, "GET", "/api/reviews/l4-explain");
      const anns = (snapRes.json as { annotations?: { id: string; pinned?: boolean }[] }).annotations ?? [];
      expect.soft(anns.find((a) => a.id === cardId)?.pinned).toBe(true);
    });

    await test.step("a follow-up appends in the same card via the Reply box", async () => {
      const card = page.locator('#C-problem section.ithread[data-thread]:has([data-kind="ask"])', { hasText: "What is line folding?" });
      const replyBox = card.locator("textarea").first();
      await expect.soft(replyBox).toBeVisible({ timeout: 15_000 });
      await replyBox.fill("Should a bare LF not followed by whitespace also be normalized, or is leaving it correct?");
      // Issue #364: per-reply Delete buttons also match /reply/i — the
      // send is the Reply box's own button, matched exactly.
      const send = card.getByRole("button", { name: "Reply", exact: true });
      await send.click();
      await expect.soft(card.locator(".exp-b").last()).not.toBeEmpty({ timeout: 60_000 });
      // Issue #369: stripped citations must not leave empty brackets behind.
      await expect.soft(card.locator(".exp-b").last()).not.toContainText(/\(\s*[,;]?\s*\)/);
    });

    await test.step("close collapses to a mark; the mark previews and reopens; delete removes both", async () => {
      const card = page.locator('#C-problem section.ithread[data-thread]:has([data-kind="ask"])', { hasText: "What is line folding?" });
      const snap = await threads(s, "l4-explain");
      const cardId = snap.find((t) => t.replies.some((r) => r.kind === "ask"))?.id;
      expect(cardId).toBeTruthy();
      await card.getByRole("button", { name: "Close" }).click();
      await expect.soft(card).toHaveCount(0, { timeout: 15_000 });
      const mark = page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      await mark.hover();
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
      await expect.soft(page.locator("#pop")).toContainText(/fold/i);
      await page.locator(`#pop [data-open-expansion="${cardId}"]`).click();
      await expect.soft(card).toBeVisible({ timeout: 15_000 });
      await expect.soft(card).not.toHaveClass(/floating/);
      // Delete removes both the card and its mark, across a reload.
      await card.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(card).toHaveCount(0, { timeout: 15_000 });
      await expect.soft(mark).toHaveCount(0, { timeout: 15_000 });
      await page.reload();
      await expect.soft(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`)).toHaveCount(0);
    });
  });

  test("an Ask thread and a comment share one diff line", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // Plain first paint (?nohl=1) keeps code text in whole nodes so the
    // single-range selection helper works on diff code.
    await page.goto(`${s.origin}/review/l4-explain?nohl=1&token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const snap = (await apiJson(s, "GET", "/api/reviews/l4-explain")).json as { files: { fileKey: string; path: string }[] };
    const conn = (snap.files ?? []).find((f) => f.path.includes("conn")) ?? (snap.files ?? [])[0];
    const file = `[id="F-${conn.fileKey}"]`;
    await expect(page.locator(`${file} table.diff`).first()).toBeVisible({ timeout: 15_000 });

    await test.step("Ask on the line opens a thread", async () => {
      await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator(`${file} .ithread[data-pending-thread]`);
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("Why here?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator(`${file} section.ithread[data-thread]`, { hasText: "Why here?" });
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator(".exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
    });

    await test.step("a Comment on the same selection renders beside it", async () => {
      await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
      await page.locator('#selbar [data-act="note"]').click();
      const noteComposer = page.locator(`${file} .ithread[data-pending-thread]`);
      await expect.soft(noteComposer).toBeVisible({ timeout: 10_000 });
      await noteComposer.locator("textarea").fill("A note here.");
      await noteComposer.getByRole("button", { name: "Save" }).click();
      const note = page.locator(`${file} .ithread[data-thread]`, { hasText: "A note here." });
      await expect.soft(note).toBeVisible({ timeout: 30_000 });
      const thread = page.locator(`${file} section.ithread[data-thread]`, { hasText: "Why here?" });
      await expect.soft(thread).toBeVisible();
      await expect.soft(thread.locator('[data-reply][data-kind="ask"]')).toHaveCount(1);
      await expect.soft(note.locator('[data-reply][data-kind="comment"]')).toHaveCount(1);
    });
  });

  test("app-initiated scroll keeps the toolbar; a later scroll hides it (#147)", async ({ page }) => {
    test.setTimeout(120_000);
    await openReview(page, "l4-explain");
    await selectText(page, "#C-central", "optional whitespace");
    const bar = page.locator("#selbar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    await test.step("an app-initiated scroll right after selection keeps the bar", async () => {
      await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
      await expect.soft(bar).toBeVisible();
    });
    await test.step("past the grace window a scroll hides it", async () => {
      // No fixed sleep (#363 B2): keep scrolling until the bar hides —
      // the first scrolls land inside the grace window and keep it, the
      // scroll after the grace expires hides it.
      await expect
        .soft.poll(
          async () => {
            await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
            return await bar.isHidden();
          },
          { timeout: 10_000 },
        )
        .toBe(true);
    });
  });

  test("ask answers cite through the streamed patch path, never streamed text", async ({ page }) => {
    test.setTimeout(300_000);
    await openReview(page, "l4-explain");
    await page.evaluate(() => {
      (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen = {
        working: false,
        stream: false,
      };
      const root = document.querySelector("#C-central");
      if (!root) return;
      new MutationObserver(() => {
        const seen = (window as unknown as { __m4seen: { working: boolean; stream: boolean } }).__m4seen;
        if (root.querySelector('section.ithread[data-thread] .working')) seen.working = true;
        // "stream" is the raw streamed-text dump (never rendered; answers
        // arrive via patches). Provisional completed paragraphs use
        // `.streaming`/`.stream-live` and do not count here.
        if (root.querySelector('section.ithread[data-thread] .stream')) seen.stream = true;
      }).observe(root, { childList: true, subtree: true, characterData: true });
    });
    const { thread: card } = await askOnGuide(
      page,
      "#C-central",
      "original message",
      "Should a bare LF not followed by whitespace also be normalized, or is leaving it correct?",
    );
    await test.step("the answer arrives as blocks with citation markers", async () => {
      await expect.soft(card.locator("[data-ask-question]").first()).toContainText("Should a bare LF not followed by whitespace", {
        timeout: 30_000,
      });
      await expect.soft(card.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
      const marker = card.locator(".lk[data-refs]");
      await expect.soft(marker.first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(marker.first()).toHaveAttribute("data-refs", /diff:/);
      await expect.soft(card.locator(".working")).toHaveCount(0);
    });
    await test.step("a working indicator showed, raw streamed text never did", async () => {
      const seen = await page.evaluate(
        () => (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen,
      );
      expect.soft(seen?.working).toBe(true);
      expect.soft(seen?.stream).toBe(false);
    });
  });

  test("page card: + at deepest adds one principle; + again tells; undo removes", async ({ page }) => {
    test.setTimeout(300_000);
    // Fresh seeded review: other tests in this file leave cards behind
    // whose own Deeper buttons would capture the unscoped clicks.
    await openReview(page, "l4-depth-page");
    const card = page.locator("#C-central");

    function principleLocator(scope: Locator) {
      return scope.locator(".blk.gen-aside", { hasText: "Underlying principle" });
    }
    await test.step("step to deep without the principle, then + adds exactly one", async () => {
      for (let i = 0; i < 3; i++) {
        if ((await principleLocator(card).count()) > 0) break;
        const pipsBefore = await card.locator(".pips i.on").count();
        await card.getByRole("button", { name: "Deeper" }).click();
        await expect
          .soft.poll(
            async () => ((await principleLocator(card).count()) > 0 ? -1 : await card.locator(".pips i.on").count()),
            { timeout: 60_000 },
          )
          .not.toBe(pipsBefore);
        if ((await principleLocator(card).count()) > 0) {
          await card.getByRole("button", { name: "Undo" }).click();
          await expect.soft(principleLocator(card)).toHaveCount(0, { timeout: 30_000 });
          break;
        }
        if (i >= 1) break;
      }
      await expect.soft(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });
      await card.getByRole("button", { name: "Deeper" }).click();
      await expect.soft(principleLocator(card)).toHaveCount(1, { timeout: 60_000 });
      await expect.soft(principleLocator(card).first()).toContainText("Underlying principle");
    });

    await test.step("+ again adds nothing and says so; undo removes it", async () => {
      await card.getByRole("button", { name: "Deeper" }).click();
      await expect.soft(principleLocator(card)).toHaveCount(1, { timeout: 10_000 });
      await expect.soft(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });
      await card.getByRole("button", { name: "Undo" }).click();
      await expect.soft(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });
    });
  });

  test("conversation card: same principle flow", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    await openReview(page, "l4-depth-conv");

    const snap = await apiJson(s, "GET", "/api/reviews/l4-depth-conv");
    const central = ((snap.json as { pages: { id: string; cards: { id: string; blocks: { id: string; type: string; text?: { standard: string } }[] }[] }[] }).pages ?? [])
      .find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const paras = (central?.blocks ?? []).filter((b) => b.type === "paragraph" && b.text?.standard);
    const host = paras.find((b) => b.text!.standard.includes("agree")) ?? paras[0];
    if (!host?.text) throw new Error("central has no paragraph blocks");
    const quote = host.text.standard.includes("agree")
      ? "so the message and urllib3's HTTPHeaderDict agree"
      : host.text.standard.slice(0, 12);
    const created = await apiJson(s, "POST", "/api/reviews/l4-depth-conv/actions", {
      kind: "explain",
      quote,
      anchor: { where: "block", blockId: `central#${host.id}` },
    });
    const annId = (created.json as { annotationId: string; jobId?: string }).annotationId;
    if ((created.json as { jobId?: string }).jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = await apiJson(s, "GET", "/api/reviews/l4-depth-conv");
        const ann = ((cur.json as { annotations: { id: string; replies?: { blocks: unknown[] }[] }[] }).annotations ?? []).find(
          (a) => a.id === annId,
        );
        if ((ann?.replies?.[0]?.blocks.length ?? 0) > 0) break;
        if (Date.now() > deadline) throw new Error("conversation did not fill in time");
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    await page.reload();
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const exp = page.locator(`#C-central [data-thread="${annId}"]`).first();
    await expect(exp).toBeVisible({ timeout: 30_000 });

    function principleLocator(scope: Locator) {
      return scope.locator(".blk.gen-aside", { hasText: "Underlying principle" });
    }
    await test.step("step to deep, then + / + / undo on the conversation reply", async () => {
      for (let i = 0; i < 2; i++) {
        const expPipsBefore = await exp.locator(".pips i.on").count();
        await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
        await expect
          .soft.poll(
            async () => ((await principleLocator(exp).count()) > 0 ? -1 : await exp.locator(".pips i.on").count()),
            { timeout: 60_000 },
          )
          .not.toBe(expPipsBefore);
        if ((await principleLocator(exp).count()) > 0) {
          await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
          await expect.soft(principleLocator(exp)).toHaveCount(0, { timeout: 30_000 });
          break;
        }
      }
      await expect.soft(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect.soft(principleLocator(exp)).toHaveCount(1, { timeout: 60_000 });
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect.soft(principleLocator(exp)).toHaveCount(1, { timeout: 10_000 });
      await expect.soft(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });
      await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
      await expect.soft(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });
    });
  });

  test("in-thread explanation survives reload with its highlight", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    let nestingId = "";
    await openReview(page, "l4-nesting");
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    await test.step("Explain on card-unique text, then Explain inside its reply", async () => {
      const before = await threadIds(s, "l4-nesting");
      await selectText(page, "#C-central", "optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      const parentId = await waitForNewThread(s, "l4-nesting", before);
      nestingId = parentId;
      const parent = page.locator(`#C-central section.ithread[data-thread="${parentId}"]`).first();
      await expect.soft(parent).toBeVisible({ timeout: 15_000 });
      await expect.soft(parent.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
      const word = await parent.locator(".exp-b").first().evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "");
      expect(word).not.toBe("");
      await selectText(page, `#C-central section.ithread[data-thread="${parentId}"] .exp-b`, word);
      // …and Explain appends a reply in the same thread (flat, never nested).
      await page.locator('#selbar [data-act="explain"]').click();
      await expect
        .soft.poll(async () => parent.locator('[data-reply][data-kind="explain"]').count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(2);
      await expect.soft(parent.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 60_000 });
    });

    await test.step("reload keeps both replies and the highlight, with no page errors", async () => {
      const parentId = nestingId;
      await page.reload();
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const parentAfter = page.locator(`#C-central section.ithread[data-thread="${parentId}"]`).first();
      await expect.soft(parentAfter).toBeVisible({ timeout: 15_000 });
      await expect.soft(parentAfter.locator('[data-reply][data-kind="explain"]')).toHaveCount(2, { timeout: 30_000 });
      await expect.soft(parentAfter.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 30_000 });
      await expect.soft(page.locator(`#C-central mark.anc.ex[data-jump="${parentId}"]`).first()).toBeVisible({ timeout: 10_000 });
      expect.soft(errors).toEqual([]);
    });
  });

  test("reader journey: depth, examples, undo, open as page, ask, go-deeper, contents", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // Replay (#257): asserts the pipeline's auto-written go-deeper cards
    // (collapsed until opened) and a pending Generate, which only the
    // live pipeline produces.
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
      timeout: 30_000,
    });
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("Explain, Deeper, Simpler, examples, undo", async () => {
      await selectText(page, "#C-central", "matches optional whitespace, then CRLF");
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator("#C-central section.ithread[data-thread]").first();
      await expect.soft(exp).toBeVisible({ timeout: 15_000 });
      await expect.soft(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
      const expBody = exp.locator(".exp-b");
      const explained = await expBody.innerText();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect.soft.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(explained);
      await expect.soft(exp.locator(".working")).toHaveCount(0, { timeout: 60_000 });
      await expect.soft(expBody).not.toBeEmpty({ timeout: 10_000 });
      const deepened = await expBody.innerText();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Simpler");
      await expect.soft.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(deepened);
      await expect.soft(expBody).not.toBeEmpty();
      // Use examples on the guide card (the thread answers carry no Example
      // asides in this recording), then Undo removes the inserted aside.
      // .first(): the card's own controls precede the nested thread's.
      const centralCard = page.locator("#C-central");
      await centralCard.getByRole("button", { name: "Use examples" }).first().click();
      const guideAside = centralCard.locator(".gen-aside").first();
      await expect.soft(guideAside).toBeVisible({ timeout: 60_000 });
      await expect.soft(guideAside).toContainText(/mixed SP\/HTAB|one fold/i, { timeout: 10_000 });
      await centralCard.getByRole("button", { name: "Undo" }).first().click();
      await expect.soft(centralCard.locator(".gen-aside")).toHaveCount(0, { timeout: 10_000 });
      // Undo reverts the Simpler step: the deeper text returns.
      await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
      await expect.soft.poll(async () => expBody.innerText(), { timeout: 30_000 }).toBe(deepened);
    });

    await test.step("close, preview, reopen, open as page, back", async () => {
      const exp = page.locator("#C-central section.ithread[data-thread]").first();
      await exp.getByRole("button", { name: "Close" }).click();
      await expect.soft(page.locator("#C-central section.ithread[data-thread]").first()).toHaveCount(0, { timeout: 10_000 });
      const mark = page.locator("#C-central mark.anc.exl").first();
      await expect.soft(mark).toBeVisible({ timeout: 10_000 });
      await mark.hover();
      await expect.soft(page.locator("#pop")).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await mark.click();
      await expect.soft(page.locator("#C-central section.ithread[data-thread]").first()).toBeVisible({ timeout: 10_000 });
      await page.locator("#C-central section.ithread[data-thread]").first().getByRole("button", { name: "Open as page" }).click();
      await expect.soft(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
      await expect.soft(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
      await page.goBack();
      await expect.soft(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });
    });

    await test.step("Ask with citations; the citation reveals the diff", async () => {
      await selectText(page, "#C-problem", "re-emit raw CRLF");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("Which downstream consumer re-emits the raw CRLF, and how does the fix stop it?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator('#C-problem section.ithread[data-thread]:has([data-kind="ask"])', { hasText: "Which downstream consumer re-emits" });
      await expect.soft(card.first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const marker = card.locator('.lk[data-refs*="diff:"]');
      await expect.soft(marker.first()).toBeVisible({ timeout: 30_000 });
      await marker.first().click();
      await expect.soft(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 10_000 });
      // The Ask card floats above the content below it — close it before
      // reaching under it, as a reader would.
      await card.first().getByRole("button", { name: "Close" }).click();
    });

    await test.step("go-deeper generates, follow-ups consume, collapse keeps Contents", async () => {
      const pendings = page.locator("#page .ui-card.pend");
      let before = await pendings.count();
      for (let i = 0; i < 6 && before > 0; i++) {
        await pendings.first().getByRole("button", { name: "Generate" }).click();
        // No fixed sleep (#363 B2): the Generate click starts a job; the
        // pending count dropping is the settled state.
        await expect.soft.poll(() => pendings.count(), { timeout: 120_000 }).toBeLessThan(before);
        before = await pendings.count();
      }
      await expect.soft(pendings).toHaveCount(0, { timeout: 120_000 });
      const flow = page.locator("#C-g-alt");
      await flow.scrollIntoViewIfNeeded();
      await expect.soft(flow).toBeVisible({ timeout: 120_000 });
      if (await flow.evaluate((el) => el.classList.contains("collapsed"))) {
        await flow.getByRole("button", { name: "Expand" }).click();
      }
      const follow = page.locator("#C-g-alt .follow button").first();
      await expect.soft(follow).toBeVisible({ timeout: 15_000 });
      const label = await follow.innerText();
      await follow.click();
      await expect.soft(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 30_000 });
      await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
      await expect.soft(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
      await expect.soft(page.locator('nav.toc li [data-tocard="central"]')).toBeVisible();
    });
  });

  test("diff pane: explain opens pinned; close, mark, reopen, delete (#204)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // Our thread's id, captured at creation: never re-derived from the
    // annotation list (the replay pipeline can append suggestion threads
    // between steps, so "last" is not ours).
    let diffCardId = "";
    await openReview(page, "l4-diff");
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

    await test.step("Explain via API pins the thread inline in the diff", async () => {
      // Create via API (avoids quote ambiguity with the seeded suggestion
      // on the same line; the UI pinned/close/mark/reopen/delete flow below
      // is what this test covers, and the toolbar path is covered elsewhere).
      const snap0 = (await apiJson(s, "GET", "/api/reviews/l4-diff")).json as { files: { fileKey: string; path: string }[] };
      const connFile = (snap0.files ?? []).find((f) => f.path.includes("conn")) ?? (snap0.files ?? [])[0];
      const mk = await apiJson(s, "POST", "/api/reviews/l4-diff/actions", {
        kind: "explain",
        quote: "_OBSOLETE_FOLD_RE",
        anchor: { where: "diff-line", fileKey: connFile.fileKey, line: 82 },
      });
      const cardId: string = (mk.json as { annotationId: string }).annotationId;
      expect(cardId).toBeTruthy();
      diffCardId = cardId;
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(s, "GET", "/api/reviews/l4-diff");
        const anns = ((res.json as { annotations: { id: string; replies: { blocks: unknown[] }[] }[] }).annotations ?? []);
        const mine = anns.find((a) => a.id === cardId);
        if ((mine?.replies?.[0]?.blocks.length ?? 0) > 0 || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const card = page.locator(`.dhunk section.ithread[data-thread="${cardId}"]`).first();
      await expect.soft(card).toBeVisible({ timeout: 15_000 });
      await expect.soft(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
      // Pinned inline in the diff too: no floating overlay, no pin control.
      await expect.soft(card).not.toHaveClass(/floating/);
      await expect.soft(page.locator(".dhunk .exp-float")).toHaveCount(0);
      await expect.soft(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
    });

    await test.step("close collapses to the diff-row mark; the mark reopens pinned", async () => {
      const cardId = diffCardId;
      const card = page.locator(`.dhunk section.ithread[data-thread="${cardId}"]`).first();
      await card.getByRole("button", { name: "Close" }).click();
      await expect.soft(card).toHaveCount(0, { timeout: 15_000 });
      const mark = page.locator(`#right mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
      await expect.soft(mark).toBeVisible({ timeout: 15_000 });
      await mark.click();
      await expect.soft(card).toBeVisible({ timeout: 15_000 });
      await expect.soft(card).not.toHaveClass(/floating/);
    });

    await test.step("delete removes the card and its mark", async () => {
      const cardId = diffCardId;
      const card = page.locator(`.dhunk section.ithread[data-thread="${cardId}"]`).first();
      const mark = page.locator(`#right mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`);
      await card.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(card).toHaveCount(0, { timeout: 15_000 });
      await expect.soft(mark).toHaveCount(0, { timeout: 15_000 });
    });

    await test.step("pinned threads sit inline under their row in both modes", async () => {
      // Ported from diff-pinned.spec.ts (mock): unified and split open
      // pinned inline under the anchored row — the thread takes space in
      // the flow, never overlays the code.
      for (const mode of ["unified", "split"] as const) {
        if (mode === "split") await page.getByRole("button", { name: "Split", exact: true }).click();
        const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
        await expect.soft(page.locator(`${scope} table.diff`).first()).toBeVisible({ timeout: 15_000 });
        await selectText(page, scope, 'msg["fold-mixed-repeated"]');
        await page.locator('#selbar [data-act="explain"]').click();
        const thread = page.locator('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
        await expect.soft(thread).toBeVisible({ timeout: 30_000 });
        await expect.soft(thread).not.toHaveClass(/floating/);
        await expect.soft(page.locator(".dhunk .exp-float, .dhunk .dhunk-float")).toHaveCount(0);
        await expect.soft(thread.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
        // One synchronous read (#363 B1): the row below the thread must
        // start at or after the thread's bottom.
        const layout = await page.evaluate(() => {
          const threadEl = document.querySelector('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])');
          if (!threadEl) return { ok: false, why: "no pinned thread" };
          const srows = [...document.querySelectorAll('tr[id^="L-test-with_dummyserver-test_socketlevel.py-"]')];
          const row = srows.find((tr) => (tr.textContent ?? "").includes('msg["fold-mixed-repeated"]'));
          if (!row) return { ok: false, why: "no anchored row" };
          const cr = threadEl.getBoundingClientRect();
          const rr = (row as Element).getBoundingClientRect();
          return {
            ok: cr.top >= rr.top && cr.bottom > cr.top,
            why: `threadTop=${Math.round(cr.top)} rowTop=${Math.round(rr.top)} threadBottom=${Math.round(cr.bottom)}`,
          };
        });
        expect.soft(layout.ok, layout.why).toBe(true);
        await thread.getByRole("button", { name: "Close" }).click();
        await expect.soft(thread).toHaveCount(0, { timeout: 15_000 });
      }
    });

    await test.step("Ask inside a diff thread uses the Reply box chip, never a second composer", async () => {
      // Ported from diff-pinned.spec.ts's ask-inside-appends: select the
      // thread's answer text and Ask — the quote arrives as a removable
      // chip in the thread's own Reply box (#364).
      const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
      if (await page.getByRole("button", { name: "Unified", exact: true }).count()) {
        await page.getByRole("button", { name: "Unified", exact: true }).click();
      }
      await selectText(page, scope, 'msg["fold-mixed-repeated"]');
      await page.locator('#selbar [data-act="explain"]').click();
      const parent = page.locator('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
      await expect.soft(parent).toBeVisible({ timeout: 30_000 });
      await expect.soft(parent.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const askWord = await parent.locator(".exp-b").first().evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
      await selectText(page, '.dhunk section.ithread[data-thread] [data-reply][data-kind="explain"] .exp-b', askWord);
      await page.locator('#selbar [data-act="ask"]').click();
      // Issue #364: Ask inside a thread uses the thread's own Reply box —
      // the quote arrives as a removable chip, never a second composer.
      await expect.soft(page.locator(".dhunk .ithread[data-pending-thread]")).toHaveCount(0);
      const chip = parent.locator("[data-quote-chip]");
      await expect.soft(chip).toBeVisible({ timeout: 10_000 });
      await parent.locator('textarea[aria-label="Reply"]').fill("Why is this here?");
      await parent.getByRole("button", { name: "Reply", exact: true }).click();
      await expect
        .soft.poll(async () => parent.locator('[data-reply][data-kind="ask"]').count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(1);
      await expect.soft(parent).not.toHaveClass(/floating/);
      await parent.getByRole("button", { name: "Close" }).click();
      await expect.soft(parent).toHaveCount(0, { timeout: 15_000 });
    });
  });

  test("flat threads: ask, explain-inside, Reply, link, collapse-all", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    let threadId = "";
    await test.step("Ask starts a thread whose question is a reviewer entry", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator('#C-problem section.ithread[data-thread]').first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
      // Issue #315: no kind chip on Ask entries — the AI avatar says who's speaking.
      await expect.soft(thread.locator('[data-ask-answer] .av.ai').first()).toBeVisible();
      threadId = (await thread.getAttribute("data-thread")) ?? "";
      expect(threadId).toBeTruthy();
      // Issue #293: the question shows as a reviewer comment with the
      // answer as the reply directly under it — no muted heading, no gap.
      const q1 = thread.locator('[data-ask-question]').first();
      await expect.soft(q1).toContainText("What is line folding?", { timeout: 30_000 });
      await expect.soft(q1.locator(".av.you")).toBeVisible();
      // Issue #315: no comment chip, no "Reviewer comment" label — the
      // entries keep accessible names so screen readers still tell them apart.
      await expect.soft(q1).toHaveAttribute("aria-label", "Your question");
      await expect.soft(q1.locator(".kind")).toHaveCount(0);
      await expect.soft(q1).not.toContainText("Reviewer comment");
      const a1 = thread.locator('[data-ask-answer]').first();
      await expect.soft(a1).toBeVisible({ timeout: 30_000 });
      await expect.soft(a1.locator(".av.ai")).toBeVisible();
      await expect.soft(a1).toHaveAttribute("aria-label", "Agent answer");
      await expect.soft(a1.locator(".kind")).toHaveCount(0);
      await expect.soft(a1.locator(".ans-q")).toHaveCount(0);
      // The question never enters the Outbox: stored replies stay ask-only.
      const snapAsk = await threads(s, reviewId);
      const askThread = snapAsk.find((t) => t.id === threadId);
      expect.soft(askThread).toBeTruthy();
      expect.soft(askThread!.replies.map((r) => r.kind)).not.toContain("comment");
      expect.soft(askThread!.post).toBe(false);
      // Exactly one thread for this anchor (flat, never nested boxes).
      await expect.soft(page.locator('#C-problem section.ithread[data-thread] [data-expansion]')).toHaveCount(0);
    });

    await test.step("Explain inside appends a reply in the same thread", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const askBody = thread.locator('[data-reply][data-kind="ask"] .exp-b').first();
      await expect.soft(askBody).not.toBeEmpty({ timeout: 60_000 });
      const word = await askBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
      expect(word).not.toBe("");
      await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="ask"] .exp-b`, word);
      await page.locator('#selbar [data-act="explain"]').click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBeGreaterThanOrEqual(2);
      await expect.soft(thread.locator('[data-reply][data-kind="explain"]').first()).toBeVisible({ timeout: 30_000 });
      // Still one thread, now with ask + explain replies (flat).
      const snap1 = await threads(s, reviewId);
      const mine = snap1.find((t) => t.id === threadId);
      expect.soft(mine).toBeTruthy();
      expect.soft(mine!.replies.map((r) => r.kind)).toContain("ask");
      expect.soft(mine!.replies.map((r) => r.kind)).toContain("explain");
      await expect.soft(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(1);
    });

    await test.step("the source reply links to the new reply and the link scrolls to it", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const link = thread.locator('button.rlink[data-replylink]').first();
      await expect.soft(link).toBeVisible({ timeout: 30_000 });
      const targetId = await link.getAttribute("data-replylink");
      expect(targetId).toBeTruthy();
      await link.click();
      const target = page.locator(`[data-reply="${targetId}"]`);
      await expect.soft(target).toBeVisible({ timeout: 15_000 });
      await expect.soft(target).toHaveClass(/flash/, { timeout: 15_000 });
    });

    await test.step("the single Reply box asks again; follow-ups pair question with answer", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      // Only one box — the comment-reply box is gone from agent threads;
      // reviewer comments are written elsewhere (covered by L5's j9).
      await expect.soft(thread.locator("textarea")).toHaveCount(1);
      await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
      await thread.getByRole("button", { name: "Reply", exact: true }).click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 60_000,
        })
        .toBeGreaterThanOrEqual(3);
      await expect.soft(thread.locator('[data-reply][data-kind="ask"]')).toHaveCount(2, { timeout: 60_000 });
      // Issue #293 follow-up: each question is a comment, each answer a reply.
      await expect.soft(thread.locator("[data-ask-question]")).toHaveCount(2, { timeout: 30_000 });
      await expect.soft(thread.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
      await expect.soft(thread.locator("[data-ask-question]").nth(1)).toContainText("Does a cookie header change this?", { timeout: 30_000 });
      await expect.soft(thread.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
      // Explain is avatar-only too (#315 follow-up): no kind chip, no heading.
      await expect.soft(thread.locator('[data-reply][data-kind="explain"] .kind')).toHaveCount(0);
      await expect.soft(thread.locator('[data-reply][data-kind="explain"] .ans-q')).toHaveCount(0);
      await expect.soft(thread.locator('[data-reply][data-kind="explain"]').first()).toHaveAttribute("aria-label", "Agent explanation");
      const order2 = await thread.evaluate((el) =>
        [...el.querySelectorAll("[data-ask-question],[data-ask-answer]")].map((n) =>
          n.getAttribute("data-ask-question") ? `q:${n.getAttribute("data-ask-question")}` : `a:${n.getAttribute("data-ask-answer")}`,
        ),
      );
      expect.soft(order2.length).toBe(4);
      for (let i = 0; i < order2.length; i += 2) {
        expect.soft(order2[i]!.slice(0, 2)).toBe("q:");
        expect.soft(order2[i + 1]!.slice(0, 2)).toBe("a:");
        expect.soft(order2[i]!.slice(2)).toBe(order2[i + 1]!.slice(2));
      }
      const snapFollow = await threads(s, reviewId);
      const followThread = snapFollow.find((t) => t.id === threadId);
      expect.soft(followThread).toBeTruthy();
      expect.soft(followThread!.replies.filter((r) => r.kind === "comment")).toHaveLength(0);
      expect.soft(followThread!.post).toBe(false);
    });

    await test.step("collapse-all turns threads into rows; expanding restores this one", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      // #326: the control is an icon button in the review top bar.
      await page.getByRole("button", { name: "Collapse threads" }).click();
      const row = page.locator(`button.spike-row[data-row="${threadId}"]`);
      await expect.soft(row).toBeVisible({ timeout: 15_000 });
      await expect.soft(row).toContainText(/1 reply|2 replies|3 replies/);
      await expect.soft(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toHaveCount(0);
      await row.click();
      await expect.soft(page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`)).toBeVisible({
        timeout: 15_000,
      });
      await expect.soft(page.locator(`#C-problem [data-thread="${threadId}"] [data-reply]`).first()).toBeVisible();
      void thread;
    });
  });

  test("inline avatars and replies-after-first counts (#331, #315)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    let loneId = "";
    await test.step("a lone reviewer comment shows no chips, no mark, no reply count", async () => {
      await selectText(page, "#C-problem", "whitespace");
      await page.locator('#selbar [data-act="note"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      const loneText =
        "This fold handling reads like a quiet compatibility shim: it keeps every downstream consumer working without knowing the wire format ever allowed a split line, and it does so without changing the order or the duplicates anyone already depends on.";
      await composer.locator("textarea").fill(loneText);
      await composer.getByRole("button", { name: "Save" }).click();
      const lone = page.locator("#C-problem section.ithread[data-thread]", { hasText: loneText.slice(0, 40) });
      await expect.soft(lone).toBeVisible({ timeout: 15_000 });
      loneId = (await lone.getAttribute("data-thread")) ?? "";
      expect(loneId).toBeTruthy();
      const loneReply = lone.locator('[data-reply][data-kind="comment"]').first();
      await expect.soft(loneReply.locator(":scope > .av.you")).toBeVisible();
      await expect.soft(loneReply.locator(".kind")).toHaveCount(0);
      await expect.soft(loneReply.locator(".ans-q")).toHaveCount(0);
      await expect.soft(loneReply).toHaveAttribute("aria-label", "Reviewer comment");
      await expect.soft(loneReply.locator(".outbox-mark")).toHaveCount(0);
      // A lone opening comment shows no reply count.
      await expect.soft(lone.locator("[data-count]")).toHaveCount(0);
      // The comment's first line starts on the avatar's line; later lines
      // wrap back to the thread padding.
      const loneGeo = await firstLineGeometry(loneReply);
      expect(loneGeo).not.toBeNull();
      expect.soft(Math.abs(loneGeo!.dTop)).toBeLessThanOrEqual(6);
      expect.soft(loneGeo!.firstLeft).toBeGreaterThanOrEqual(loneGeo!.avRight - 2);
      expect.soft(loneGeo!.lines).toBeGreaterThan(1);
      expect.soft(loneGeo!.pLeft).toBeLessThan(loneGeo!.avRight - 2);
    });

    let commentId = "";
    await test.step("a comment plus one answer shows '1 reply' with a centred avatar", async () => {
      await selectText(page, "#C-problem", "server");
      await page.locator('#selbar [data-act="note"]').click();
      const composer2 = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer2).toBeVisible({ timeout: 10_000 });
      const shortText = "A short note on the fold handling.";
      await composer2.locator("textarea").fill(shortText);
      await composer2.getByRole("button", { name: "Save" }).click();
      const comment = page.locator("#C-problem section.ithread[data-thread]", { hasText: shortText });
      await expect.soft(comment).toBeVisible({ timeout: 15_000 });
      commentId = (await comment.getAttribute("data-thread")) ?? "";
      expect(commentId).toBeTruthy();
      await expect.soft(comment.locator("[data-count]")).toHaveCount(0);
      await comment.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
      await comment.getByRole("button", { name: "Reply", exact: true }).click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === commentId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBe(2);
      await expect.soft(comment.locator("[data-count]")).toHaveText("1 reply");
      const answer = comment.locator("[data-ask-answer]").first();
      await expect.soft(answer.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
      await expect.soft(answer.locator(":scope > .av.ai")).toBeVisible();
      await expect.soft(answer.locator(".kind")).toHaveCount(0);
      await expect.soft(answer.locator(".ans-q")).toHaveCount(0);
      await expect.soft(answer).toHaveAttribute("aria-label", "Agent answer");
      const ansGeo = await firstLineGeometry(answer);
      expect(ansGeo).not.toBeNull();
      expect.soft(Math.abs(ansGeo!.dTop)).toBeLessThanOrEqual(6);
      expect.soft(ansGeo!.firstLeft).toBeGreaterThanOrEqual(ansGeo!.avRight - 2);
      if (ansGeo!.lines > 1) {
        expect.soft(ansGeo!.pLeft).toBeLessThan(ansGeo!.avRight - 2);
      }
    });

    await test.step("collapse-all: lone threads show no count pill, the answered one shows '1 reply'", async () => {
      await page.getByRole("button", { name: "Collapse threads" }).click();
      const loneRow = page.locator(`button.spike-row[data-row="${loneId}"]`);
      await expect.soft(loneRow).toBeVisible({ timeout: 15_000 });
      await expect.soft(loneRow.locator(".spike-row-count")).toHaveCount(0);
      await expect.soft(page.locator(`button.spike-row[data-row="${commentId}"]`)).toContainText("1 reply");
    });
  });

  test("reply chrome: controls never overlap, chips never empty, avatars centred (#336)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    let threadId = "";
    await test.step("one thread: a one-line comment, an agent answer, an explain reply", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="note"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      const humanText = "Fold handling looks right.";
      await composer.locator("textarea").fill(humanText);
      await composer.getByRole("button", { name: "Save" }).click();
      const thread = page.locator("#C-problem section.ithread[data-thread]", { hasText: humanText });
      await expect.soft(thread).toBeVisible({ timeout: 15_000 });
      threadId = (await thread.getAttribute("data-thread")) ?? "";
      expect(threadId).toBeTruthy();
      await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
      await thread.getByRole("button", { name: "Reply", exact: true }).click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBe(2);
      // Explain "Fold" inside the thread appends a prose-first explain reply
      // in the same thread (flat): its recording is deterministic, so the
      // agent-avatar-centring assertion always has an inline case.
      await selectText(page, `#C-problem section.ithread[data-thread="${threadId}"]`, "Fold");
      await page.locator('#selbar [data-act="explain"]').click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBe(3);
      const expl = thread.locator('[data-reply][data-kind="explain"]').first();
      await expect.soft(expl.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
      // No citation chip in the thread renders with empty text.
      const chips = thread.locator(".lk[data-refs]");
      const chipCount = await chips.count();
      for (let i = 0; i < chipCount; i++) {
        expect.soft(((await chips.nth(i).textContent()) ?? "").trim()).not.toBe("");
      }
    });

    await test.step("avatars centre on their first line; the hovered toolbar clears the text", async () => {
      const thread = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const human = thread.locator('[data-reply][data-kind="comment"]').first();
      const answer = thread.locator("[data-ask-answer]").first();
      const expl = thread.locator('[data-reply][data-kind="explain"]').first();
      await expect.soft(answer.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
      await thread.evaluate((el) => el.scrollIntoView({ block: "start", inline: "nearest" }));

      const expectFullSecondLine = (
        geo: NonNullable<Awaited<ReturnType<typeof replyChrome>>>,
        what: string,
      ): void => {
        // The float must not reach the second line at all.
        if (geo.lineCount >= 2 && geo.ctl && geo.secondTop !== null) {
          expect.soft(
            geo.ctl.bottom,
            `toolbar stays clear of the second line (${what})`,
          ).toBeLessThanOrEqual(geo.secondTop + 1);
        }
        // So the second line spans nearly the full width. The slack is
        // word-wrap leftover (a long word left ~80px in dark mode);
        // the defect left a toolbar-wide ~250px gap, which this
        // still catches comfortably.
        if (geo.lineCount >= 3) {
          expect.soft(
            geo.secondRight,
            `second line spans full width (${what})`,
          ).toBeGreaterThanOrEqual(geo.replyRight - 128);
        }
      };

      const humanGeo = await replyChrome(human);
      expect(humanGeo, "human chrome measurable").not.toBeNull();
      expect.soft(humanGeo!.inline, "human comment flows inline").toBe(true);
      expect.soft(
        Math.abs(humanGeo!.avCenter - humanGeo!.firstCenter),
        "human avatar centred",
      ).toBeLessThanOrEqual(2);
      const ansGeo = await replyChrome(answer);
      expect(ansGeo, "agent chrome measurable").not.toBeNull();
      if (ansGeo!.inline) {
        expect.soft(
          Math.abs(ansGeo!.avCenter - ansGeo!.firstCenter),
          "agent avatar centred",
        ).toBeLessThanOrEqual(2);
        expectFullSecondLine(ansGeo!, "agent answer");
      } else {
        expect.soft(
          ansGeo!.firstTop,
          "list-first answer starts below the avatar",
        ).toBeGreaterThanOrEqual(ansGeo!.avBottom - 2);
      }
      // Hover, then assert the toolbar is revealed before measuring —
      // no fixed sleep (#363 B2).
      await answer.hover();
      await expect.soft(answer.locator(":scope > .ctl")).toBeVisible({ timeout: 10_000 });
      const hovered = await replyChrome(answer);
      expect(hovered?.ctl, "toolbar present").not.toBeNull();
      expect.soft(
        intersects(hovered!.ctl!, hovered!.first),
        "toolbar clear of first line",
      ).toBe(false);
      // The explain reply is prose-first by its recording: the agent
      // avatar centres on its first line.
      const explGeo = await replyChrome(expl);
      expect(explGeo, "explain chrome measurable").not.toBeNull();
      expect.soft(explGeo!.inline, "explain reply flows inline").toBe(true);
      expect.soft(
        Math.abs(explGeo!.avCenter - explGeo!.firstCenter),
        "explain avatar centred",
      ).toBeLessThanOrEqual(2);
      expectFullSecondLine(explGeo!, "explain reply");
    });
  });

  test("follow-ups stay in one thread across a restart and an access-mode change", async ({ page }) => {
    test.setTimeout(300_000);
    let s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    const followUp = async (question: string): Promise<void> => {
      const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
      const box = thread.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      const answersBefore = await thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]').count();
      await box.fill(question);
      await thread.getByRole("button", { name: "Reply" }).last().click();
      await expect
        .soft.poll(async () => thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]').count(), { timeout: 60_000 })
        .toBeGreaterThan(answersBefore);
      await expect.soft(thread.locator('[data-reply] .exp-b').last()).not.toBeEmpty({ timeout: 60_000 });
      // Still the same single thread for this conversation.
      await expect.soft(page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" })).toHaveCount(1);
    };

    await test.step("Ask starts the thread; a follow-up appends", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator('[data-reply][data-kind="ask"] .exp-b').first()).not.toBeEmpty({ timeout: 60_000 });
      await followUp("Does a cookie header change this?");
    });

    await test.step("restart keeps the thread with both replies, still pinned", async () => {
      await s.stop();
      s = await startService(dataDir, { agent: "replay", label: "l4demo" });
      svc = s;
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
      const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator('[data-reply] .exp-b').first()).not.toBeEmpty({ timeout: 30_000 });
      // #204: the thread survives the restart pinned inline, with no
      // pin/unpin control.
      await expect.soft(thread).not.toHaveClass(/floating/);
      await expect.soft(thread.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
      // Both earlier replies are still in the one thread after the restart.
      await expect.soft(thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]')).toHaveCount(2, { timeout: 30_000 });
      await expect.soft(thread).toContainText("What is line folding?");
      await expect.soft(thread).toContainText("Does a cookie header change this?");
    });

    await test.step("a post-restart follow-up reaches the agent with the earlier replies", async () => {
      await followUp("What about ordering?");
      const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
      await expect.soft(thread.locator('[data-reply][data-kind="ask"], [data-reply][data-kind="explain"]')).toHaveCount(3, { timeout: 30_000 });
      const jobsRes = await apiJson(s, "GET", `/api/jobs?review=${reviewId}`);
      const askJobs = ((jobsRes.json as { jobs?: { id: string; kind: string }[] }).jobs ?? []).filter((j) => j.kind === "ask");
      expect(askJobs.length).toBeGreaterThanOrEqual(3);
      const lastAsk = askJobs[askJobs.length - 1]!;
      const promptRes = await apiJson(s, "GET", `/api/jobs/${lastAsk.id}`);
      const promptText = (promptRes.json as { job?: { promptSnapshot?: string } }).job?.promptSnapshot ?? "";
      expect.soft(promptText).toContain("What is line folding?");
      await page.goto(`${s.origin}/review/${reviewId}/debug?token=${s.token}`);
      await expect.soft(page.getByRole("tab", { name: "Jobs" })).toBeVisible({ timeout: 30_000 });
      await expect.soft(page.locator("body")).toContainText(/ask/i, { timeout: 30_000 });
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect.soft(page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first()).toBeVisible({ timeout: 60_000 });
    });

    await test.step("turning full access on keeps the thread answering (#160 opt-in)", async () => {
      await page.goto(`${s.origin}/settings?token=${s.token}`);
      await page.getByRole("tab", { name: "Access" }).click();
      await page.getByRole("button", { name: "Turn on full access" }).click();
      await page.getByRole("button", { name: "Confirm full access" }).click();
      await expect.soft(page.locator('[data-testid="access-state"]')).toContainText("Full access is on", { timeout: 15_000 });
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      const thread = page.locator('#C-problem section.ithread[data-thread]', { hasText: "What is line folding?" }).first();
      await expect.soft(thread).toBeVisible({ timeout: 60_000 });
      await followUp("And does the regex stay fast?");
    });
  });

  test("a sent follow-up stays sent across a reload", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("ask, clear the box, then ask the recorded follow-up", async () => {
      // Issue #341: the re-recorded central card has no "fast path" text.
      await selectText(page, "#C-central", "matches optional whitespace");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-central .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible();
      await composer.locator("textarea").fill("Does the fast path still catch a fold that uses a bare LF?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator('#C-central section.ithread[data-thread]', {
        hasText: "Does the fast path still catch a fold",
      });
      await expect.soft(thread.first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator("[data-reply] .exp-b").first()).not.toBeEmpty({ timeout: 30_000 });
      const box = thread.locator('textarea[aria-label="Reply"]');
      await box.fill("never mind");
      await thread.getByRole("button", { name: "Clear" }).click();
      await expect.soft(box).toHaveValue("");
      // Issue #341: ask the recorded identity question. Follow-up prompts
      // resolve through the thread's card context (the central card carries
      // the identity quote), so the replayed follow-up answers about the
      // shared message object.
      await box.fill("Is the rewritten message the same object downstream code already holds, or a copy?");
      await thread.getByRole("button", { name: "Reply" }).last().click();
      await expect.soft(box).toHaveValue("", { timeout: 5000 });
      await expect.soft(thread.locator("[data-reply]").nth(1)).toContainText("same object", { timeout: 30_000 });
      await expect.soft(box).toHaveValue("");
    });

    await test.step("reload keeps the sent follow-up and an empty box", async () => {
      await page.reload();
      await expect.soft(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete", { timeout: 30_000 });
      const again = page.locator('#C-central section.ithread[data-thread]', {
        hasText: "Does the fast path still catch a fold",
      });
      await expect.soft(again.first()).toBeVisible({ timeout: 30_000 });
      await expect.soft(again.locator("[data-reply]").nth(1)).toContainText("same object", { timeout: 30_000 });
      await expect.soft(again.locator('textarea[aria-label="Reply"]')).toHaveValue("");
    });
  });

  test("suggested question and comment: accept, edit and dismiss", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    // Wait until the critics' suggested comments have landed.
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as { annotations?: { replies?: { suggested?: boolean }[] }[] }).annotations ?? [];
      if (anns.some((a) => (a.replies ?? []).some((r) => r.suggested))) break;
      if (Date.now() > deadline) throw new Error("no suggested comment landed");
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("a suggested question asks from its follow-up chip", async () => {
      // A follow-up chip in an auto-written go-deeper card, which stays
      // collapsed until opened (#217). Clicking asks it.
      // (Issue #341: g-alt is the re-recorded guide's first go-deeper card.)
      const flow = page.locator("#C-g-alt");
      await flow.scrollIntoViewIfNeeded();
      await expect.soft(flow).toHaveClass(/collapsed/, { timeout: 120_000 });
      await flow.getByRole("button", { name: "Expand" }).click();
      const follow = page.locator("#page .follow button").first();
      await expect.soft(follow).toBeVisible({ timeout: 30_000 });
      const label = (await follow.innerText()).trim();
      expect(label).not.toBe("");
      await follow.click();
      // The chip is consumed once asked (interaction-service pattern).
      await expect.soft(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 60_000 });
    });

    await test.step("a suggested diff comment asks inside via the Reply chip, then accepts", async () => {
      const snapRes = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
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
      await expect.soft(thread).toBeVisible({ timeout: 60_000 });
      expect.soft(await thread.textContent()).toContain(sugText.slice(0, 20));
      await expect.soft(thread.locator("textarea")).toHaveCount(0);
      // Issue #301: selecting in the suggestion summons the toolbar and
      // Ask opens the composer inside the thread; the Ask reply lands in
      // the same thread.
      const askWord = sugText.split(/\s+/).find((w) => w.length > 5) ?? sugText.slice(0, 12);
      await selectText(page, `.ithread[data-thread="${sugHit.a.id}"]`, askWord);
      await expect.soft(page.locator("#selbar")).toBeVisible();
      await page.locator('#selbar [data-act="ask"]').click();
      // Issue #364: Ask inside a thread uses the thread's own Reply box —
      // the quote arrives as a removable chip, never a second composer.
      await expect.soft(page.locator('#right .ithread[data-pending-thread]')).toHaveCount(0);
      const chip = thread.locator("[data-quote-chip]");
      await expect.soft(chip).toBeVisible({ timeout: 10_000 });
      await thread.locator('textarea[aria-label="Reply"]').fill("Why this suggestion?");
      await thread.getByRole("button", { name: "Reply", exact: true }).click();
      const askReply = thread.locator('[data-reply][data-kind="ask"]');
      await expect.soft(askReply).toBeVisible({ timeout: 30_000 });
      await expect.soft(askReply.locator(".exp-b")).not.toBeEmpty({ timeout: 90_000 });
      // Accept: mark it for the PR.
      const markBtn = thread.getByRole("button", { name: "Add to Outbox" });
      if ((await markBtn.count()) > 0) {
        await markBtn.click();
        await expect.soft(thread.getByRole("button", { name: /Remove from the Outbox/ })).toBeVisible({ timeout: 10_000 });
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
      await expect.soft(thread).toBeVisible({ timeout: 10_000 });
      const threadId = await thread.getAttribute("data-thread");
      expect(threadId).toBeTruthy();
      await thread.getByRole("button", { name: "Delete thread" }).click();
      await expect.soft(page.locator(`.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 10_000 });
      await page.reload();
      await expect.soft(page.locator("#right")).toBeVisible({ timeout: 30_000 });
    });
  });

  test("explain inside guide and diff threads appends in place", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    const deadline = Date.now() + 90_000;
    for (;;) {
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as { annotations?: { id: string; openQuestion?: unknown; replies?: { suggested?: boolean }[] }[] }).annotations ?? [];
      const q = anns.find((a) => a.openQuestion);
      const ai = anns.find((a) => (a.replies ?? []).some((r) => (r as { suggested?: boolean }).suggested === true));
      if (q && ai) break;
      if (Date.now() > deadline) throw new Error("no question/suggestion landed");
      await new Promise((r) => setTimeout(r, 500));
    }
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    await test.step("guide: explain inside a suggested-question thread appends a reply", async () => {
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as { annotations?: { id: string; openQuestion?: unknown }[] }).annotations ?? [];
      const q = anns.find((a) => a.openQuestion);
      if (!q) throw new Error("no suggested question");
      const thread = page.locator(`section.ithread[data-thread="${q.id}"]`);
      if ((await thread.count()) === 0 || !(await thread.isVisible().catch(() => false))) {
        // Issue #374: the margin pill opens the closed thread (no end bubble).
        await page.locator(`#C-problem [data-thr-margin~="${q.id}"]`).click();
      }
      await expect.soft(thread).toBeVisible({ timeout: 15_000 });
      await expect.soft(thread).toContainText("Suggested question");
      const body = thread.locator('[data-reply][data-kind="comment"]').first();
      const word = await body.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "folded");
      await selectText(page, `[data-thread="${q.id}"] [data-reply][data-kind="comment"]`, word);
      await page.locator('#selbar [data-act="explain"]').click();
      const repliesOf = async (): Promise<{ kind: string }[]> => {
        const cur = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        return (((cur.json as { annotations?: { id: string; replies?: { kind: string }[] }[] }).annotations ?? []).find((a) => a.id === q.id)?.replies ?? []) as { kind: string }[];
      };
      // No nested box: the same thread gains an Explain reply.
      await expect.soft.poll(async () => (await repliesOf()).length, { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
      expect.soft((await repliesOf()).some((r) => r.kind === "explain")).toBe(true);
      // Still one thread on the page for this anchor (flat, never nested).
      await expect.soft(page.locator(`section.ithread[data-thread="${q.id}"]`)).toHaveCount(1);
      await expect.soft(page.locator(`[data-thread="${q.id}"] [data-expansion]`)).toHaveCount(0);
      await expect.soft(thread.locator('[data-reply][data-kind="explain"] .exp-b')).not.toBeEmpty({ timeout: 60_000 });
    });

    await test.step("diff: explain inside a suggested thread appends a reply", async () => {
      const snap = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const anns = (snap.json as { annotations?: { id: string; replies?: { suggested?: boolean }[] }[] }).annotations ?? [];
      const ai = anns.find((a) => (a.replies ?? []).some((r) => (r as { suggested?: boolean }).suggested === true));
      if (!ai) throw new Error("no suggested comment");
      await page.locator('#right [role="tab"]').getByText("Diff").click();
      const thread = page.locator(`section.ithread[data-thread="${ai.id}"]`).first();
      await expect.soft(thread).toBeVisible({ timeout: 60_000 });
      const body = thread.locator('[data-reply][data-kind="comment"]').first();
      // The guide step above runs first on this same thread and turns its
      // first word into an in-thread link button (j273 rlink) — and the
      // selection toolbar never answers inside a button or link. Pick the
      // first word outside any interactive element instead.
      const word = await body.evaluate((el) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ((node as Text).parentElement?.closest?.("button, a")) continue;
          const m = (node as Text).data.match(/[A-Za-z]{4,}/);
          if (m) return m[0];
        }
        return "bare";
      });
      await selectText(page, `[data-thread="${ai.id}"] [data-reply][data-kind="comment"]`, word);
      const repliesOf = async (): Promise<number> => {
        const cur = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
        const found = ((cur.json as { annotations?: { id: string; replies?: unknown[] }[] }).annotations ?? []).find((a) => a.id === ai.id);
        return found?.replies?.length ?? 0;
      };
      await expect.soft.poll(repliesOf, { timeout: 90_000 }).toBeGreaterThanOrEqual(2);
      const updated = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const threadNow = ((updated.json as { annotations?: { id: string; replies?: { kind: string }[] }[] }).annotations ?? []).find((a) => a.id === ai.id)!;
      expect.soft((threadNow.replies ?? []).some((r) => r.kind === "explain")).toBe(true);
      await expect.soft(page.locator(`section.ithread[data-thread="${ai.id}"]`)).toHaveCount(1);
    });
  });

  test("thread polish: margin icon, reverse link, one composer, tombstone delete", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 1440, height: 900 });

    let threadId = "";
    await test.step("Ask starts a thread; Explain inside appends a turn", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const thread = page.locator("#C-problem section.ithread[data-thread]").first();
      await expect.soft(thread).toBeVisible({ timeout: 30_000 });
      await expect.soft(thread.locator('[data-reply][data-kind="ask"] .exp-b').first()).toBeVisible({ timeout: 60_000 });
      threadId = (await thread.getAttribute("data-thread")) ?? "";
      expect(threadId).toBeTruthy();
      // Pin our thread by ID: closing it unmounts its section, after which
      // `.first()` would resolve to another open thread (e.g. a suggestion).
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const askBody = mine.locator('[data-reply][data-kind="ask"] .exp-b').first();
      await expect.soft(askBody).not.toBeEmpty({ timeout: 60_000 });
      const word = await askBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
      expect(word).not.toBe("");
      await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="ask"] .exp-b`, word);
      await page.locator('#selbar [data-act="explain"]').click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBe(2);
    });

    await test.step("Ask inside uses the Reply-box chip; turns band together", async () => {
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      // (Select fresh words in the explain turn: the ask turn's words now
      // carry the in-thread reply link, and selecting a link hides the bar.)
      const explainBody = mine.locator('[data-reply][data-kind="explain"] .exp-b').first();
      await expect.soft(explainBody).not.toBeEmpty({ timeout: 60_000 });
      const word2 = await explainBody.evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{5,}/)?.[0] ?? "");
      expect(word2).not.toBe("");
      await selectText(page, `#C-problem [data-thread="${threadId}"] [data-reply][data-kind="explain"] .exp-b`, word2);
      await page.locator('#selbar [data-act="ask"]').click();
      await expect.soft(mine.locator('[data-pending-thread]')).toHaveCount(0);
      const chip = mine.locator('[data-quote-chip]');
      await expect.soft(chip).toBeVisible({ timeout: 10_000 });
      await mine.locator('textarea[aria-label="Reply"]').fill("And then?");
      await mine.getByRole("button", { name: "Reply", exact: true }).click();
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
          timeout: 90_000,
        })
        .toBe(3);
      // Three turns render banded under one thread.
      await expect.soft(mine.locator(':scope > .turn')).toHaveCount(3, { timeout: 30_000 });
    });

    await test.step("the margin pill sits inside the card, reads one count, and reopens a closed thread", async () => {
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const margin = page.locator(`[data-thr-margin~="${threadId}"]`);
      await expect.soft(margin).toBeVisible({ timeout: 15_000 });
      // Issue #374, one synchronous read (atomic, #363 B1): the pill's
      // box is inside the card's box, its glyph and count boxes never
      // intersect, and no end-of-paragraph marker remains for it.
      const geom = await margin.evaluate((el) => {
        const box = (r: DOMRect): { top: number; left: number; bottom: number; right: number } => ({
          top: r.top,
          left: r.left,
          bottom: r.bottom,
          right: r.right,
        });
        const card = el.closest("section.ui-card");
        const glyph = el.querySelector(":scope > svg.ic");
        const count = el.querySelector(":scope > .tmargin-n");
        const pill = box(el.getBoundingClientRect());
        const brect = (q: string): { top: number; left: number; bottom: number; right: number } | null => {
          const n = q === ".card" ? card : el.querySelector(q);
          return n instanceof Element ? box(n.getBoundingClientRect()) : null;
        };
        const ids = (el.getAttribute("data-thr-margin") ?? "").split(/\s+/).filter(Boolean);
        return {
          pill,
          card: brect(".card"),
          glyph: brect(":scope > svg.ic"),
          count: brect(":scope > .tmargin-n"),
          glyphTag: glyph instanceof Element ? glyph.tagName : null,
          countText: count?.textContent?.trim() ?? null,
          tip: el.getAttribute("data-tip"),
          ids,
          bubbles: card instanceof Element ? card.querySelectorAll(".lk.cm[data-threads]").length : -1,
        };
      });
      expect.soft(geom.card).not.toBeNull();
      expect.soft(geom.glyph).not.toBeNull();
      expect.soft(geom.count).not.toBeNull();
      if (geom.card) {
        expect.soft(geom.pill.left >= geom.card.left, `pill left ${Math.round(geom.pill.left)} inside card ${Math.round(geom.card.left)}`).toBe(true);
        expect.soft(geom.pill.right <= geom.card.right, `pill right ${Math.round(geom.pill.right)} inside card ${Math.round(geom.card.right)}`).toBe(true);
      }
      // Glyph and count sit side by side, never overlapping (#374).
      if (geom.glyph && geom.count) {
        const overlap =
          geom.glyph.left < geom.count.right && geom.count.left < geom.glyph.right && geom.glyph.top < geom.count.bottom && geom.count.top < geom.glyph.bottom;
        expect.soft(overlap, `glyph ${JSON.stringify(geom.glyph)} vs count ${JSON.stringify(geom.count)}`).toBe(false);
      }
      // One count only: tooltip and pill text read the bucket's threads.
      expect.soft(geom.countText).toBe(String(geom.ids.length));
      expect.soft(geom.tip).toBe(geom.ids.length === 1 ? "1 thread" : `${geom.ids.length} threads`);
      // No end-of-paragraph marker survives for a margined paragraph.
      expect.soft(geom.bubbles).toBe(0);
      await mine.locator('button[aria-label="Close"]').click();
      await expect.soft(mine).toBeHidden({ timeout: 15_000 });
      await expect.soft(margin).toBeVisible({ timeout: 15_000 });
      // Like a human: the icon is seen mid-viewport, never half-hidden
      // under the sticky review bar. Click in page context: the data-tip
      // tooltip is pointer-events:none so it never blocks real input,
      // but it trips Playwright's strict hit-target check.
      await margin.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await margin.evaluate((el) => (el as HTMLElement).click());
      // Diagnose at the snapshot level: did the open flag land?
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId)?.open ?? false, {
          timeout: 15_000,
        })
        .toBe(true);
      await expect.soft(mine).toBeVisible({ timeout: 15_000 });
    });

    await test.step("the reverse link scrolls to the highlight and flashes it", async () => {
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const srcLink = mine.locator('[data-src-link]').first();
      await expect.soft(srcLink).toBeVisible();
      await srcLink.click();
      // Agent threads carry no inline highlight of their own, so the link
      // falls back to the margin marker's line and flashes that instead.
      const margin = page.locator(`[data-thr-margin~="${threadId}"]`);
      await expect.soft(margin).toHaveClass(/flash/, { timeout: 15_000 });
    });

    await test.step("a collapsed card shows one pill with the card total (#374)", async () => {
      const expandedTotal = await page.evaluate(() => {
        const pills = document.querySelectorAll("#C-problem [data-thr-margin]");
        return [...pills].reduce(
          (sum, el) => sum + (el.getAttribute("data-thr-margin") ?? "").split(/\s+/).filter(Boolean).length,
          0,
        );
      });
      expect.soft(expandedTotal).toBeGreaterThan(1);
      await page.locator("#C-problem > .chead").getByRole("button", { name: "Collapse" }).click();
      await expect.soft(page.locator("#C-problem")).toHaveClass(/collapsed/, { timeout: 10_000 });
      const collapsedPills = page.locator("#C-problem [data-thr-margin]");
      await expect.soft(collapsedPills).toHaveCount(1, { timeout: 15_000 });
      await expect.soft(collapsedPills.first()).toHaveAttribute("data-tip", `${expandedTotal} threads`);
      await page.locator("#C-problem > .chead").getByRole("button", { name: "Expand" }).click();
      await expect.soft(page.locator("#C-problem")).not.toHaveClass(/collapsed/, { timeout: 10_000 });
    });

    await test.step("closing and reopening 5 times leaves one highlight, no glyphs, same count (#374, #206)", async () => {
      // A comment thread (inline highlight + margin pill) on #C-problem.
      const snapRes = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const snap = snapRes.json as {
        pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      };
      const problem = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "problem");
      const firstBlock = problem?.blocks[0]?.id;
      if (!problem || !firstBlock) throw new Error("no problem block");
      const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId: `${problem.id}#${firstBlock}` },
        // Plain-text quote that spans no inline markup: one text node,
        // so the pass owes exactly one mark (multi-node quotes wrap one
        // mark per node by design).
        quote: "servers may still send obsolete",
        text: "Idempotence note",
      });
      expect(made.status).toBe(201);
      const noteId = (made.json as { id: string }).id;
      const note = page.locator(`#C-problem section.ithread[data-thread="${noteId}"]`);
      const pill = page.locator(`#C-problem [data-thr-margin~="${noteId}"]`);
      await expect.soft(pill).toBeVisible({ timeout: 15_000 });
      // Guide comments start closed: open through the pill first.
      await pill.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await pill.evaluate((el) => (el as HTMLElement).click());
      await expect.soft(note).toBeVisible({ timeout: 30_000 });
      const countBefore = await pill.evaluate((el) => (el.textContent ?? "").trim());
      for (let i = 0; i < 5; i++) {
        await note.getByRole("button", { name: "Close" }).click();
        await expect.soft(note).toBeHidden({ timeout: 15_000 });
        await pill.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await pill.evaluate((el) => (el as HTMLElement).click());
        await expect.soft(note).toBeVisible({ timeout: 15_000 });
      }
      // One synchronous read (atomic, #363 B1): exactly one highlight
      // for the anchor, zero inline glyphs, and the pill count unchanged.
      const after = await page.evaluate((id: string) => {
        const card = document.querySelector("#C-problem");
        return {
          marks: card?.querySelectorAll(`mark.anc[data-thr="${id}"]:not(.fnote)`).length ?? -1,
          glyphs: card?.querySelectorAll("svg.thg").length ?? -1,
        };
      }, noteId);
      expect.soft(after.marks).toBe(1);
      expect.soft(after.glyphs).toBe(0);
      await expect.soft(pill).toHaveText(countBefore, { timeout: 10_000 });
    });

    await test.step("a list block gets the same unclipped margin pill, no bubble (#374)", async () => {
      const snapRes = await apiJson(s, "GET", `/api/reviews/${reviewId}`);
      const snap = snapRes.json as {
        pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      };
      const buildup = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "buildup");
      const listBlock = buildup?.blocks.find((b) => b.id === "b2");
      if (!buildup || !listBlock) throw new Error("no buildup list block");
      const made = await apiJson(s, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId: `${buildup.id}#${listBlock.id}` },
        quote: "They return early when a value has no CRLF.",
        text: "List note",
      });
      expect(made.status).toBe(201);
      const listId = (made.json as { id: string }).id;
      const listPill = page.locator(`#C-buildup [data-thr-margin~="${listId}"]`);
      await expect.soft(listPill).toBeVisible({ timeout: 15_000 });
      await expect.soft(listPill).toHaveAttribute("data-tip", "1 thread");
      const geom = await listPill.evaluate((el) => {
        const box = (r: DOMRect): { top: number; left: number; bottom: number; right: number } => ({
          top: r.top,
          left: r.left,
          bottom: r.bottom,
          right: r.right,
        });
        const card = el.closest("section.ui-card");
        const pill = box(el.getBoundingClientRect());
        const cardBox = card instanceof Element ? box(card.getBoundingClientRect()) : null;
        const glyph = el.querySelector(":scope > svg.ic");
        const count = el.querySelector(":scope > .tmargin-n");
        const glyphBox = glyph instanceof Element ? box(glyph.getBoundingClientRect()) : null;
        const countBox = count instanceof Element ? box(count.getBoundingClientRect()) : null;
        return {
          pill,
          card: cardBox,
          glyph: glyphBox,
          count: countBox,
          bubbles: card instanceof Element ? card.querySelectorAll(".lk.cm[data-threads]").length : -1,
        };
      });
      if (geom.card) {
        expect.soft(geom.pill.left >= geom.card.left, `list pill left ${Math.round(geom.pill.left)} inside card ${Math.round(geom.card.left)}`).toBe(true);
        expect.soft(geom.pill.right <= geom.card.right, `list pill right ${Math.round(geom.pill.right)} inside card ${Math.round(geom.card.right)}`).toBe(true);
      }
      if (geom.glyph && geom.count) {
        const overlap =
          geom.glyph.left < geom.count.right && geom.count.left < geom.glyph.right && geom.glyph.top < geom.count.bottom && geom.count.top < geom.glyph.bottom;
        expect.soft(overlap).toBe(false);
      }
      expect.soft(geom.bubbles).toBe(0);
    });

    await test.step("per-reply Delete tombstones the turn; Undelete restores it", async () => {
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      const beforeDel = await threads(s, reviewId);
      const explainReply = beforeDel.find((t) => t.id === threadId)!.replies.find((r) => r.kind === "explain")!;
      const turns = mine.locator(':scope > .turn');
      await expect.soft(turns).toHaveCount(3, { timeout: 30_000 });
      const second = turns.nth(1);
      await second.hover();
      // "Delete reply" is the per-reply name (#364: distinct from the
      // thread-level "Delete thread"). No confirm appears.
      await second.getByRole("button", { name: "Delete reply" }).first().click();
      await expect
        .soft.poll(
          async () =>
            (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
              ?.deletedAt ?? 0,
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      const tomb = mine.locator(`[data-tombstone="${explainReply.id}"]`);
      await expect.soft(tomb).toBeVisible({ timeout: 15_000 });
      await expect.soft(tomb).toContainText(/Reply deleted/);
      // The tombstone survives a reload; Undelete restores the turn exactly.
      await page.reload();
      await expect.soft(page.locator(`section.ithread[data-thread="${threadId}"]`)).toBeVisible({ timeout: 30_000 });
      const tombAfter = page.locator(`[data-tombstone="${explainReply.id}"]`);
      await expect.soft(tombAfter).toBeVisible({ timeout: 15_000 });
      await tombAfter.getByRole("button", { name: "Undelete" }).click();
      await expect
        .soft.poll(
          async () =>
            (await threads(s, reviewId)).find((t) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
              ?.deletedAt,
          { timeout: 30_000 },
        )
        .toBeUndefined();
      await expect.soft(page.locator(`[data-reply="${explainReply.id}"]`)).toBeVisible({ timeout: 15_000 });
    });

    await test.step("deleting every remaining live turn deletes the thread itself", async () => {
      const mine = page.locator(`#C-problem section.ithread[data-thread="${threadId}"]`);
      // Settle each delete before the next: clicking again while the
      // tombstone patch is still in flight would wait forever on a
      // button that is about to disappear.
      for (let i = 0; i < 4; i++) {
        const snap = (await threads(s, reviewId)).find((t) => t.id === threadId);
        if (!snap) break; // thread already gone
        const liveIds = snap.replies.filter((r) => !r.deletedAt).map((r) => r.id);
        if (liveIds.length === 0) break;
        const victim = liveIds[0]!;
        // Target the server's victim by id (the DOM can lag the last
        // patch), and only a Delete the hover actually revealed: an ask
        // turn carries a second, hidden one on its question row.
        const turn = mine.locator(`:scope > .turn[data-turn="${victim}"]`);
        await expect(turn).toBeVisible({ timeout: 15_000 });
        await turn.hover();
        await turn
          .getByRole("button", { name: "Delete reply" })
          .filter({ visible: true })
          .first()
          .click({ timeout: 15_000 });
        // Either its tombstone appears, or (last live turn) the thread goes.
        await expect
          .soft.poll(async () => {
            const t = (await threads(s, reviewId)).find((t) => t.id === threadId);
            if (!t) return "gone";
            return t.replies.find((r) => r.id === victim)?.deletedAt ? "tomb" : "live";
          }, { timeout: 30_000 })
          .not.toBe("live");
      }
      await expect
        .soft.poll(async () => (await threads(s, reviewId)).find((t) => t.id === threadId), { timeout: 30_000 })
        .toBeUndefined();
      await expect.soft(page.locator(`section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 30_000 });
    });
  });

  test("reply footer: inline code chips, no label, icon reverse link (#381)", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // The seeded explain answer carries a follow-up block whose labels
    // wrap identifiers in backticks (real-service fixture content, not
    // a mock): one long (wrapping) suggestion and one short one.
    const snapRes = await apiJson(s, "GET", "/api/reviews/l4-explain");
    const anns = (
      snapRes.json as {
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
    await openReview(page, "l4-explain");
    const mine = page.locator(`section.ithread[data-thread="${seeded.id}"]`);
    await expect(mine).toBeVisible({ timeout: 30_000 });
    const footer = mine.locator(".follow").first();
    await expect(footer).toBeVisible({ timeout: 15_000 });

    await test.step("chips render inline code with no literal backticks, and no label", async () => {
      const chips = footer.locator("button");
      await expect.soft(chips).toHaveCount(2);
      const long = chips.filter({ hasText: "keep the line ending" });
      await expect.soft(long.locator("code").first()).toContainText("http.client");
      for (const chip of await chips.all()) {
        expect.soft((await chip.innerText()).includes("`")).toBe(false);
      }
      await expect.soft(footer).not.toContainText("Follow up:");
    });

    await test.step("the quoted-passage button is icon-only and still reveals the anchor", async () => {
      const rev = mine.getByRole("button", { name: "Show the quoted passage" }).first();
      await expect.soft(rev).toBeVisible();
      await expect.soft(rev).toHaveAttribute("data-src-link", /.+/);
      await rev.click();
      // The seeded quote places on the guide highlight (else the margin
      // marker's line): either way the target flashes.
      await expect.soft(page.locator("#C-problem .flash")).toBeVisible({ timeout: 15_000 });
    });
  });
});

// ---------------------------------------------------------------------------
// Slow replay service: writing and recovery steps.
// ---------------------------------------------------------------------------

test.describe("L4 ask writing and recovery (slow replay)", () => {
  let slowDir = "";
  let slow: RunningService | null = null;

  test.beforeAll(async () => {
    slowDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l4slow-data-"));
    slow = await startService(slowDir, { agent: "replay", extraEnv: SLOW_ENV, label: "l4slow" });
  });
  test.afterAll(async () => {
    await slow?.stop().catch(() => {});
    slow = null;
    rmSync(slowDir, { recursive: true, force: true });
  });

  function service(): RunningService {
    if (!slow) throw new Error("no service");
    return slow;
  }

  test("while writing: no toolbar, no reply box, pinned; then the answer lands", async ({ page }) => {
    test.setTimeout(300_000);
    const s = service();
    // Ported from the tour's writing-state scene (#203): the slow replay
    // answers after the writing frame, so the writing state is catchable.
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    // Issue #341: explain "three pieces" on the build-up card. No explain
    // pattern matches a build-up-anchored prompt, so replay answers with
    // the first explain entry (the recorded obs-fold explain) — still a
    // real recording while the writing state is captured.
    await expect(page.locator("#C-buildup")).toBeVisible({ timeout: 60_000 });
    await selectText(page, "#C-buildup", "three pieces");
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator("#C-buildup [data-thread]").first();
    await test.step("the writing card shows the header and indicator only", async () => {
      await expect.soft(card).toBeVisible({ timeout: 15_000 });
      await expect.soft(card.locator(".working")).toBeVisible({ timeout: 15_000 });
      // While writing: no answer toolbar, no reply box (#203), pinned (#204).
      await expect.soft(card).not.toHaveClass(/floating/);
      await expect.soft(card.locator(".ctl")).toHaveCount(0);
      await expect.soft(card.locator("textarea")).toHaveCount(0);
    });
    await test.step("once the answer arrives, the toolbar and reply box appear", async () => {
      await expect.soft(card.locator("[data-reply]").first()).toBeVisible({ timeout: 120_000 });
      await card.locator("[data-reply]").first().hover();
      await expect.soft(card.locator(".ctl").first()).toBeVisible({ timeout: 120_000 });
      await expect.soft(card.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
    });
  });

  test("failed follow-up shows Retry; retry lands a clean answer", async ({ page }) => {
    test.setTimeout(420_000);
    let s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    await test.step("Ask, then a follow-up killed mid-answer", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      await expect.soft(card).toBeVisible({ timeout: 30_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      await box.fill("Does a cookie header change this?");
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      // Issue #293: questions are separate entries — answers are `ask-answer`.
      // Wait for the follow-up pair to exist, then target the answer paired
      // with its question (stable under load).
      await expect.soft(card.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
      const q2 = card.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
      await expect.soft(q2).toBeVisible({ timeout: 30_000 });
      const q2Id = await q2.getAttribute("data-ask-question");
      expect(q2Id).toBeTruthy();
      const second = card.locator(`[data-ask-answer="${q2Id}"]`);
      await expect.soft(second.locator(".working")).toBeVisible({ timeout: 30_000 });
      s.killHard();
      // No fixed sleep (#363 B2): startService resolves on listening; the
      // goto + visible asserts below are the gate.
      s = await startService(slowDir, { agent: "replay", extraEnv: SLOW_ENV, label: "l4slow" });
      slow = s;
    });

    await test.step("after restart the failed turn shows the banner with Retry", async () => {
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
      const after = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      await expect.soft(after).toBeVisible({ timeout: 30_000 });
      // Wait for the reply to exist first, then target the answer paired
      // with the follow-up question (stable under load; never an index
      // into a half-rendered list).
      await expect.soft(after.locator("[data-ask-answer]")).toHaveCount(2, { timeout: 30_000 });
      const afterQ = after.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
      await expect.soft(afterQ).toBeVisible({ timeout: 30_000 });
      const afterId = await afterQ.getAttribute("data-ask-question");
      expect(afterId).toBeTruthy();
      const failed = after.locator(`[data-ask-answer="${afterId}"]`);
      await expect.soft(failed).toBeVisible({ timeout: 15_000 });
      await expect.soft(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
      await expect.soft(failed.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
      await expect.soft(failed.locator(".ctl")).toHaveCount(0);
    });

    await test.step("Retry refills the same turn with a clean answer", async () => {
      const after = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      const afterQ = after.locator("[data-ask-question]", { hasText: "Does a cookie header change this?" });
      const afterId = await afterQ.getAttribute("data-ask-question");
      const failed = after.locator(`[data-ask-answer="${afterId}"]`);
      await failed.getByRole("button", { name: "Retry" }).click();
      // The retried answer lands as blocks with no working marker (#336:
      // the toolbar itself stays hidden until hovered).
      await expect.soft(failed.locator(".exp-b")).not.toBeEmpty({ timeout: 120_000 });
      await expect.soft(failed.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(after.getByPlaceholder(/Ask a follow-up/)).toBeVisible({ timeout: 30_000 });
      const retried = after.locator(".exp-b").nth(1);
      await expect.soft(retried).not.toBeEmpty({ timeout: 60_000 });
      await expect.soft(retried).not.toContainText('{"contribute"');
      await expect.soft(retried).not.toContainText("ann_");
      await expect.soft(after).not.toContainText("no failed turn");
      // Any toast (e.g. from the retry) carries plain words, never an internal id.
      const toast = page.locator("#toast");
      if ((await toast.count()) > 0) {
        await expect.soft(toast).not.toContainText("ann_");
      }
    });
  });

  test("the follow-up box keeps its input while pending; a typed draft survives failure and retry", async ({ page }) => {
    test.setTimeout(420_000);
    const s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    await test.step("while the answer fills, the box stays editable with Send disabled", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      await expect.soft(card).toBeVisible({ timeout: 30_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      await box.fill("Does a cookie header change this?");
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      // Issue #293: questions are separate entries — answers are `ask-answer`.
      const pending = card.locator("[data-ask-answer]").nth(1);
      await expect.soft(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
      await expect.soft(pending.locator(".working")).toHaveText("Writing answer");
      const draft = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(draft).toBeVisible();
      await draft.fill("What about ordering?");
      await expect.soft(draft).toHaveValue("What about ordering?");
      const send = card.getByRole("button", { name: "Reply" }).last();
      await expect.soft(send).toBeDisabled();
      await expect.soft(send).toHaveAttribute("data-tip", "Wait for the answer");
      // The pending turn has no toolbar of its own.
      await expect.soft(pending.locator(".ctl")).toHaveCount(0);
    });

    await test.step("once the answer lands, the kept draft sends as the next turn", async () => {
      const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      const pending = card.locator("[data-ask-answer]").nth(1);
      const send = card.getByRole("button", { name: "Reply" }).last();
      // (#336: landed is the answer's blocks with no working marker —
      // the reply toolbar itself stays hidden until hovered.)
      await expect.soft(pending.locator(".exp-b")).not.toBeEmpty({ timeout: 120_000 });
      await expect.soft(pending.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      await expect.soft(send).toBeEnabled({ timeout: 30_000 });
      await send.click();
      // Issue #293: the follow-up question is its own reviewer entry.
      const third = card.locator("[data-ask-question]").nth(2);
      await expect.soft(third).toContainText("What about ordering?", { timeout: 60_000 });
      await expect.soft(card.locator(".exp-b").nth(2)).not.toBeEmpty({ timeout: 60_000 });
    });
  });

  test("a draft typed while pending survives a failure and its retry", async ({ page }) => {
    test.setTimeout(420_000);
    let s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    await test.step("type the next question while the follow-up fills, then kill mid-flight", async () => {
      // Issue #341: the re-recorded central card has no "fast path" text.
      await selectText(page, "#C-central", "matches optional whitespace");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-central .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("Does the fast path still catch a fold?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator("#C-central section.ithread[data-thread]", { hasText: "Does the fast path still catch a fold" }).first();
      await expect.soft(card).toBeVisible({ timeout: 30_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(box).toBeVisible({ timeout: 30_000 });
      await box.fill("And a bare LF?");
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      const pending = card.locator("[data-reply]").last();
      await expect.soft(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
      const draft = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(draft).toBeVisible();
      await draft.fill("One more thing about folds?");
      // The client shows working at once; kill only once the server-side
      // turn is filling AND the typed draft has reached the server (the
      // box debounces its persist), so the restart reliably marks the
      // turn failed with the draft stored.
      await expect
        .soft.poll(
          async () => {
            const snap = (await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as {
              annotations?: {
                reply?: string;
                replies?: { question: string | null; working: string | null }[];
              }[];
            };
            const anns = snap.annotations ?? [];
            const filling = anns
              .flatMap((a) => a.replies ?? [])
              .some((t) => t.question === "And a bare LF?" && t.working !== null);
            const drafted = anns.some((a) => (a as { followupDraft?: string }).followupDraft === "One more thing about folds?");
            return filling && drafted;
          },
          { timeout: 60_000 },
        )
        .toBe(true);
      s.killHard();
      s = await startService(slowDir, { agent: "replay", extraEnv: SLOW_ENV, label: "l4slow" });
      slow = s;
    });

    await test.step("after restart the failed banner governs; retry keeps the draft", async () => {
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 60_000 });
      const after = page.locator("#C-central section.ithread[data-thread]", { hasText: "Does the fast path still catch a fold" }).first();
      await expect.soft(after).toBeVisible({ timeout: 30_000 });
      // Failed: the banner with Retry governs, and the box stays hidden.
      const failed = after.locator("[data-reply]").last();
      await expect.soft(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
      await expect.soft(after.getByPlaceholder(/Ask a follow-up/)).toHaveCount(0);
      // Retry lands the answer; the box comes back with the kept draft.
      // (#336: landed is blocks with no working marker.)
      await failed.getByRole("button", { name: "Retry" }).click();
      await expect.soft(failed.locator(".exp-b")).not.toBeEmpty({ timeout: 120_000 });
      await expect.soft(failed.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      const kept = after.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(kept).toBeVisible({ timeout: 30_000 });
      await expect.soft(kept).toHaveValue("One more thing about folds?", { timeout: 30_000 });
    });
  });

  test("closed mid-answer, failed, reopened: banner and Retry, then a clean answer", async ({ page }) => {
    test.setTimeout(420_000);
    let s = service();
    const reviewId = await createDemoReview(s);
    await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    let annotationId = "";
    await test.step("Ask, close the thread while its follow-up fills, then kill", async () => {
      await selectText(page, "#C-problem", "folded");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect.soft(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("What is line folding?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      await expect.soft(card).toBeVisible({ timeout: 30_000 });
      await expect.soft(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const snap = (await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as {
        annotations?: { id: string; replies?: { question: string | null }[] }[];
      };
      annotationId = (snap.annotations ?? []).find((a) => (a.replies ?? [])[0]?.question === "What is line folding?")?.id ?? "";
      expect(annotationId).toBeTruthy();
      const box = card.getByPlaceholder(/Ask a follow-up/);
      await expect.soft(box).toBeVisible({ timeout: 15_000 });
      await box.fill("Does a cookie header change this?");
      await card.getByRole("button", { name: /ask|send|reply/i }).last().click();
      // Issue #293: questions are separate entries — answers are `ask-answer`.
      const pending = card.locator("[data-ask-answer]").nth(1);
      await expect.soft(pending.locator(".working")).toBeVisible({ timeout: 30_000 });
      // Kill only once the server-side turn is filling, so the restart
      // reliably marks it failed.
      await expect
        .soft.poll(
          async () => {
            const cur = (await apiJson(s, "GET", `/api/reviews/${reviewId}`)).json as {
              annotations?: { id: string; replies?: { question: string | null; working: string | null }[] }[];
            };
            const turns = (cur.annotations ?? []).find((a) => a.id === annotationId)?.replies ?? [];
            return turns.some((t) => t.question === "Does a cookie header change this?" && t.working !== null);
          },
          { timeout: 30_000 },
        )
        .toBe(true);
      await card.getByRole("button", { name: "Close" }).click();
      await expect.soft(card).toBeHidden({ timeout: 15_000 });
      s.killHard();
      s = await startService(slowDir, { agent: "replay", extraEnv: SLOW_ENV, label: "l4slow" });
      slow = s;
    });

    await test.step("reopen through the mark: the failed turn shows banner + Retry, then Retry heals", async () => {
      await page.goto(`${s.origin}/review/${reviewId}?token=${s.token}`);
      await expect(page.locator("#C-problem")).toBeVisible({ timeout: 60_000 });
      await page.locator(`mark.anc.exl[data-jump="${annotationId}"]`).first().click();
      const after = page.locator("#C-problem section.ithread[data-thread]", { hasText: "What is line folding?" }).first();
      await expect.soft(after).toBeVisible({ timeout: 30_000 });
      const failed = after.locator("[data-ask-answer]").nth(1);
      await expect.soft(failed.getByRole("alert")).toContainText("Couldn't get an answer", { timeout: 30_000 });
      await expect.soft(after.locator(".working")).toHaveCount(0);
      await expect.soft(failed.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
      // Retry gives a clean answer: no raw trailing block, no internal ids.
      // (#336: landed is blocks with no working marker, not .ctl visibility.)
      await failed.getByRole("button", { name: "Retry" }).click();
      await expect.soft(failed.locator(".exp-b")).not.toBeEmpty({ timeout: 120_000 });
      await expect.soft(failed.locator(".working")).toHaveCount(0, { timeout: 30_000 });
      const retried = after.locator(".exp-b").nth(1);
      await expect.soft(retried).not.toBeEmpty({ timeout: 60_000 });
      await expect.soft(retried).not.toContainText('{"contribute"');
      await expect.soft(after).not.toContainText("no failed turn");
    });
  });
});

// ---------------------------------------------------------------------------
// Agent:none service: the no-agent state.
// ---------------------------------------------------------------------------

test.describe("L4 no-agent state", () => {
  let dataDir = "";
  let svc: RunningService | null = null;

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-l4none-data-"));
    svc = await startService(dataDir, { agent: "none", label: "l4none" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    svc = null;
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("agent controls fail visibly, plain controls keep working", async ({ page }) => {
    test.setTimeout(300_000);
    const s = svc;
    if (!s) throw new Error("no service");
    const created = await apiJson(s, "POST", "/api/reviews", { repoId: "demo" });
    const noneId = (created.json as { review: { id: string } }).review.id;
    await page.goto(`${s.origin}/review/${noneId}?token=${s.token}`);
    await expect(page.locator("#right")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 30_000 });

    await test.step("Explain with no agent fails with the no-agent copy", async () => {
      const hasGuide = (await page.locator("#C-central").count()) > 0;
      if (hasGuide) {
        await selectText(page, "#C-central", "the");
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#C-central section.ithread[data-thread]").first();
        await expect.soft(exp).toBeVisible({ timeout: 15_000 });
        await expect.soft(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      } else {
        const cell = page.locator("#right table.diff td.c").first();
        await expect.soft(cell).toBeVisible({ timeout: 30_000 });
        const text = (await cell.innerText()).slice(0, 12) || "test";
        await selectText(page, "#right table.diff", text.slice(0, 6));
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#right [data-thread]").first();
        await expect.soft(exp).toBeVisible({ timeout: 15_000 });
        await expect.soft(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      }
    });

    await test.step("plain controls keep working", async () => {
      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect.soft(page.locator("#right .desc, #right .dbar").first()).toBeVisible({ timeout: 10_000 });
      await expect.soft(page.locator("#toast")).toBeHidden({ timeout: 3000 }).catch(() => {});
    });
  });
});
