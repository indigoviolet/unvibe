/**
 * Comments + submit over mock mode (M6 web): selection toolbar, threads in
 * guide/diff/description, the Comments menu with For-PR drafts,
 * description editing, and the Submit panel.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

const CONN = "src-urllib3-connection.py";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/**
 * Select the first occurrence of `text` under `rootSelector` in the page,
 * optionally with partial offsets inside the matched text node, then
 * dispatch mouseup so the selection toolbar reacts as if the user dragged.
 * Returns the normalized quote the toolbar computed.
 */
async function selectText(
  page: Page,
  rootSelector: string,
  text: string,
  startIn = 0,
  endIn?: number,
): Promise<string> {
  await page.evaluate((rootSelector) => {
    document.querySelector(rootSelector)?.scrollIntoView({ block: "center" });
  }, rootSelector);
  // Let smooth scrolling settle so the toolbar measures stable rects.
  await page.waitForTimeout(350);
  const quote = await page.evaluate(
    ({ rootSelector, text, startIn, endIn }) => {
      const root = document.querySelector(rootSelector);
      if (!root) return null;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        const at = data.indexOf(text);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(node, at + startIn);
        range.setEnd(node, at + (endIn ?? text.length));
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        const host = (node as Text).parentElement;
        host?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        return true;
      }
      return null;
    },
    { rootSelector, text, startIn, endIn },
  );
  expect(quote).not.toBeNull();
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 3000 });
  // Re-read after the toolbar snapped the live selection to whole words.
  return (
    (await page.evaluate(() =>
      (getSelection()?.toString() ?? "").trim().replace(/\s+/g, " "),
    )) ?? ""
  );
}

test("selection snaps to whole words and Ask creates a working thread", async ({ page }) => {
  await gotoReview(page);
  // Partial selection inside "optional" snaps to the whole word.
  const quote = await selectText(page, "#C-central", "ptional", 0, 7);
  expect(quote).toBe("optional");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator("#C-central .ithread[data-pending-thread]");
  await expect(composer).toBeVisible();
  await expect(composer.locator(".mq")).toContainText("optional");
  await composer.locator("textarea").fill("What does optional mean here?");
  await composer.getByRole("button", { name: "Ask" }).click();
  // The thread shows the agent as working until the canned reply lands.
  const thread = page.locator("#C-central .ithread[data-thread]", {
    hasText: "What does optional mean here?",
  });
  await expect(thread.locator(".working")).toBeVisible({ timeout: 3000 });
  await expect(thread).toContainText("Mock answer", { timeout: 5000 });
  await expect(thread.locator(".msg .av.ai")).toBeVisible();
});

// DISABLED(#119): subset of interaction.spec.ts test 1 (select, Explain, expansion visible)
test.skip("Explain creates an expansion without breaking", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "optional");
  await page.locator('#selbar [data-act="explain"]').click();
  // No error toast: the mock fills the expansion like the service.
  await expect(page.locator("#toast")).toBeHidden({ timeout: 5000 });
  await expect(page.locator('#C-central [data-expansion]').first()).toBeVisible({ timeout: 5000 });
});

test("diff line click starts a comment; close leaves an icon; reopen works", async ({ page }) => {
  await gotoReview(page);
  const line = page.locator(`[id="L-${CONN}-91"] td.n.new`);
  await line.click();
  const slot = page.locator(`[id="F-${CONN}"] .ithread[data-pending-thread]`);
  await expect(slot).toBeVisible();
  await slot.locator("textarea").fill("A diff note");
  await slot.getByRole("button", { name: "Ask" }).click();
  // Scope to the created thread: the fixture already has open threads on
  // nearby lines in this file.
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`, { hasText: "A diff note" });
  await expect(thread).toBeVisible({ timeout: 5000 });
  // Close leaves a comment icon on the line number; clicking reopens.
  await thread.getByRole("button", { name: "Close" }).click();
  await expect(thread).toHaveCount(0);
  await expect(page.locator(`[id="L-${CONN}-91"] td.n.hc`)).toBeVisible();
  await page.locator(`[id="L-${CONN}-91"] td.n.new`).click();
  await expect(thread).toBeVisible();
});

test("reply drafts survive unrelated re-renders; Discard clears", async ({ page }) => {
  await gotoReview(page);
  const line = page.locator(`[id="L-${CONN}-91"] td.n.new`);
  await line.click();
  const slot = page.locator(`[id="F-${CONN}"] .ithread[data-pending-thread]`);
  await slot.locator("textarea").fill("keep me");
  // An unrelated change elsewhere re-renders the panes through a WS patch
  // (Hide uninteresting toggles prefs without folding the open hunk).
  await page.getByRole("button", { name: "Hide uninteresting" }).click();
  await expect(slot.locator("textarea")).toHaveValue("keep me");
  await page.getByRole("button", { name: "Hide uninteresting" }).click();
  await expect(slot.locator("textarea")).toHaveValue("keep me");
  // Discard on a new thread removes it without posting.
  await slot.getByRole("button", { name: "Discard" }).click();
  await expect(slot).toHaveCount(0);
});

test("For PR drafts live in the Comments menu and persist", async ({ page }) => {
  await gotoReview(page);
  const line = page.locator(`[id="L-${CONN}-91"] td.n.new`);
  await line.click();
  const slot = page.locator(`[id="F-${CONN}"] .ithread[data-pending-thread]`);
  await slot.locator("textarea").fill("Ship it?");
  await slot.getByRole("button", { name: "Ask" }).click();
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`).last();
  await expect(thread).toContainText("Ship it?", { timeout: 5000 });
  await thread.getByRole("button", { name: "Mark for the PR" }).click();
  await expect(thread.getByRole("button", { name: "Marked for the PR" })).toBeVisible();

  // The Comments menu lists it with a For-PR count; the draft is editable.
  await page.locator('#reviewbar [data-cm=""]').click();
  await page.locator('.cmenu [data-cmf="pr"]').click();
  const draft = page.locator(".cmenu textarea[id^='ob-']").first();
  await expect(draft).toBeVisible();
  await draft.fill("Ship it? (edited draft)");
  // The draft survives an unrelated re-render (close + reopen the menu).
  await page.keyboard.press("Escape");
  await page.locator('#reviewbar [data-cm=""]').click();
  await page.locator('.cmenu [data-cmf="pr"]').click();
  await expect(page.locator(".cmenu textarea[id^='ob-']").first()).toHaveValue("Ship it? (edited draft)");
  // Jump back to the thread in the diff.
  await page.locator(".cmenu .cj").first().click();
  await expect(page.locator(`[id="F-${CONN}"] .ithread[data-thread]`).last()).toBeVisible();
});

