/** J2 (#188): Explain, Ask, follow-up, nested card — replay. */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "../network-guard.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { selectText } from "../select-text.js";
import type { Locator } from "@playwright/test";
import { apiJson, createDemoReview, createSeededDemoReview } from "./journey-helpers.js";

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

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

test.describe("J2 explain ask follow-up nested", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  // Seeded (#257): the finished demo snapshot is seeded straight into the
  // store, so no replay fill wait is needed. The depth tests below need
  // fresh reviews (earlier cards would capture the unscoped clicks), so
  // their reviews are seeded up front under their own ids.
  const FRESH_DEPTH_ID = "j2-depth-seed";
  const FRESH_CONV_ID = "j2-conv-seed";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-data-"));
    reviewId = createSeededDemoReview(dataDir, "j2-seed");
    createSeededDemoReview(dataDir, FRESH_DEPTH_ID);
    createSeededDemoReview(dataDir, FRESH_CONV_ID);
    svc = await startService(dataDir, { agent: "replay" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("explain, ask with follow-up, nested explain, depth", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Moved from comments.spec.ts (#258): a partial selection snaps to
    // whole words (the toolbar quotes "optional", not "ptional").
    const snapped = await selectText(page, "#C-central", "ptional", 0, 7);
    expect(snapped).toBe("optional");
    await page.keyboard.press("Escape");

    // Explain selected guide text; exactly one working indicator while it streams.
    // ("optional whitespace" is card-only, so a fresh thread opens.)
    const beforeExp = ((await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { annotations: { id: string }[] }).annotations.map((a) => a.id);
    await selectText(page, "#C-central", "optional whitespace");
    await page.locator('#selbar [data-act="explain"]').click();
    let expId: string | null = null;
    {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
        const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
        expId = ids.find((id) => !beforeExp.includes(id)) ?? null;
        if (expId || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!expId) throw new Error("new explain thread did not appear");
    const exp = page.locator(`#C-central section.ithread[data-thread="${expId}"]`).first();
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });
    await expect(exp.locator(".working")).toHaveCount(0, { timeout: 30_000 });

    // In-thread (reworked #273, was nested): select text inside the reply
    // and Explain again — the answer appends as a reply in the same thread.
    const threadId = expId;
    const word = await exp.locator(".exp-b").first().evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "");
    expect(word).not.toBe("");
    await selectText(page, `#C-central section.ithread[data-thread="${threadId}"] .exp-b`, word);
    await page.locator('#selbar [data-act="explain"]').click();
    // Same thread gains a second agent reply (flat, never nested boxes).
    await expect
      .poll(async () => exp.locator('[data-reply][data-kind="explain"], [data-reply][data-kind="ask"]').count(), { timeout: 90_000 })
      .toBeGreaterThanOrEqual(2);
    await expect(exp.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 60_000 });
    // The source reply hyperlinks to the new reply.
    await expect(exp.locator('button.rlink[data-replylink]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`#C-central section.ithread[data-thread="${threadId}"]`)).toHaveCount(1);

    // Depth change rewrites the parent answer (visible change, not empty).
    const beforeDepth = await exp.locator(".exp-b").first().innerText();
    await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
    await expect.poll(async () => exp.locator(".exp-b").first().innerText(), { timeout: 60_000 }).not.toBe(beforeDepth);

    // Ask on guide text, then a follow-up in the same card.
    await selectText(page, "#C-problem", "folded");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-problem .ithread[data-pending-thread]");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("What is line folding?");
    const beforeAsk = ((await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { annotations: { id: string }[] }).annotations.map((a) => a.id);
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator('#C-problem section.ithread[data-thread]:has([data-kind="ask"])', { hasText: "What is line folding?" });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    let cardId: string | null = null;
    {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
        const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
        cardId = ids.find((id) => !beforeAsk.includes(id)) ?? null;
        if (cardId || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!cardId) throw new Error("new ask thread did not appear");
    await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
    await expect(card.locator(".lk[data-refs]").first()).toBeVisible({ timeout: 30_000 });

    // Follow-up: use the card's reply box if present; otherwise its suggestion.
    const replyBox = card.locator("textarea").first();
    if ((await replyBox.count()) > 0) {
      await replyBox.fill("Should a bare LF not followed by whitespace also be normalized, or is leaving it correct?");
      // Issue #364: per-reply Delete buttons also match /reply/i — the
      // send is the Reply box's own button, matched exactly.
      const send = card.getByRole("button", { name: "Reply", exact: true });
      await send.click();
      await expect(card.locator(".exp-b").last()).not.toBeEmpty({ timeout: 60_000 });
    }

    // #204: the Ask card opened pinned inline — no floating class, no
    // pin/unpin control — and its persisted state says pinned.
    await expect(card).not.toHaveClass(/floating/);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
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
    await card.getByRole("button", { name: "Delete thread" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
    await page.reload();
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(`#C-problem mark.anc.exl[data-jump="${cardId}"]:not(.fnote)`)).toHaveCount(0);
  });

  test("diff pane: explain opens pinned; close, mark, reopen, delete (#204)", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 15_000 });

    // Create via API (avoids quote ambiguity with the seeded suggestion
    // on the same line; the UI pinned/close/mark/reopen/delete flow below
    // is what this test covers, and the toolbar path is covered elsewhere).
    // First resolve the diff fileKey for conn.
    const snap0 = (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { files: { fileKey: string; path: string }[] };
    const connFile = (snap0.files ?? []).find((f) => f.path.includes("conn")) ?? (snap0.files ?? [])[0];
    const mk = await apiJson(svc!, "POST", `/api/reviews/${reviewId}/actions`, {
      kind: "explain",
      quote: "_OBSOLETE_FOLD_RE",
      anchor: { where: "diff-line", fileKey: connFile.fileKey, line: 82 },
    });
    const cardId: string = (mk.json as { annotationId: string }).annotationId;
    if (!cardId) throw new Error("new diff thread did not appear");
    // Wait for the reply to fill so .exp-b is non-empty.
    {
      const deadline = Date.now() + 90_000;
      for (;;) {
        const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
        const anns = ((res.json as { annotations: { id: string; replies: { blocks: unknown[] }[] }[] }).annotations ?? []);
        const mine = anns.find((a) => a.id === cardId);
        if ((mine?.replies?.[0]?.blocks.length ?? 0) > 0 || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const card = page.locator(`.dhunk section.ithread[data-thread="${cardId}"]`).first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });
    // Pinned inline in the diff too: no floating overlay, no pin control.
    await expect(card).not.toHaveClass(/floating/);
    await expect(page.locator(".dhunk .exp-float")).toHaveCount(0);
    await expect(card.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);
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
    await card.getByRole("button", { name: "Delete thread" }).click();
    await expect(card).toHaveCount(0, { timeout: 15_000 });
    await expect(mark).toHaveCount(0, { timeout: 15_000 });
  });

  // From comments.spec.ts (#357): an Ask thread and a comment share one
  // diff line — both render side by side, neither hides the other.
  test("an Ask thread and a comment share one diff line", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    // Plain first paint (?nohl=1) keeps code text in whole nodes so the
    // single-range selection helper works on diff code.
    await page.goto(`${svc.origin}/review/${reviewId}?nohl=1&token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const snap = (await apiJson(svc!, "GET", `/api/reviews/${reviewId}`)).json as { files: { fileKey: string; path: string }[] };
    const conn = (snap.files ?? []).find((f) => f.path.includes("conn")) ?? (snap.files ?? [])[0];
    const file = `[id="F-${conn.fileKey}"]`;
    await expect(page.locator(`${file} table.diff`).first()).toBeVisible({ timeout: 15_000 });
    await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator(`${file} .ithread[data-pending-thread]`);
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.locator("textarea").fill("Why here?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const thread = page.locator(`${file} section.ithread[data-thread]`, { hasText: "Why here?" });
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator(".exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
    // A Comment on the same selection: both threads render side by
    // side under the line — neither hides the other.
    await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
    await page.locator('#selbar [data-act="note"]').click();
    const noteComposer = page.locator(`${file} .ithread[data-pending-thread]`);
    await expect(noteComposer).toBeVisible({ timeout: 10_000 });
    await noteComposer.locator("textarea").fill("A note here.");
    await noteComposer.getByRole("button", { name: "Save" }).click();
    const note = page.locator(`${file} .ithread[data-thread]`, { hasText: "A note here." });
    await expect(note).toBeVisible({ timeout: 30_000 });
    await expect(thread).toBeVisible();
    await expect(thread.locator('[data-reply][data-kind="ask"]')).toHaveCount(1);
    await expect(note.locator('[data-reply][data-kind="comment"]')).toHaveCount(1);
  });

  // From selection-scroll.spec.ts (#357 #147): an app-initiated scroll
  // just after selection keeps the toolbar; a later scroll hides it.
  test("app-initiated scroll just after selection keeps the toolbar; a later scroll hides it (#147)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    await selectText(page, "#C-central", "optional whitespace");
    const bar = page.locator("#selbar");
    await expect(bar).toBeVisible({ timeout: 10_000 });
    // App-initiated scroll immediately after the bar shows: it stays.
    await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
    await page.waitForTimeout(150);
    await expect(bar).toBeVisible();
    // Past the grace window a scroll hides it as before.
    await page.waitForTimeout(600);
    await page.locator("#page").evaluate((el) => el.scrollBy(0, 200));
    await expect(bar).toBeHidden({ timeout: 5_000 });
  });

  // Merged from ask-service.spec.ts (#256): the Ask answer arrives as
  // blocks with citation markers through the streamed patch path (never
  // the old 60 s waiting fallback, never raw thread HTML), and streamed
  // agent text never renders (issue #46: fixed label only).
  test("ask answers with citations through the streamed patch path, no streamed text", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
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
    await selectText(page, "#C-central", "original message");
    await page.locator('#selbar [data-act="ask"]').click();
    const composer = page.locator("#C-central .ithread[data-pending-thread]");
    await expect(composer).toBeVisible();
    await composer.locator("textarea").fill("Should a bare LF not followed by whitespace also be normalized, or is leaving it correct?");
    await composer.getByRole("button", { name: "Ask" }).click();
    const card = page.locator('#C-central section.ithread[data-thread]:has([data-kind="ask"])', {
      hasText: "Should a bare LF not followed by whitespace",
    });
    await expect(card.first()).toBeVisible({ timeout: 30_000 });
    // Issue #293: the question is a reviewer entry, not a muted heading.
    await expect(card.locator("[data-ask-question]").first()).toContainText("Should a bare LF not followed by whitespace", {
      timeout: 30_000,
    });
    await expect(card.locator("[data-ask-answer] .ans-q")).toHaveCount(0);
    const marker = card.locator(".lk[data-refs]");
    await expect(marker.first()).toBeVisible({ timeout: 30_000 });
    await expect(marker.first()).toHaveAttribute("data-refs", /diff:/);
    await expect(card.locator(".working")).toHaveCount(0);
    const seen = await page.evaluate(
      () => (window as unknown as { __m4seen?: { working: boolean; stream: boolean } }).__m4seen,
    );
    expect(seen?.working).toBe(true);
    expect(seen?.stream).toBe(false);
  });

  // Merged from depth-principle-service.spec.ts (#256, PRD §4.4): on a
  // page card and on a conversation card, stepping to the deepest level
  // then pressing + adds exactly one "Underlying principle" block;
  // pressing + again adds nothing and tells the user; undo removes it.
  // The deep fixture recordings carry the principle; the service adds it
  // only on + at the deepest level, never on the normal standard→deep step.
  function principleLocator(scope: Locator) {
    return scope.locator(".blk.gen-aside", { hasText: "Underlying principle" });
  }

  async function stepToDeep(card: Locator): Promise<void> {
    for (let i = 0; i < 3; i++) {
      const principles = await principleLocator(card).count();
      if (principles > 0) break;
      const pips = card.locator(".pips i.on");
      const pipsBefore = await pips.count();
      await card.getByRole("button", { name: "Deeper" }).click();
      await expect
        .poll(
          async () => ((await principleLocator(card).count()) > 0 ? -1 : await pips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(pipsBefore);
      if ((await principleLocator(card).count()) > 0) {
        await card.getByRole("button", { name: "Undo" }).click();
        await expect(principleLocator(card)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
      if (i >= 1) break;
    }
  }

  test("page card: + at deepest adds one principle; + again tells; undo removes", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    // Fresh review: earlier tests in this file leave cards on the shared
    // review whose own Deeper buttons would capture the unscoped clicks.
    const freshId = FRESH_DEPTH_ID;
    await page.goto(`${svc.origin}/review/${freshId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
    const card = page.locator("#C-central");

    await stepToDeep(card);
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });

    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 60_000 });
    await expect(principleLocator(card).first()).toContainText("Underlying principle");

    await card.getByRole("button", { name: "Deeper" }).click();
    await expect(principleLocator(card)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    await card.getByRole("button", { name: "Undo" }).click();
    await expect(principleLocator(card)).toHaveCount(0, { timeout: 10_000 });
  });

  test("conversation card: same principle flow", async ({ page }) => {
    test.setTimeout(300_000);
    if (!svc) throw new Error("no service");
    // Fresh review: the page-card test above leaves its own state behind.
    const freshId = FRESH_CONV_ID;
    await page.goto(`${svc.origin}/review/${freshId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    const snap = await apiJson(svc, "GET", `/api/reviews/${freshId}`);
    const central = ((snap.json as { pages: { id: string; cards: { id: string; blocks: { id: string; type: string; text?: { standard: string } }[] }[] }[] }).pages ?? [])
      .find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const paras = (central?.blocks ?? []).filter((b) => b.type === "paragraph" && b.text?.standard);
    const host = paras.find((b) => b.text!.standard.includes("agree")) ?? paras[0];
    if (!host?.text) throw new Error("central has no paragraph blocks");
    const quote = host.text.standard.includes("agree")
      ? "so the message and urllib3's HTTPHeaderDict agree"
      : host.text.standard.slice(0, 12);
    const created = await apiJson(svc, "POST", `/api/reviews/${freshId}/actions`, {
      kind: "explain",
      quote,
      anchor: { where: "block", blockId: `central#${host.id}` },
    });
    const annId = (created.json as { annotationId: string; jobId?: string }).annotationId;
    if ((created.json as { jobId?: string }).jobId) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const cur = await apiJson(svc, "GET", `/api/reviews/${freshId}`);
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

    for (let i = 0; i < 2; i++) {
      const expPips = exp.locator(".pips i.on");
      const expPipsBefore = await expPips.count();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect
        .poll(
          async () => ((await principleLocator(exp).count()) > 0 ? -1 : await expPips.count()),
          { timeout: 60_000 },
        )
        .not.toBe(expPipsBefore);
      if ((await principleLocator(exp).count()) > 0) {
        await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
        await expect(principleLocator(exp)).toHaveCount(0, { timeout: 30_000 });
        break;
      }
    }
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });

    await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 60_000 });

    await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
    await expect(principleLocator(exp)).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator("#toast")).toContainText(/deepest|nothing more/i, { timeout: 10_000 });

    await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
    await expect(principleLocator(exp)).toHaveCount(0, { timeout: 10_000 });
  });

  // Merged from interaction-none-service.spec.ts (#256): with
  // UNVIBE_AGENT unset (no agent), every agent control shows the
  // no-agent state while non-agent controls keep working.
  test("no-agent state: agent controls fail visibly, plain controls work", async ({ page }) => {
    test.setTimeout(300_000);
    const noneData = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-none-"));
    let noneSvc: RunningService | null = null;
    try {
      noneSvc = await startService(noneData);
      const created = await apiJson(noneSvc, "POST", "/api/reviews", { repoId: "demo" });
      const noneId = (created.json as { review: { id: string } }).review.id;
      await page.goto(`${noneSvc.origin}/review/${noneId}?token=${noneSvc.token}`);
      await expect(page.locator("#right")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 30_000 });

      const hasGuide = (await page.locator("#C-central").count()) > 0;
      if (hasGuide) {
        await selectText(page, "#C-central", "the");
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#C-central section.ithread[data-thread]").first();
        await expect(exp).toBeVisible({ timeout: 15_000 });
        await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      } else {
        const cell = page.locator("#right table.diff td.c").first();
        await expect(cell).toBeVisible({ timeout: 30_000 });
        const text = (await cell.innerText()).slice(0, 12) || "test";
        await selectText(page, "#right table.diff", text.slice(0, 6));
        await page.locator('#selbar [data-act="explain"]').click();
        const exp = page.locator("#right [data-thread]").first();
        await expect(exp).toBeVisible({ timeout: 15_000 });
        await expect(exp).toContainText(/agent is turned off/i, { timeout: 30_000 });
      }

      await page.locator('#right [role="tab"]').getByText("PR description").click();
      await expect(page.locator("#right .desc, #right .dbar").first()).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("#toast")).toBeHidden({ timeout: 3000 }).catch(() => {});
    } finally {
      await noneSvc?.stop().catch(() => {});
      rmSync(noneData, { recursive: true, force: true });
    }
  });
});

