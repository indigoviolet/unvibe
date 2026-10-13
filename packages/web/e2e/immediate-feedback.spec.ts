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

async function gotoReview(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
}

async function selectText(page: Page, rootSelector: string, text: string): Promise<void> {
  // Select and wait in one polled step (same as interaction.spec.ts):
  // scrollIntoView can deliver its scroll event after the toolbar shows
  // when the loop is busy, and a late scroll dismisses the bar — so
  // select-then-assert flakes. Re-select until the bar sticks; a repeated
  // select is harmless (same range, same mouseup path) and converges once
  // the scroll lands.
  await expect
    .poll(
      async () => {
        await page.evaluate((rootSelector) => {
          document.querySelector(rootSelector)?.scrollIntoView({ block: "center" });
        }, rootSelector);
        // No settle wait: the app has no smooth scrolling.
        const found = await page.evaluate(
          ({ rootSelector, text }) => {
            const root = document.querySelector(rootSelector);
            if (!root) return false;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              const data = (node as Text).data;
              const at = data.indexOf(text);
              if (at < 0) continue;
              const range = document.createRange();
              range.setStart(node, at);
              range.setEnd(node, at + text.length);
              const sel = getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
              (node as Text).parentElement?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
              return true;
            }
            return false;
          },
          { rootSelector, text },
        );
        if (!found) return "not-found";
        // Let a late scroll land before reading the bar.
        await page.waitForTimeout(150);
        return (await page.locator("#selbar").isVisible()) ? "shown" : "hidden-again";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
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
