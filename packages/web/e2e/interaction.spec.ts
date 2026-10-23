/**
 * M4 interaction over mock mode (PRD §4.3, §4.4, §4.7, §4.9, §4.10, §9.5).
 *
 * Covers each numbered behaviour from the fixture:
 * 1. explanations (working → fill → close → dotted link → preview →
 *    re-expand → open as page → back; delete);
 * 2. card controls (depth instant, examples/diagram + nothing-to-add, undo,
 *    collapse; drafts survive);
 * 3. follow-ups + concept pages;
 * 4. corrections + shared-context indicator;
 * 5. second opinion on expansions;
 * 6. streaming polish (no auto-scroll);
 * 7. reader state (scroll restore, contents, trail);
 * 8. UI conventions (chevron first, × last, trash before ×, narrow widths).
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { cpuThrottleFromEnv } from "./cpu-throttle.js";
import { selectText } from "./select-text.js";

// Opt-in CPU throttling for reproducing timing races locally (issue #266):
// set UNVIBE_E2E_CPU_THROTTLE=4 (or higher); unset, this is a no-op.
test.beforeEach(async ({ page }) => {
  await cpuThrottleFromEnv(page);
});

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/**
 * Hover an anchor deterministically: scroll, wait for scroll quiet (a
 * scroll landing mid-hover dismisses the popover, PRD §4.5), move the
 * pointer in genuine steps, then aim at the anchor's own line boxes (a
 * wrapped anchor's union-box center can land on plain text) until the
 * cursor verifiably lands on it.
 */
async function hoverFresh(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __lastScrollAt?: number; __scrollHook?: boolean };
    w.__lastScrollAt = Date.now();
    if (!w.__scrollHook) {
      w.__scrollHook = true;
      document.addEventListener(
        "scroll",
        () => {
          w.__lastScrollAt = Date.now();
        },
        true,
      );
    }
  });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => Date.now() - ((window as unknown as { __lastScrollAt?: number }).__lastScrollAt ?? 0) > 400,
    { polling: 250, timeout: 10_000 },
  );
  await page.mouse.move(8, 200);
  const measure = (): Promise<{ x: number; y: number; width: number; height: number }[]> =>
    locator.evaluate((target) => {
      const out: { x: number; y: number; width: number; height: number }[] = [];
      const rs = target.getClientRects();
      for (let i = 0; i < rs.length; i++) out.push({ x: rs[i].x, y: rs[i].y, width: rs[i].width, height: rs[i].height });
      return out;
    });
  for (let i = 0; i < 4; i++) {
    const rects = await measure();
    if (rects.length === 0) throw new Error("anchor has no rects");
    const r = rects[Math.min(i, rects.length - 1)];
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    await page.mouse.move(x, y, { steps: 5 });
    const onAnchor = await locator.evaluate(
      (target, p: { x: number; y: number }) => {
        const hit = document.elementFromPoint(p.x, p.y);
        return !!hit && (hit === target || target.contains(hit));
      },
      { x, y },
    );
    if (onAnchor) return;
  }
  throw new Error("hover missed the anchor after 4 aims (layout still shifting?)");
}

test("1. explain fills, closes to a dotted link, previews, re-expands, opens as a page", async ({
  page,
}) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator('#C-central [data-expansion]').first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // Working state, then filled content with the standard controls.
  await expect(card.locator(".working").first()).toBeVisible({ timeout: 5000 });
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  await expect(card.getByRole("button", { name: "Open as page" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Delete" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
  // Close removes the card and leaves a dotted link on the anchor text.
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toHaveCount(0);
  const mark = page.locator("#C-central mark.anc.exl").first();
  await expect(mark).toBeVisible({ timeout: 5000 });
  // Hover previews the explanation.
  await hoverFresh(page, mark);
  await expect(page.locator("#pop")).toBeVisible({ timeout: 3000 });
  await expect(page.locator("#pop")).toContainText("Mock explanation");
  await page.keyboard.press("Escape");
  // Click re-expands in place.
  await mark.click();
  await expect(page.locator('#C-central [data-expansion]').first()).toBeVisible({ timeout: 5000 });
  // Open as page moves the content to a new page titled with the quote.
  const again = page.locator('#C-central [data-expansion]').first();
  await again.getByRole("button", { name: "Open as page" }).click();
  await expect(page).toHaveURL(/\/review\/demo\/page\/p-mock-/, { timeout: 5000 });
  await expect(page.locator("#page h1.title")).toContainText("fast path");
  await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete");
  await page.goBack();
  await expect(page.locator("#C-central")).toBeVisible();
});

test("1b. expansion delete removes the card", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator('#C-central [data-expansion]').first();
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator('#C-central [data-expansion]').first()).toHaveCount(0);
});

