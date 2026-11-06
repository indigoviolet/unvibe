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
  /** Issue #364: soft-delete tombstone (epoch ms). */
  deletedAt?: number;
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
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
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
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(3);

    // Frame 1: several turns with bands + spacing — turn 3 at the top,
    // so its tinted band reads right under the previous turn's divider.
    const turn3 = (await threads(svc!, reviewId)).find((t) => t.id === threadId)!.replies[2]!.id;
    await page.locator(`[data-turn="${turn3}"]`).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.screenshot({ path: `${FRAMES}/turns.png` });

    // The margin icon sits on the highlight's first line; closing the
    // thread leaves the icon, and clicking it reopens the thread.
    const margin = page.locator(`[data-thr-margin="${threadId}"]`);
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
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.open ?? false, {
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
    // Frame 3: the reverse link target mid-flash. The click's own
    // smooth scroll already centers it — shoot at once, no extra scroll
    // (it would race the smooth animation and miss the ~2s flash).
    await page.screenshot({ path: `${FRAMES}/reverse-flash.png` });

    // Per-reply delete tombstones the turn (an answer goes with its
    // question — one stored turn); later turns stay. No confirm appears.
    const beforeDel = await threads(svc!, reviewId);
    const explainReply = beforeDel.find((t) => t.id === threadId)!.replies.find((r) => r.kind === "explain")!;
    const turns = mine.locator(':scope > .turn');
    await expect(turns).toHaveCount(3, { timeout: 30_000 });
    const second = turns.nth(1);
    await second.hover();
    await second.getByRole("button", { name: "Delete reply" }).first().click();
    await expect
      .poll(
        async () =>
          (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
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
          (await threads(svc!, reviewId)).find((t) => t.id === threadId)?.replies.find((r) => r.id === explainReply.id)
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
      const snap = (await threads(svc!, reviewId)).find((t) => t.id === threadId);
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
          const t = (await threads(svc!, reviewId)).find((t) => t.id === threadId);
          if (!t) return "gone";
          return t.replies.find((r) => r.id === victim)?.deletedAt ? "tomb" : "live";
        }, { timeout: 30_000 })
        .not.toBe("live");
    }
    await expect
      .poll(async () => (await threads(svc!, reviewId)).find((t) => t.id === threadId), { timeout: 30_000 })
      .toBeUndefined();
    await expect(page.locator(`section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, { timeout: 30_000 });
  });
});