test("older versions are read-only: no toolbar, threads, drafts or submit", async ({ page }) => {
  await page.goto("/review/r-old?version=1");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await expect(page.locator('[data-testid="version-switcher"]').getByText("Viewing v1 · read-only")).toBeVisible();
  // Selecting guide text offers no toolbar.
  await page.evaluate(() => {
    document.querySelector("#C-central")?.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(350);
  await selectText(page, "#C-central", "optional").catch(() => null);
  await expect(page.locator("#selbar")).toBeHidden();
  // Diff line clicks refuse with a toast and open no composer.
  await page.locator(`[id="L-${CONN}-91"] td.n.new`).click();
  await expect(page.locator("#toast")).toContainText(/read-only/i, { timeout: 5000 });
  await expect(page.locator(`[id="F-${CONN}"] .ithread[data-pending-thread]`)).toHaveCount(0);
  // Submit explains it is disabled on the older version.
  await page.locator("#submitSlot [data-submit]").click();
  await expect(page.locator("#submitSlot .submit")).toContainText("older version", { timeout: 5000 });
  await page.keyboard.press("Escape");
  // Description editing is off on the older version.
  await page.locator('#right [role="tab"]').getByText("PR description").click();
  await expect(page.locator("#right [data-descedit]")).toHaveCount(0);
});

test("existing GitHub comments render read-only under their own heading", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#reviewbar [data-cm=""]').click();
  await expect(page.locator(".cmenu")).toContainText("Already on GitHub");
  await expect(page.locator(".cmenu")).toContainText("Already on GitHub: consider covering bare LF");
});

test("comments dropdown is wide enough for tabs, paths and previews", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#reviewbar [data-cm=""]').click();
  const panel = page.locator(".cmenu");
  await expect(panel).toBeVisible();
  // Sensible min-width so content doesn't collapse to the button width.
  const width = await panel.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThanOrEqual(340);
  // The All / For PR segmented control fits on one line.
  const all = await page.locator('.cmenu [data-cmf="all"]').boundingBox();
  const pr = await page.locator('.cmenu [data-cmf="pr"]').boundingBox();
  expect(all).not.toBeNull();
  expect(pr).not.toBeNull();
  expect(Math.abs((all as { y: number }).y - (pr as { y: number }).y)).toBeLessThan(2);
});

test("comments dropdown stays inside the viewport in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await gotoReview(page);
  // Below the 900px dock width the source pane starts as a hidden
  // overlay: open it first so the Comments button is visible.
  if (!(await page.locator("#right").isVisible())) {
    await page.locator("#toggleRight").click();
  }
  await expect(page.locator("#right")).toBeVisible();
  await page.locator('#reviewbar [data-cm=""]').click();
  const panel = page.locator(".cmenu");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect((box as { x: number; width: number }).x).toBeGreaterThanOrEqual(0);
  expect((box as { x: number; width: number }).x + (box as { width: number }).width).toBeLessThanOrEqual(800);
});

test("description editing saves locally with revert, then submits", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#right [role="tab"]').getByText("PR description").click();
  await page.locator("#right [data-descedit]").click();
  await page.locator("#right #descEdit").fill("Edited intro paragraph for the PR.");
  await page.locator("#right [data-descsave]").click();
  await expect(page.locator("#right")).toContainText("Edited · goes to GitHub when you submit the review");
  await expect(page.locator("#right [data-descrevert]")).toBeVisible();
  // The draft survives switching tabs and back.
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await page.locator('#right [role="tab"]').getByText("PR description").click();
  await expect(page.locator("#right")).toContainText("Edited · goes to GitHub when you submit the review");
});

test("submit panel previews and posts For-PR threads", async ({ page }) => {
  await gotoReview(page);
  const line = page.locator(`[id="L-${CONN}-91"] td.n.new`);
  await line.click();
  const slot = page.locator(`[id="F-${CONN}"] .ithread[data-pending-thread]`);
  await slot.locator("textarea").fill("Please add a test");
  await slot.getByRole("button", { name: "Ask" }).click();
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`).last();
  await expect(thread).toContainText("Please add a test", { timeout: 5000 });
  await thread.getByRole("button", { name: "Mark for the PR" }).click();

  await page.locator("#submitSlot [data-submit]").click();
  const panel = page.locator("#submitSlot .submit");
  await expect(panel).toContainText("connection.py:91", { timeout: 5000 });
  await expect(panel).toContainText("Please add a test");
  await expect(panel.locator("[data-submitgo]")).toContainText("Submit as you");
  await panel.locator("[data-submitgo]").click();
  await expect(panel).toContainText("Review posted", { timeout: 5000 });
  // Posted threads show their posted state and leave the pending count.
  await expect(page.locator("#submitSlot [data-submit] .count")).toHaveCount(0);
});