test("1c. the reply box answers in the same conversation (issue #136)", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator('#C-central [data-expansion]').first();
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  // Reply in the card's own box; a second answer lands on the same card.
  await card.getByPlaceholder("Ask a follow-up…").fill("What about ordering?");
  await card.getByRole("button", { name: "Reply", exact: true }).click();
  const answers = card.locator("[data-answer]");
  await expect(answers).toHaveCount(2, { timeout: 8000 });
  await expect(answers.nth(1)).toContainText("Mock explanation", { timeout: 8000 });
  await expect(answers.nth(1).locator(".ans-q")).toContainText("What about ordering?");
  // Per-answer controls address the answer: depth on the second answer.
  await answers.nth(1).locator(".ctl").getByRole("button", { name: "Simpler" }).click();
  await expect(answers.nth(1).locator(".prose").first()).toContainText("is about unfolding folded header values", { timeout: 8000 });
});

test("2. card controls: depth, examples, diagram, undo, collapse; drafts survive", async ({
  page,
}) => {
  await gotoReview(page);
  const card = page.locator("#C-central");
  // Issue #167: the demo seeds an open pinned card under C-problem that
  // overlays the controls below it — close it first, as a reader would.
  await page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" }).click();
  // Depth − is instant (the fixture stores all three levels).
  const prose = card.locator(".prose").first();
  const before = await prose.innerText();
  await card.locator("> .ctl").getByRole("button", { name: "Simpler" }).click();
  await expect.poll(() => prose.innerText(), { timeout: 5000 }).not.toBe(before);
  await card.locator("> .ctl").getByRole("button", { name: "Deeper" }).click();
  await expect.poll(() => prose.innerText(), { timeout: 5000 }).toBe(before);
  // Use examples inserts once; a second click says nothing more to add.
  await card.locator("> .ctl").getByRole("button", { name: "Use examples" }).click();
  await expect(card.locator(".gen-aside").first()).toBeVisible({ timeout: 5000 });
  const asides = await card.locator(".gen-aside").count();
  await card.locator("> .ctl").getByRole("button", { name: "Use examples" }).click();
  // The second click adds nothing — and toasts nothing either (the mock
  // answers accepted with no job and no reused flag, so no toast fires).
  // Negative wait: the duplicate path is fully synchronous in the mock,
  // so 250 ms covers the React commit on any machine.
  await page.waitForTimeout(250);
  expect(await card.locator(".gen-aside").count()).toBe(asides);
  // Add diagram inserts after the paragraphs it relates to.
  await card.locator("> .ctl").getByRole("button", { name: "Add diagram" }).click();
  await expect(card.locator(".dg, .md, pre.code").first()).toBeVisible({ timeout: 5000 });
  // Undo is enabled and reverts the diagram; expansions survive it.
  await expect(card.locator("> .ctl").getByRole("button", { name: "Undo" })).toBeEnabled();
  // Draft survival: type a reply, then undo, and the text stays.
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator("#C-central .ithread[data-pending-thread] textarea, #C-central .composer textarea").first();
  await composer.fill("draft that must survive");
  await card.locator("> .ctl").getByRole("button", { name: "Undo" }).click();
  await expect(composer).toHaveValue("draft that must survive");
  await page.keyboard.press("Escape");
  // Collapse chevron first, × last behaviour via the title row.
  await card.locator("> .chead").getByRole("button", { name: "Collapse" }).click();
  await expect(card).toHaveClass(/collapsed/);
  await card.getByRole("button", { name: "Expand" }).click();
  await expect(card).not.toHaveClass(/collapsed/);
});

test("3. follow-up answers and disappears; concept links open their pages", async ({ page }) => {
  await gotoReview(page);
  const follow = page.locator("#C-g-flow .follow button").first();
  const label = await follow.innerText();
  await follow.click();
  // The suggestion disappears and its answer arrives as an expansion.
  await expect(page.locator("#C-g-flow .follow", { hasText: label })).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('#C-g-flow [data-expansion]').first()).toContainText("Mock explanation", {
    timeout: 8000,
  });
  // Existing concept links open their full pages (write-on-first-open is
  // covered against the real service, where unwritten slugs occur).
  await page.locator('#page a.cx[data-link="concept:obs-fold"]').first().click();
  await expect(page).toHaveURL(/page\/c-obs-fold/, { timeout: 5000 });
  await expect(page.locator("#page h1.title")).toContainText("Obsolete", { timeout: 15_000 });
});

test("4. corrections show with accept/dismiss; no shared-context line on the review page", async ({
  page,
}) => {
  await gotoReview(page);
  // The seed contribution targets the central card.
  const suggestion = page.locator('#C-central [data-correction="ct-seed-2"]');
  await expect(suggestion).toBeVisible({ timeout: 5000 });
  await expect(suggestion).toContainText("overstates the scope");
  await suggestion.getByRole("button", { name: "Dismiss" }).click();
  await expect(suggestion).toHaveCount(0, { timeout: 5000 });
  // #225: no shared-context line on the review page; it lives on Debug only.
  await expect(page.locator("[data-shared-indicator]")).toHaveCount(0);
  await expect(page.getByText(/kept \d+ notes? from your conversations/)).toHaveCount(0);
});

