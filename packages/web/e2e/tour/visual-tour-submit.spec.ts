/**
 * Tour: comments, outbox and submit (package D re-adds the frames
 * packages C removed from the gate in #363).
 *
 * On-demand only (`mise run visual-tour`): the submit-area states the
 * owner reviews as frames — the outbox toggle, the marker open-all /
 * preview / expand / collapse states, and the whole thread-polish set
 * (rest, toolbar, followup, focused, marks, glossary/cited/hunk/comment
 * previews). Behaviour for all of these lives in
 * `e2e/journeys/l5-submit.spec.ts`; this file keeps just enough asserts
 * to prove each framed state.
 *
 * Slim set: 1440px light Default plus the `tour-matrix.ts` named keeps;
 * the full matrix runs with `UNVIBE_TOUR_MATRIX=full`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../network-guard.js";
import { cpuThrottleFromEnv } from "../cpu-throttle.js";
import { checkLayout } from "../layout-check.js";
import { hoverFresh } from "../hover-fresh.js";
import { selectText } from "../select-text.js";
import { SERVICE_ENTRY, startService, type RunningService } from "../service-harness.js";
import { apiJson, createDemoReview, createSeededDemoReview } from "../journeys/journey-helpers.js";

const SHOTS = fileURLToPath(new URL("../../visual-tour", import.meta.url));

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");
test.use({ channel: "chromium" });
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

test.describe("J339 outbox toggle on an Ask thread with a comment reply", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j339-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("Ask thread + reviewer comment toggles into the Outbox with only the comment", async ({ page }) => {
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

    const thread = page.locator("#C-problem section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.locator('[data-reply][data-kind="ask"]').first()).toBeVisible({ timeout: 60_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();

    // Agent-only so far: no Outbox toggle (questions never reach the Outbox).
    await expect(thread.getByRole("button", { name: "Add to Outbox" })).toHaveCount(0);
    await expect(thread.getByRole("button", { name: "Remove from the Outbox" })).toHaveCount(0);

    // A reviewer comment reply lands on the same thread (the replies route).
    const replied = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments/${threadId}/replies`, {
      text: "Reviewer note on the answer",
    });
    expect(replied.status).toBe(200);

    // The toggle appears and works: no error toast, flips to marked.
    const toggle = thread.getByRole("button", { name: "Add to Outbox" });
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await toggle.click();
    await expect(thread.getByRole("button", { name: "Remove from the Outbox" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#toast")).not.toContainText("Couldn't update the Outbox");

    // The comment is in the Outbox; the agent's answer text never posts.
    const outbox = await apiJson(svc, "GET", `/api/reviews/${reviewId}/outbox`);
    expect(outbox.status).toBe(200);
    expect((outbox.json as { count: number }).count).toBe(1);
    expect((outbox.json as { markdown: string }).markdown).toContain("Reviewer note on the answer");

    const preview = await apiJson(svc, "GET", `/api/reviews/${reviewId}/submit/preview`);
    expect(preview.status).toBe(200);
    const comments = (preview.json as { preview: { comments: { threadId: string; text: string }[] } }).preview.comments;
    const entry = comments.find((c) => c.threadId === threadId);
    expect(entry).toBeDefined();
    expect(entry?.text).toContain("Reviewer note on the answer");

    await page.screenshot({ path: "test-results/j339-outbox-toggle.png" });
  });
});

// ---- j9 marker describes (frames re-added) ----
test.describe("J9 comment marker opens all (#205)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j9-205-data-"));
    reviewId = createSeededDemoReview(dataDir, "j9-205-seed");
    svc = await startService(dataDir, { agent: "replay" });
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("guide and description markers open all; a preview item opens just its own", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      description?: { html?: string };
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    // Qualified `card#block`: bare block ids repeat across cards.
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    // Three unquoted comments on one guide block (the bubble marker) and
    // three on one description paragraph.
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId },
        quote: "",
        text: `Guide note ${i}`,
      });
      expect(made.status).toBe(201);
    }
    const descIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "description", paragraphId: paraId },
        quote: "",
        text: `Desc note ${i}`,
      });
      expect(made.status).toBe(201);
      const id = (made.json as { id: string }).id;
      descIds.push(id);
      // Description comments start open; close them so the marker shows.
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
    }

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Guide: clicking one preview item opens only that comment.
    const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
    await expect(gMarker).toBeVisible({ timeout: 15_000 });
    await expect(gMarker).toContainText("3");
    await hoverFresh(page, gMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop [data-open-thread]")).toHaveCount(3);
    await page.locator("#pop [data-open-thread]").nth(1).click();
    const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 2" });
    await expect(gThread2).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 1" })).toHaveCount(0);
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Guide note 3" })).toHaveCount(0);

    // Guide: close it, then the marker opens all three, stacked.
    await gThread2.getByRole("button", { name: "Close" }).click();
    await expect(gThread2).toHaveCount(0, { timeout: 10_000 });
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Guide note ${i}` })).toBeVisible({ timeout: 15_000 });
    }

    // Description: same behaviour next to a paragraph.
    await page.locator('#right [role="tab"]').getByText(/description/i).click();
    const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
    await expect(dMarker).toBeVisible({ timeout: 15_000 });
    await expect(dMarker).toContainText("3");
    await hoverFresh(page, dMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#pop [data-open-thread]")).toHaveCount(3);
    await page.locator("#pop [data-open-thread]").nth(0).click();
    const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Desc note 1" });
    await expect(dThread1).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#right .ithread[data-thread]", { hasText: "Desc note 2" })).toHaveCount(0);
    await dThread1.getByRole("button", { name: "Close" }).click();
    await expect(dThread1).toHaveCount(0, { timeout: 10_000 });
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Desc note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    void descIds;
  });
});

test.describe("J262 comment marker is a toggle (#262)", () => {
  let dataDir = "";
  let svc: RunningService | null = null;
  let reviewId = "";

  test.beforeAll(async () => {
    dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-j262-data-"));
    svc = await startService(dataDir, { agent: "replay" });
    reviewId = await createDemoReview(svc);
  });
  test.afterAll(async () => {
    await svc?.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  test("marker expands, collapses, mixed opens all; tooltip states the action", async ({ page }) => {
    test.setTimeout(240_000);
    if (!svc) throw new Error("no service");
    const snapRes = await apiJson(svc, "GET", `/api/reviews/${reviewId}`);
    const snap = snapRes.json as {
      pages?: { id: string; cards: { id: string; blocks: { id: string }[] }[] }[];
      description?: { html?: string };
    };
    const central = snap.pages?.find((p) => p.id === "root")?.cards.find((c) => c.id === "central");
    const firstBlock = central?.blocks[0]?.id;
    if (!firstBlock || !central) throw new Error("no guide block");
    const blockId = `${central.id}#${firstBlock}`;
    const paraId = snap.description?.html?.match(/id="(d-[^"]+)"/)?.[1];
    if (!paraId) throw new Error("no description paragraph");

    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "block", blockId },
        quote: "",
        text: `Toggle note ${i}`,
      });
      expect(made.status).toBe(201);
    }
    for (let i = 1; i <= 3; i++) {
      const made = await apiJson(svc, "POST", `/api/reviews/${reviewId}/comments`, {
        anchor: { where: "description", paragraphId: paraId },
        quote: "",
        text: `Toggle desc ${i}`,
      });
      expect(made.status).toBe(201);
      const id = (made.json as { id: string }).id;
      await apiJson(svc, "PATCH", `/api/reviews/${reviewId}/comments/${id}`, { open: false });
    }

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-central")).toBeVisible({ timeout: 30_000 });

    // Guide: the marker starts as "Show comments".
    const gMarker = page.locator("#C-central button.lk.cm[data-threads]");
    await expect(gMarker).toBeVisible({ timeout: 15_000 });
    await expect(gMarker).toContainText("3");
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Expand from the marker: all three open, tooltip flips.
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Hide comments");
    await page.locator("#C-central").screenshot({ path: `${SHOTS}/j262-guide-open.png` });

    // The tooltip states the collapse action.
    await hoverFresh(page, gMarker);
    await expect(page.locator("#tip")).toContainText("Hide comments", { timeout: 10_000 });
    await page.screenshot({ path: `${SHOTS}/j262-guide-tip.png` });
    await page.keyboard.press("Escape");

    // Collapse from the marker: one click closes all three.
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Mixed case: one open via its preview item, the marker opens all.
    await hoverFresh(page, gMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await page.locator("#pop [data-open-thread]").nth(1).click();
    const gThread2 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 2" });
    await expect(gThread2).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" })).toHaveCount(0);
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");
    await gMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#C-central .ithread[data-thread]", { hasText: `Toggle note ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(gMarker).toHaveAttribute("data-tip", "Hide comments");

    // Per-thread Close still works, and the marker's state follows it.
    const gThread1 = page.locator("#C-central .ithread[data-thread]", { hasText: "Toggle note 1" });
    await gThread1.getByRole("button", { name: "Close" }).click();
    await expect(gThread1).toHaveCount(0, { timeout: 10_000 });
    await expect(gMarker).toHaveAttribute("data-tip", "Show comments");

    // Description: the same toggle next to a paragraph.
    await page.locator('#right [role="tab"]').getByText(/description/i).click();
    const dMarker = page.locator("#right .desc button.lk.cm[data-threads]");
    await expect(dMarker).toBeVisible({ timeout: 15_000 });
    await expect(dMarker).toContainText("3");
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Hide comments");
    await page.locator("#right .desc").screenshot({ path: `${SHOTS}/j262-desc-open.png` });
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toHaveCount(0, { timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");

    // Description mixed case: one open, the marker opens all.
    await hoverFresh(page, dMarker);
    await expect(page.locator("#pop")).toBeVisible({ timeout: 10_000 });
    await page.locator("#pop [data-open-thread]").nth(0).click();
    const dThread1 = page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 1" });
    await expect(dThread1).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#right .ithread[data-thread]", { hasText: "Toggle desc 2" })).toHaveCount(0);
    await expect(dMarker).toHaveAttribute("data-tip", "Show comments");
    await dMarker.click();
    for (let i = 1; i <= 3; i++) {
      await expect(page.locator("#right .ithread[data-thread]", { hasText: `Toggle desc ${i}` })).toBeVisible({ timeout: 15_000 });
    }
    await expect(dMarker).toHaveAttribute("data-tip", "Hide comments");
  });
});


// ---- thread-polish-tour (frames re-added) ----
let dataDir = "";
let svc: RunningService | null = null;

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  dataDir = mkdtempSync(path.join(os.tmpdir(), "unvibe-polish-tour-data-"));
  svc = await startService(dataDir, { agent: "replay" });
});

test.afterAll(async () => {
  await svc?.stop().catch(() => {});
  svc = null;
  rmSync(dataDir, { recursive: true, force: true });
});

async function shot(page: import("@playwright/test").Page, name: string, suffix: string): Promise<void> {
  await checkLayout(page, name);
  await page.screenshot({ path: path.join(SHOTS, `${name}-${suffix}.png`) });
}

/** Pick a guide paragraph holding a glossary term (and code when there is
 * one), and select the thread quote inside it: across the code boundary
 * when the paragraph has inline code (#303), else plain words. Returns the
 * paragraph selector for the at-rest frame. */