// Merged from expansion-nesting-service.spec.ts and
// interaction-journey-service.spec.ts (#256). Both flows select guide
// text, so each runs on its own fresh replay review: earlier cards on a
// shared review would capture the text selection and the toolbar.
test.describe("J2 nested and full reader journey (fresh reviews)", () => {
  test("in-thread explanation survives reload with its highlight (reworked #273, was nested)", async ({ page }) => {
    test.setTimeout(300_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-nesting-data-"));
    let svc: RunningService | null = null;
    try {
      const reviewId = createSeededDemoReview(dataDir, "j2-nesting-seed");
      svc = await startService(dataDir, { agent: "replay" });
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(String(err)));
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30_000,
      });
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

      // Parent explanation on card-unique text (avoids the seeded thread).
      await selectText(page, "#C-central", "optional whitespace");
      await page.locator('#selbar [data-act="explain"]').click();
      let parentId: string | null = null;
      {
        const deadline = Date.now() + 60_000;
        for (;;) {
          const res = await apiJson(svc!, "GET", `/api/reviews/${reviewId}`);
          const ids = ((res.json as { annotations: { id: string }[] }).annotations ?? []).map((a) => a.id);
          parentId = ids[ids.length - 1] ?? null;
          if (parentId || Date.now() > deadline) break;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!parentId) throw new Error("parent thread did not appear");
      const parent = page.locator(`#C-central section.ithread[data-thread="${parentId}"]`).first();
      await expect(parent).toBeVisible({ timeout: 15_000 });
      await expect(parent.locator(".exp-b")).not.toBeEmpty({ timeout: 60_000 });

      // The toolbar appears for text selected inside the parent reply…
      const word = await parent.locator(".exp-b").first().evaluate((el) => (el.textContent ?? "").match(/[A-Za-z]{4,}/)?.[0] ?? "");
      expect(word).not.toBe("");
      await selectText(page, `#C-central section.ithread[data-thread="${parentId}"] .exp-b`, word);
      // …and Explain appends a reply in the same thread (flat, never nested).
      await page.locator('#selbar [data-act="explain"]').click();
      await expect
        .poll(async () => parent.locator('[data-reply][data-kind="explain"]').count(), { timeout: 90_000 })
        .toBeGreaterThanOrEqual(2);
      await expect(parent.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 60_000 });

      // Reload: the thread survives with both replies and the highlight returns.
      await page.reload();
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });
      const parentAfter = page.locator(`#C-central section.ithread[data-thread="${parentId}"]`).first();
      await expect(parentAfter).toBeVisible({ timeout: 15_000 });
      await expect(parentAfter.locator('[data-reply][data-kind="explain"]')).toHaveCount(2, { timeout: 30_000 });
      await expect(parentAfter.locator('[data-reply] .exp-b').nth(1)).not.toBeEmpty({ timeout: 30_000 });
      await expect(page.locator(`#C-central mark.anc.ex[data-jump="${parentId}"]`).first()).toBeVisible({ timeout: 10_000 });

      expect(errors).toEqual([]);
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("reader journey: depth, examples, undo, open as page, ask, go-deeper, contents", async ({ page }) => {
    test.setTimeout(300_000);
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j2-journey-data-"));
    let svc: RunningService | null = null;
    try {
      // Replay (#257): asserts the pipeline's auto-written go-deeper cards
      // (collapsed until opened) and a pending Generate, which only the
      // live pipeline produces.
      svc = await startService(dataDir, { agent: "replay" });
      const reviewId = await createDemoReview(svc);
      await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
      await expect(page.locator("#page .doc h1.title")).toContainText("Unfold obsolete folded response headers", {
        timeout: 30_000,
      });
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

      // Explain selected guide text; the expansion fills with streamed text.
      await selectText(page, "#C-central", "matches optional whitespace, then CRLF");
      await page.locator('#selbar [data-act="explain"]').click();
      const exp = page.locator("#C-central section.ithread[data-thread]").first();
      await expect(exp).toBeVisible({ timeout: 15_000 });
      await expect(exp.locator(".exp-b")).toContainText(/fold|helper|space/i, { timeout: 60_000 });

      // Depth + on the fresh expansion generates via the agent, then −
      // (instant): the body text is rewritten each step.
      const expBody = exp.locator(".exp-b");
      const explained = await expBody.innerText();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Deeper");
      await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(explained);
      await expect(exp.locator(".working")).toHaveCount(0, { timeout: 60_000 });
      await expect(expBody).not.toBeEmpty({ timeout: 10_000 });
      const deepened = await expBody.innerText();
      await clickReplyControl(exp.locator("[data-reply]").first(), "Simpler");
      await expect.poll(async () => expBody.innerText(), { timeout: 60_000 }).not.toBe(deepened);
      await expect(expBody).not.toBeEmpty();

      // Use examples on the guide card (the thread answers carry no Example
      // asides in this recording), then Undo removes the inserted aside.
      // .first(): the card's own controls precede the nested thread's.
      const centralCard = page.locator("#C-central");
      await centralCard.getByRole("button", { name: "Use examples" }).first().click();
      const guideAside = centralCard.locator(".gen-aside").first();
      await expect(guideAside).toBeVisible({ timeout: 60_000 });
      await expect(guideAside).toContainText(/mixed SP\/HTAB|one fold/i, { timeout: 10_000 });
      await centralCard.getByRole("button", { name: "Undo" }).first().click();
      await expect(centralCard.locator(".gen-aside")).toHaveCount(0, { timeout: 10_000 });
      // Undo reverts the Simpler step: the deeper text returns.
      await clickReplyControl(exp.locator("[data-reply]").first(), "Undo");
      await expect.poll(async () => expBody.innerText(), { timeout: 30_000 }).toBe(deepened);

      // Close → dotted link → hover preview → click re-expands.
      await exp.getByRole("button", { name: "Close" }).click();
      await expect(page.locator("#C-central section.ithread[data-thread]").first()).toHaveCount(0, { timeout: 10_000 });
      const mark = page.locator("#C-central mark.anc.exl").first();
      await expect(mark).toBeVisible({ timeout: 10_000 });
      await mark.hover();
      await expect(page.locator("#pop")).toBeVisible({ timeout: 5000 });
      await page.keyboard.press("Escape");
      await mark.click();
      await expect(page.locator("#C-central section.ithread[data-thread]").first()).toBeVisible({ timeout: 10_000 });

      // Open as page, then back.
      await page.locator("#C-central section.ithread[data-thread]").first().getByRole("button", { name: "Open as page" }).click();
      await expect(page).toHaveURL(/\/page\/p-/, { timeout: 15_000 });
      await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete", { timeout: 10_000 });
      await page.goBack();
      await expect(page.locator("#C-central")).toBeVisible({ timeout: 15_000 });

      // Ask on another block; the answer arrives as blocks with citations;
      // clicking one reveals the diff with a highlight.
      await selectText(page, "#C-problem", "re-emit raw CRLF");
      await page.locator('#selbar [data-act="ask"]').click();
      const composer = page.locator("#C-problem .ithread[data-pending-thread]");
      await expect(composer).toBeVisible({ timeout: 10_000 });
      await composer.locator("textarea").fill("Which downstream consumer re-emits the raw CRLF, and how does the fix stop it?");
      await composer.getByRole("button", { name: "Ask" }).click();
      const card = page.locator('#C-problem section.ithread[data-thread]:has([data-kind="ask"])', { hasText: "Which downstream consumer re-emits" });
      await expect(card.first()).toBeVisible({ timeout: 30_000 });
      await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 60_000 });
      const marker = card.locator('.lk[data-refs*="diff:"]');
      await expect(marker.first()).toBeVisible({ timeout: 30_000 });
      await marker.first().click();
      await expect(page.locator('#right [role="tab"][aria-selected="true"]')).toContainText("Diff", { timeout: 10_000 });
      // The Ask card floats above the content below it — close it before
      // reaching under it, as a reader would.
      await card.first().getByRole("button", { name: "Close" }).click();

      // Go deeper: generate when a placeholder is still pending, else the
      // filled card. The follow-up chips live in the go-deeper-filled
      // cards (#217): use a follow-up suggestion on the alt card.
      const pendings = page.locator("#page .ui-card.pend");
      for (let i = 0; i < 6 && (await pendings.count()) > 0; i++) {
        await pendings.first().getByRole("button", { name: "Generate" }).click();
        await page.waitForTimeout(2_000);
      }
      await expect(pendings).toHaveCount(0, { timeout: 120_000 });
      const flow = page.locator("#C-g-alt");
      await flow.scrollIntoViewIfNeeded();
      await expect(flow).toBeVisible({ timeout: 120_000 });
      if (await flow.evaluate((el) => el.classList.contains("collapsed"))) {
        await flow.getByRole("button", { name: "Expand" }).click();
      }
      const follow = page.locator("#C-g-alt .follow button").first();
      await expect(follow).toBeVisible({ timeout: 15_000 });
      const label = await follow.innerText();
      await follow.click();
      await expect(page.locator("#page .follow", { hasText: label })).toHaveCount(0, { timeout: 30_000 });

      // Collapse the card; Contents still lists it.
      await page.locator("#C-central > .chead").getByRole("button", { name: "Collapse" }).click();
      await expect(page.locator("#C-central")).toHaveClass(/collapsed/, { timeout: 10_000 });
      await expect(page.locator('nav.toc li [data-tocard="central"]')).toBeVisible();
      const item = page.locator("nav.toc li", { has: page.locator('[data-tocard="central"]') });
      await expect(item).toBeVisible({ timeout: 10_000 });
    } finally {
      await svc?.stop().catch(() => {});
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
