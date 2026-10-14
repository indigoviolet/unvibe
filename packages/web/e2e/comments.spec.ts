/**
 * Comments + submit over mock mode (M6 web): selection toolbar, threads in
 * guide/diff/description, the Comments menu with For-PR drafts,
 * description editing, and the Submit panel.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

const CONN = "src-urllib3-connection.py";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}



test("selection snaps to whole words and Ask creates a working card", async ({ page }) => {
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
  // The card shows the agent as working until the canned answer lands.
  const card = page.locator("#C-central [data-expansion]", {
    hasText: "What does optional mean here?",
  });
  await expect(card.locator(".working")).toBeVisible({ timeout: 3000 });
  await expect(card).toContainText("Mock explanation", { timeout: 8000 });
  // The question reads as the answer heading; the card never posts.
  await expect(card.locator(".ans-q").first()).toContainText("What does optional mean here?");
  await expect(card.getByRole("button", { name: "Mark for the PR" })).toHaveCount(0);
});

test("toolbar Comment creates a quiet thread marked for the PR", async ({ page }) => {
  await gotoReview(page);
  await selectText(page, "#C-central", "optional");
  await page.locator('#selbar [data-act="note"]').click();
  const composer = page.locator("#C-central .ithread[data-pending-thread]");
  await expect(composer).toBeVisible();
  await expect(composer.locator("textarea")).toHaveAttribute("placeholder", "Write a comment…");
  await composer.locator("textarea").fill("A quiet comment");
  await composer.getByRole("button", { name: "Save" }).click();
  const thread = page.locator("#C-central .ithread[data-thread]", {
    hasText: "A quiet comment",
  });
  await expect(thread).toBeVisible({ timeout: 5000 });
  // No agent reply, already marked for the PR.
  await expect(thread.locator(".working")).toHaveCount(0);
  await expect(thread.locator(".msg .av.ai")).toHaveCount(0);
  await thread.getByRole("button", { name: "Close" }).click();
  await expect(thread).toHaveCount(0);
});

test("GitHub action links diff lines at the review commit; hidden on the demo", async ({ page }) => {
  // Demo review: selections offer no GitHub action (no GitHub file view).
  await gotoReview(page);
  await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
  await expect(page.locator("#selbar")).toBeVisible();
  await expect(page.locator('#selbar [data-act="github"]')).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A GitHub-backed review: the action links the selected lines at the
  // review's head commit, after Comment in toolbar order.
  await page.goto("/review/gh-link");
  await expect(page.locator(`[id="L-${CONN}-91"]`)).toBeVisible({ timeout: 10_000 });
  await page.evaluate((conn) => {
    const cell1 = document.querySelector(`[id="L-${conn}-91"] td.c`);
    const cell2 = document.querySelector(`[id="L-${conn}-92"] td.c`);
    if (!cell1 || !cell2) throw new Error("diff rows not found");
    const walker = (root: Element): Text | null => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if ((n as Text).data.trim().length > 3) return n as Text;
      }
      return null;
    };
    const t1 = walker(cell1);
    const t2 = walker(cell2);
    if (!t1 || !t2) throw new Error("no text in diff rows");
    const range = document.createRange();
    range.setStart(t1, 0);
    range.setEnd(t2, Math.min(4, t2.data.length));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    cell2.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, CONN);
  await expect(page.locator("#selbar")).toBeVisible({ timeout: 3000 });
  const acts = await page.locator("#selbar [data-act]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-act")),
  );
  expect(acts).toEqual(["explain", "ask", "note", "github"]);
  const link = page.locator('#selbar [data-act="github"]');
  await expect(link).toHaveAttribute(
    "href",
    /https:\/\/github\.com\/urllib3\/urllib3\/blob\/bdcc1e493e\/.+#L91-L92/,
  );
  await expect(link).toHaveAttribute("target", "_blank");
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
  await slot.locator("textarea").fill("A diff comment");
  await slot.getByRole("button", { name: "Save" }).click();
  // Scope to the created thread: the fixture already has open threads on
  // nearby lines in this file.
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`, { hasText: "A diff comment" });
  await expect(thread).toBeVisible({ timeout: 5000 });
  // A comment is for the PR by default: no agent reply, already marked.
  await expect(thread.locator(".working")).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "Marked for the PR" })).toBeVisible();
  // Close leaves a comment icon on the line number; clicking reopens.
  await thread.getByRole("button", { name: "Close" }).click();
  await expect(thread).toHaveCount(0);
  await expect(page.locator(`[id="L-${CONN}-91"] td.n.hc`)).toBeVisible();
  await page.locator(`[id="L-${CONN}-91"] td.n.new`).click();
  await expect(thread).toBeVisible();
});

test("an Ask card and a comment share one diff line", async ({ page }) => {
  // Plain first paint (?nohl=1) keeps code text in whole nodes so the
  // single-range selection helper works on diff code.
  await page.goto("/review/demo?nohl=1");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  const file = `[id="F-${CONN}"]`;
  await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator(`${file} .ithread[data-pending-thread]`);
  await expect(composer).toBeVisible({ timeout: 5000 });
  await composer.locator("textarea").fill("Why here?");
  await composer.getByRole("button", { name: "Ask" }).click();
  const card = page.locator(`${file} [data-expansion]`, { hasText: "Why here?" });
  await expect(card).toBeVisible({ timeout: 8000 });
  await expect(card.locator(".exp-b").first()).not.toBeEmpty({ timeout: 8000 });
  await expect(card.getByPlaceholder("Ask a follow-up…")).toBeVisible();
  // A Comment on the same selection: the teal card and the sand thread
  // render side by side under the line — neither hides the other.
  await selectText(page, `${file} table.diff`, "_OBSOLETE_FOLD_RE");
  await page.locator('#selbar [data-act="note"]').click();
  const noteComposer = page.locator(`${file} .ithread[data-pending-thread]`);
  await expect(noteComposer).toBeVisible({ timeout: 5000 });
  await noteComposer.locator("textarea").fill("A note here.");
  await noteComposer.getByRole("button", { name: "Save" }).click();
  const note = page.locator(`${file} .ithread[data-thread]`, { hasText: "A note here." });
  await expect(note).toBeVisible({ timeout: 8000 });
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/card child/);
  await expect(note).toHaveClass(/ithread/);
});

test("AI-suggested comments carry no reply box; Ask opens an Ask card (issue #163)", async ({ page }) => {
  await gotoReview(page);
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  // The seeded suggestion on the diff (agent text, not yet for the PR).
  const sug = page.locator("#t-sgperf");
  await expect(sug).toBeVisible({ timeout: 15000 });
  // No reply box on the suggestion — a reply could never be answered.
  await expect(sug.locator("textarea")).toHaveCount(0);
  // "Ask the agent about this", as on user comments.
  await sug.getByRole("button", { name: "Ask the agent about this" }).click();
  const card = page.locator('#right .dhunk [data-expansion]', { hasText: "quadratic case?" });
  await expect(card.locator(".exp-b")).toContainText("Mock explanation", { timeout: 8000 });
  await card.getByRole("button", { name: "Close" }).click();
  // Selecting in the suggestion summons the toolbar, anchored to the comment.
  await selectText(page, "#t-sgperf .msg", "quadratic");
  await expect(page.locator("#selbar")).toBeVisible();
  await page.locator('#selbar [data-act="ask"]').click();
  await expect(page.locator('#right .ithread[data-pending-thread]')).toBeVisible({ timeout: 5000 });
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
  await slot.getByRole("button", { name: "Save" }).click();
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`).last();
  await expect(thread).toContainText("Ship it?", { timeout: 5000 });
  // Comments are for the PR by default — no explicit mark needed.
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
  await expect(page.locator('[data-testid="version-switcher"]')).toHaveAttribute("data-ro", "1");
  await expect(page.locator('#version-pick option[value="2"]')).toContainText("current");
  // Selecting guide text offers no toolbar. The selection is made inline
  // (range + mouseup, no waits — the toolbar hides synchronously on
  // read-only versions); the selected text is asserted first so a missing
  // selection cannot pass vacuously, then the toolbar must stay hidden.
  const selected = await page.evaluate(() => {
    const root = document.querySelector("#C-central");
    if (!root) throw new Error("no #C-central");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf("optional");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "optional".length);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return getSelection()?.toString() ?? "";
    }
    throw new Error("text 'optional' not found in #C-central");
  });
  expect(selected).toBe("optional");
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

test("GitHub thread in the diff expands at its line; the menu item jumps to it", async ({ page }) => {
  await gotoReview(page);
  const thread = page.locator("#gh-thread-101");
  await expect(thread).toBeVisible();
  await expect(thread).toContainText("teammate · 2 comments");
  await thread.getByRole("button", { name: "Expand comments from teammate" }).click();
  await expect(thread).toContainText("consider covering bare LF");
  await expect(thread.getByText("Open on GitHub")).toHaveCount(2);
  // The menu item jumps back to the thread in the diff.
  await page.locator('#reviewbar [data-cm=""]').click();
  await page.locator('.cmenu [data-ghjump="101"]').click();
  await expect(page.locator(".cmenu")).toHaveCount(0);
  await expect(page.locator("#gh-thread-101")).toContainText("consider covering bare LF");
});

test("outdated threads sit at their file; removed-file threads at the end; hiding folds the menu section", async ({
  page,
}) => {
  await gotoReview(page);
  const conn = page.locator(`[id="F-${CONN}"]`);
  await expect(conn).toContainText("GitHub comments on lines no longer in the diff");
  await expect(page.locator("[data-gh-orphans]")).toContainText("review-bot · 1 comment");
  // Hide them in the diff: threads vanish, and the menu section follows
  // the same setting — it folds to its heading with a count (#183).
  await page.getByRole("button", { name: "Show file list" }).click();
  await page.getByRole("button", { name: "File filters" }).click();
  await page.getByRole("menuitemcheckbox", { name: /GitHub comments/ }).click();
  await expect(page.locator("#gh-thread-101")).toHaveCount(0);
  await page.locator('#reviewbar [data-cm=""]').click();
  await expect(page.locator(".cmenu [data-ghhead]")).toContainText(/Already on GitHub · \d+ hidden/);
  await expect(page.locator('.cmenu [data-ghjump="101"]')).toHaveCount(0);
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

test("hide in the filter menu collapses the menu section to its count; its heading shows both again (#183)", async ({
  page,
}) => {
  await gotoReview(page);
  // Diff threads are shown to start with.
  await expect(page.locator("#gh-thread-101")).toBeVisible();
  // Hide existing GitHub comments from the diff's filter menu.
  await page.getByRole("button", { name: "Show file list" }).click();
  await page.getByRole("button", { name: "File filters" }).click();
  await page.getByRole("menuitemcheckbox", { name: /GitHub comments/ }).click();
  await expect(page.locator("#gh-thread-101")).toHaveCount(0);
  // The comments menu's section collapses to its heading with a count.
  await page.locator('#reviewbar [data-cm=""]').click();
  const panel = page.locator(".cmenu");
  await expect(panel.locator("[data-ghhead]")).toContainText(/Already on GitHub · \d+ hidden/);
  await expect(panel.locator("[data-ghjump]")).toHaveCount(0);
  // Clicking the heading shows them again, in the menu and in the diff.
  await panel.locator("[data-ghhead]").click();
  await expect(panel.locator('[data-ghjump="101"]')).toBeVisible();
  await page.locator('#reviewbar [data-cm=""]').click();
  await expect(page.locator("#gh-thread-101")).toBeVisible();
});

test("existing GitHub list: no sideways overflow and clamped rows at minimum width (#183)", async ({ page }) => {
  // Narrow window: the menu sits at its minimum width.
  await page.setViewportSize({ width: 800, height: 700 });
  await gotoReview(page);
  if (!(await page.locator("#right").isVisible())) {
    await page.locator("#toggleRight").click();
  }
  await page.locator('#reviewbar [data-cm=""]').click();
  const panel = page.locator(".cmenu");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-ghjump="105"]')).toBeVisible();
  const overflow = await panel.evaluate((el) => el.scrollWidth <= el.clientWidth);
  expect(overflow).toBe(true);
  // Rows are clamped: the long made-up body shows at most a few lines.
  const body = panel.locator('[data-ghjump="105"] .ghmenu');
  const lines = await body.evaluate((el) => {
    const h = el.getBoundingClientRect().height;
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 18;
    return h / lh;
  });
  expect(lines).toBeLessThanOrEqual(3.5);
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
  await slot.getByRole("button", { name: "Save" }).click();
  const thread = page.locator(`[id="F-${CONN}"] .ithread[data-thread]`).last();
  await expect(thread).toContainText("Please add a test", { timeout: 5000 });
  // Already marked for the PR by default.

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