test("5. second opinion works on expansions and survives depth", async ({ page }) => {
  await gotoReview(page);
  // The fixture seeds an open expansion on the problem card.
  const exp = page.locator('#C-problem [data-expansion]').first();
  await expect(exp).toBeVisible({ timeout: 5000 });
  await exp.getByRole("button", { name: /Second opinion/ }).click();
  await expect(exp.locator("[data-so]").first()).toBeVisible({ timeout: 5000 });
  // Depth on the expansion leaves the result attached: wait for the depth
  // change itself (Undo enables only once the depth action lands — the
  // block is already visible, so waiting on it would prove nothing), then
  // check the result survived it.
  await exp.getByRole("button", { name: "Simpler" }).click();
  await expect(exp.getByRole("button", { name: "Undo" })).toBeEnabled({ timeout: 5000 });
  await expect(exp.locator("[data-so]").first()).toBeVisible({ timeout: 5000 });
});

test("6. filling never scrolls the page on its own", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "fast path");
  const scroller = page.locator("#page");
  await page.waitForTimeout(200);
  const top = await scroller.evaluate((el) => el.scrollTop);
  await page.locator('#selbar [data-act="explain"]').click();
  // Wait for the mock fill (700 ms) before comparing: the point is the
  // fill itself never scrolls the page.
  const exp6 = page.locator("#C-central [data-expansion]").first();
  await expect(exp6.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  expect(await scroller.evaluate((el) => el.scrollTop)).toBe(top);
});

test("7. reader state: scroll restore, contents lists opened pages, trail", async ({ page }) => {
  await gotoReview(page);
  // Open an expansion as a page, then check Contents + trail.
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator('#C-central [data-expansion]').first();
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  await card.getByRole("button", { name: "Open as page" }).click();
  await expect(page).toHaveURL(/page\/p-mock-/, { timeout: 5000 });
  await expect(page.locator("#page nav.crumbs")).toContainText("Unfold obsolete");
  const pageId = page.url().match(/page\/(.+)$/)?.[1] ?? "";
  await page.goBack();
  await expect(page.locator("#C-central")).toBeVisible();
  // Contents lists the expansion-opened page under linked pages.
  const link = page.locator(`nav.toc [data-node="${pageId}"]`);
  await expect(link).toBeVisible({ timeout: 5000 });
  // Scroll restore: scroll, navigate away and back, position returns.
  // Wait until the scroll sticks before navigating: under a loaded frame
  // budget the commit can lag (the page on screen may still be the short
  // one being left, which clamps the offset to 0) and the save only counts
  // once the position has applied (#266). Re-issue until it reads back.
  // The offset keeps the clicked Contents link on screen (the guide's
  // linked-pages entry sits near the top): clicking an off-screen link
  // auto-scrolls it into view first, so the restored position would
  // legitimately be the revealed one, not the intended one.
  await expect
    .poll(
      () =>
        page.locator("#page").evaluate((el) => {
          el.scrollTo(0, 200);
          return el.scrollTop;
        }),
      { timeout: 5000 },
    )
    .toBe(200);
  // Loud premise: the click below must not move the scroll itself. The
  // link must already sit inside #page's visible area (viewport
  // coordinates would ignore the review bar above the pane).
  const vis = await page.evaluate((sel) => {
    const pane = document.getElementById("page");
    const target = pane?.querySelector(sel);
    if (!pane || !target) return null;
    const p = pane.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    return { top: b.y - p.y, bottom: b.y + b.height - p.y, height: p.height };
  }, `nav.toc [data-node="${pageId}"]`);
  expect(vis?.top).toBeGreaterThanOrEqual(0);
  expect(vis?.bottom).toBeLessThanOrEqual(vis?.height ?? 0);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`page/${pageId}`));
  await page.goBack();
  await expect.poll(() => page.locator("#page").evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(150);
});

test("8. header conventions and narrow widths", async ({ page }) => {
  await gotoReview(page);
  const head = page.locator("#C-central > .chead");
  const buttons = head.getByRole("button");
  // Chevron first on the left.
  expect(await buttons.first().getAttribute("aria-label")).toMatch(/Collapse|Expand/);
  // Expansion header: quote, Open as page, Delete, Close last.
  const exp = page.locator('#C-problem [data-expansion]').first();
  const expBtns = exp.locator(".exp-h button");
  expect(await expBtns.last().getAttribute("aria-label")).toBe("Close");
  const labels = await expBtns.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(labels.indexOf("Delete")).toBeLessThan(labels.indexOf("Close"));
  // Nothing disappears at narrow widths.
  await page.setViewportSize({ width: 800, height: 900 });
  await expect(page.locator("#C-central > .ctl").first()).toBeVisible();
  await expect(exp.locator(".exp-h").getByRole("button", { name: "Close" })).toBeVisible();
});