async function selectThreadQuote(page: import("@playwright/test").Page): Promise<string> {
  const para = await page.evaluate(() => {
    const cands = [...document.querySelectorAll("#page p.sel")].filter((p) =>
      p.querySelector("a.gx[data-glossary]"),
    );
    const pick = (cands.length > 0 ? cands : [...document.querySelectorAll("#page p.sel")])[0];
    if (!pick) return null;
    pick.scrollIntoView({ block: "center" });
    pick.setAttribute("data-polish-para", "1");
    return 'p.sel[data-polish-para="1"]';
  });
  if (!para) throw new Error("no guide paragraph to thread");
  const quote = await page.evaluate((sel: string) => {
    const p = document.querySelector(sel);
    if (!p) throw new Error("paragraph lost");
    const code = p.querySelector("code");
    const sel2 = window.getSelection();
    if (!sel2) throw new Error("no selection");
    sel2.removeAllRanges();
    const range = document.createRange();
    if (code) {
      // Texts after the code *element* (not its content's siblings).
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let t = walker.nextNode(); t; t = walker.nextNode()) texts.push(t as Text);
      const startIdx = texts.findIndex((t) => code.contains(t));
      const after = (startIdx >= 0 ? texts.slice(startIdx + 1) : []).filter(
        (t) => !code.contains(t) && t.data.trim() !== "",
      );
      const endText = after[Math.min(after.length - 1, 2)];
      const startNode = startIdx >= 0 ? texts[startIdx] : undefined;
      if (endText && startNode) {
        range.setStart(startNode, 0);
        range.setEnd(endText, Math.min(14, endText.data.length));
        sel2.addRange(range);
        (endText.parentElement ?? document).dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return `code:${(code.textContent ?? "").trim()}`;
      }
    }
    // Fallback: first plain word of 5+ letters outside links and code.
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let word: string | null = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if ((n as Text).parentElement?.closest?.("a, code")) continue;
      const hit = ((n as Text).data.match(/[A-Za-z]{5,}/) ?? [])[0];
      if (hit) {
        word = hit;
        range.selectNodeContents(n as Text);
        const at = (n as Text).data.indexOf(hit);
        range.setStart(n as Text, at);
        range.setEnd(n as Text, at + hit.length);
        break;
      }
    }
    if (!word) throw new Error("no threadable word");
    sel2.addRange(range);
    ((range.endContainer as Text).parentElement ?? document).dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
    return `word:${word}`;
  }, para);
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 15_000 });
  return `${para} :: ${quote}`;
}

