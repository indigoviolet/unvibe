/**
 * Immediate action feedback over mock mode (issue #46).
 *
 * Every agent-starting control reacts on click, before the request
 * returns: the clicked control shows dots and conflicting controls go
 * disabled, rewrites get a left border, new content gets a placeholder,
 * and every indicator carries a fixed plain label — never streamed agent
 * text. The mock fills land 400–700 ms after the click, so a
 * MutationObserver armed before the click records the transient states
 * deterministically (no assertion round-trip race).
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

/** Record transient in-flight markers under #page from before the click. */
async function armObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __inflightSeen?: Record<string, boolean> }).__inflightSeen = {};
    const seen = (window as unknown as { __inflightSeen: Record<string, boolean> }).__inflightSeen;
    const note = (): void => {
      const root = document.querySelector("#page");
      if (!root) return;
      if (root.querySelector(".card.child.placeholder")) seen.placeholder = true;
      if (root.querySelector(".card.rewriting")) seen.rewriting = true;
      if (root.querySelector('[aria-busy="true"]')) seen.busy = true;
      if (root.querySelector(".working") && !root.querySelector(".working .stream")) {
        seen.plainWorking = true;
      }
      if (root.querySelector(".working .stream")) seen.stream = true;
    };
    new MutationObserver(note).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-busy", "class"],
    });
    note();
  });
}

async function seenFlags(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(
    () => (window as unknown as { __inflightSeen?: Record<string, boolean> }).__inflightSeen ?? {},
  );
}

test("explain from a selection shows a working expansion immediately, then fills", async ({ page }) => {
  await gotoReview(page);
  await armObserver(page);
  await selectText(page, "#C-central", "fast path");
  await page.locator('#selbar [data-act="explain"]').click();
  // The expansion arrives with a plain working state carrying a fixed
  // label (the mock fill lands ~700 ms later); a placeholder covers the
  // same spot in the frames before the response retargets it (unit
  // tested — too transient to catch from here).
  const exp = page.locator("#C-central [data-expansion]").first();
  await expect(exp).toBeVisible({ timeout: 5000 });
  await expect(exp.locator(".working").first()).toHaveText("Writing explanation…", { timeout: 5000 });
  await expect(exp).toContainText("Mock explanation", { timeout: 8000 });
  const seen = await seenFlags(page);
  expect(seen.plainWorking).toBe(true);
  expect(seen.stream).not.toBe(true);
});

test("follow-up click disables the chip and shows the answer working state", async ({ page }) => {
  await gotoReview(page);
  await armObserver(page);
  const follow = page.locator("#C-g-flow .follow button").first();
  await follow.click();
  // The answer expansion arrives with a plain working state (mock fill:
  // ~700 ms), and at no point renders streamed text.
  const exp = page.locator("#C-g-flow [data-expansion]").first();
  await expect(exp).toBeVisible({ timeout: 5000 });
  await expect(exp.locator(".working").first()).toHaveText("Writing answer…", { timeout: 5000 });
  await expect(exp).toContainText("Mock explanation", { timeout: 8000 });
  const seen = await seenFlags(page);
  expect(seen.busy).toBe(true);
  expect(seen.stream).not.toBe(true);
});

test("second opinion shows dots on its control plus a card working state", async ({ page }) => {
  await gotoReview(page);
  await armObserver(page);
  // Issue #167: the demo seeds an open pinned card under C-problem that
  // overlays the controls below it — close it first, as a reader would.
  await page.locator('#C-problem [data-expansion]').getByRole("button", { name: "Close" }).click();
  await page.locator("#C-central [data-so-ctl] button").first().click();
  // The control itself goes busy and the card shows where the verdict lands.
  await expect(page.locator('#C-central [data-so-ctl] button[aria-busy="true"]')).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator("#C-central > .working").first()).toHaveText(
    "Getting a second opinion…",
    { timeout: 5000 },
  );
  const seen = await seenFlags(page);
  expect(seen.busy).toBe(true);
  expect(seen.stream).not.toBe(true);
});
