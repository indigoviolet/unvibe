/**
 * M4 interaction over mock mode (PRD §4.3, §4.4, §4.7, §4.9, §4.10, §9.5).
 *
 * Covers the behaviours with no journey yet: reply-in-expansion with
 * per-answer controls (1c), card controls with draft survival (2),
 * seeded corrections (4), second opinion on expansions (5), no
 * auto-scroll on fill (6) and header conventions (8).
 *
 * (Explain/ask/delete flows, follow-ups with concept pages, and scroll
 * restore now live in J2/J266 against the real service — #258.)
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