for (const combo of [{ name: "1440-light", width: 1440, dark: false }] as const) {
  test(`thread polish tour (${combo.name})`, async ({ page }) => {
    if (!svc) throw new Error("service not running");
    test.setTimeout(420_000);
    const reviewId = await (async () => {
      const created = await apiJson(svc, "POST", "/api/reviews", { repoId: "demo" });
      const id = (created.json as { review: { id: string } }).review.id;
      const deadline = Date.now() + 90_000;
      for (;;) {
        const snap = await apiJson(svc, "GET", `/api/reviews/${id}`);
        const pages = (snap.json as { pages?: { id: string; cards: { id: string; blocks: unknown[] }[] }[] }).pages ?? [];
        const root = pages.find((p) => p.id === "root");
        if (root?.cards.some((c) => c.id === "problem" && c.blocks.length > 0)) return id;
        if (Date.now() > deadline) throw new Error("guide did not fill in time");
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    await page.setViewportSize({ width: combo.width, height: 900 });
    if (combo.dark) await page.emulateMedia({ colorScheme: "dark" });
    const suffix = combo.name;

    await page.goto(`${svc.origin}/review/${reviewId}?token=${svc.token}`);
    await expect(page.locator("#C-problem")).toBeVisible({ timeout: 30_000 });

    // Explain thread on the picked paragraph (cross-code when possible).
    // Explain fires immediately (no composer; Ask opens one): the thread
    // lands with a placeholder, then the replay agent fills the answer.
    await selectThreadQuote(page);
    await page.locator('#selbar [data-act="explain"]').click();
    const thread = page.locator("#page section.ithread[data-thread]").first();
    await expect(thread).toBeVisible({ timeout: 30_000 });
    const threadId = await thread.getAttribute("data-thread");
    expect(threadId).toBeTruthy();
    await expect(thread.locator('[data-reply][data-kind="explain"] .exp-b').first()).not.toBeEmpty({
      timeout: 90_000,
    });
    // Issue #331: inline avatar, neutral surface, thread at rest.
    await thread.scrollIntoViewIfNeeded();
    await expect(thread.locator(".spike-reply > .av.ai").first()).toBeVisible();
    await shot(page, "polish-thread-rest", suffix);

    // Hover-revealed reply toolbar.
    await thread.locator('[data-reply][data-kind="explain"] .exp-b').first().hover();
    await expect(thread.locator(".spike-reply > .ctl").first()).toBeVisible({ timeout: 10_000 });
    await shot(page, "polish-reply-toolbar", suffix);

    // The single Reply box asks a follow-up (#293 shape: comment + answer).
    await thread.locator('textarea[aria-label="Reply"]').fill("Does a cookie header change this?");
    await thread.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(thread.locator("[data-ask-answer] .exp-b").first()).not.toBeEmpty({ timeout: 90_000 });
    await shot(page, "polish-ask-followup", suffix);

    // Focused state: hovering the thread outlines it in accent (#301).
    await thread.hover();
    await expect
      .poll(async () => thread.evaluate((el) => el.classList.contains("on")), { timeout: 10_000 })
      .toBe(true);
    await shot(page, "polish-thread-focused", suffix);

    // Close: the paragraph keeps a thread-link mark beside its glossary term.
    await thread.getByRole("button", { name: "Close" }).click();
    await expect(page.locator(`#page section.ithread[data-thread="${threadId}"]`)).toHaveCount(0, {
      timeout: 15_000,
    });
    const mark = page.locator(`mark.anc.exl[data-jump="${threadId}"]:not(.fnote)`).first();
    await expect(mark).toBeVisible({ timeout: 15_000 });
    await mark.scrollIntoViewIfNeeded();
    await shot(page, "polish-marks-rest", suffix);

    // Glossary preview open (label + compact chip, #302/#304). Hover a
    // term outside the thread mark: on the #341 recording the quote starts
    // at the paragraph's first term, and a mark's own preview wins there.
    await page.evaluate(() => {
      const terms = [...document.querySelectorAll('p.sel[data-polish-para="1"] a.gx[data-glossary]')];
      const free = terms.find((a) => !a.closest("mark.anc") && !a.querySelector("mark.anc")) ?? terms[0];
      free?.setAttribute("data-polish-gx", "1");
    });
    const gx = page.locator('p.sel[data-polish-para="1"] a.gx[data-polish-gx="1"]');
    await gx.hover();
    await expect(page.locator("#pop .pv-label", { hasText: "Glossary" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#pop button.lk[data-src]")).toHaveCount(1);
    await shot(page, "polish-glossary-preview", suffix);

    // Thread-link preview open (pinned style, #302).
    await mark.hover();
    await expect(page.locator("#pop .pv-thr")).toBeVisible({ timeout: 15_000 });
    await shot(page, "polish-thread-preview", suffix);

    // Hunk toolbar with the new Summarize icon (#301): open an idle hunk
    // summary as a thread, delete it, and the Summarize button returns on
    // that hunk (deterministic even once summaries have landed). Scoped to
    // the file section, which survives the delete (a card-anchored locator
    // would detach with the card).
    await page.locator('#right [role="tab"]').getByText("Diff").click();
    const idle = page.locator('#right p[data-hunksum]').first();
    await expect(idle).toBeVisible({ timeout: 120_000 });
    const fileId = await idle.evaluate((el) => el.closest('[id^="F-"]')?.id ?? "");
    expect(fileId).toBeTruthy();
    const file = page.locator(`[id="${fileId}"]`);
    const knownThreads = await file
      .locator(".dhunk [data-thread]")
      .evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute("data-thread") ?? ""));
    await idle.scrollIntoViewIfNeeded();
    await idle.click();
    let hunkThreadId: string | null = null;
    await expect
      .poll(
        async () => {
          const ids = await file
            .locator(".dhunk [data-thread]")
            .evaluateAll((els) => els.map((e) => (e as HTMLElement).getAttribute("data-thread") ?? ""));
          hunkThreadId = ids.find((id) => id !== "" && !knownThreads.includes(id)) ?? null;
          return hunkThreadId;
        },
        { timeout: 15_000 },
      )
      .toBeTruthy();
    const hcard = file.locator(`.dhunk [data-thread="${hunkThreadId}"]`);
    await expect(hcard).toBeVisible({ timeout: 15_000 });
    await hcard.getByRole("button", { name: "Delete thread" }).click();
    await expect(hcard).toHaveCount(0, { timeout: 15_000 });
    // Delete takes the summary with it (J13); the on-demand Summarize
    // button is back on the hunk.
    const summarize = file.getByRole("button", { name: "Summarize" }).first();
    await expect(summarize).toBeVisible({ timeout: 15_000 });
    await summarize.scrollIntoViewIfNeeded();
    await shot(page, "polish-hunk-toolbar", suffix);

    // A comment thread on a diff line (#301: reviewer comment + Reply box).
    const line = page.locator('#right td.n.new:visible').first();
    await expect(line).toBeVisible({ timeout: 15_000 });
    await line.click();
    const slot = page.locator('#right .ithread[data-pending-thread]').first();
    await expect(slot).toBeVisible({ timeout: 15_000 });
    await slot.locator("textarea").fill("Tour comment probe.");
    await slot.getByRole("button", { name: "Save" }).click();
    const comment = page.locator('#right section.ithread[data-thread]', { hasText: "Tour comment probe." }).first();
    await expect(comment).toBeVisible({ timeout: 30_000 });
    await comment.scrollIntoViewIfNeeded();
    await shot(page, "polish-comment-thread", suffix);

    // A card with a cited list: chips inside items, no row below (#305).
    // The guide stays mounted beside the diff pane; scroll the list chip
    // into view there.
    const chip = page.locator('#page .blk ul.lst li button.lk, #page .blk ol.lst li button.lk').first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.scrollIntoViewIfNeeded();
    await shot(page, "polish-cited-list", suffix);
  });
}
