/**
 * Thread-polish tour (issues #301, #302, #303, #304, #305): thread rest and
 * focus states, Ask thread with follow-up, comment thread, the new Second
 * opinion and Summarize icons, thread-link vs glossary marks at rest, both
 * previews open, and a cited list — light and dark at 1440, plus 960 light.
 * Screenshots land in `visual-tour/` for the owner to look at.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { SERVICE_ENTRY, startService, type RunningService } from "./service-harness.js";
import { checkLayout } from "./layout-check.js";
import { apiJson } from "./journeys/journey-helpers.js";

test.skip(!existsSync(SERVICE_ENTRY), "needs `mise run build` first");

const SHOTS = fileURLToPath(new URL("../visual-tour", import.meta.url));

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

for (const combo of [
  { name: "1440-light", width: 1440, dark: false },
  { name: "1440-dark", width: 1440, dark: true },
  { name: "960-light", width: 960, dark: false },
] as const) {
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
    // Issue #301: inline avatar, neutral surface, thread at rest.
    await thread.scrollIntoViewIfNeeded();
    await expect(thread.locator(".spike-reply-head .av.ai").first()).toBeVisible();
    await shot(page, "polish-thread-rest", suffix);

    // Hover-revealed reply toolbar with the new Second opinion icon.
    await thread.locator('[data-reply][data-kind="explain"] .exp-b').first().hover();
    await expect(thread.locator(".spike-reply-head .ctl").first()).toBeVisible({ timeout: 10_000 });
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

    // Glossary preview open (label + compact chip, #302/#304).
    const gx = page.locator('p.sel[data-polish-para="1"] a.gx[data-glossary]').first();
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
    await hcard.getByRole("button", { name: "Delete" }).click();
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
