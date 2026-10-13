/**
 * Hunk summaries as content cards (issue #138) over mock mode: an idle
 * summary is plain text; selecting in it and choosing Explain activates
 * it into a card under the hunk and answers nested; clicking the summary
 * activates it with no agent call; a Comment lands on the hunk's first
 * changed line and never activates the summary.
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";

async function gotoDiff(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 8000 });
}

async function selectText(page: Page, rootSelector: string, text: string): Promise<void> {
  // Same polled shape as interaction.spec.ts: re-select until the bar
  // sticks (a late scroll dismisses it under load).
  await expect
    .poll(
      async () => {
        await page.evaluate((rootSelector) => {
          document.querySelector(rootSelector)?.scrollIntoView({ block: "center" });
        }, rootSelector);
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
        await page.waitForTimeout(150);
        return (await page.locator("#selbar").isVisible()) ? "shown" : "hidden-again";
      },
      { timeout: 15000 },
    )
    .toBe("shown");
}

test("select summary text, Explain: the card appears under the hunk", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator(".dhunk [data-expansion]").first();
  await expect(card).toBeVisible({ timeout: 5000 });
  // The nested answer fills inside the hunk card (two answer bodies: the
  // summary and the nested reply share the card's `.exp-b` divs).
  await expect(card).toContainText("Mock explanation", { timeout: 8000 });
  // The idle text gave way to the card (it stays a card).
  await expect(page.locator("p[data-hunksum]")).toHaveCount(0);
});

test("clicking the idle summary opens it as a card with no agent call", async ({ page }) => {
  await gotoDiff(page);
  const idle = page.locator("p[data-hunksum]").first();
  await expect(idle).toBeVisible({ timeout: 8000 });
  await idle.click();
  const card = page.locator(".dhunk [data-expansion]").first();
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card.locator(".exp-b")).toContainText("Unfolds folded header values", { timeout: 5000 });
});

test("a Comment on a summary lands on the line and never activates", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "p[data-hunksum]", "folded header values");
  await page.locator('#selbar [data-act="note"]').click();
  const composer = page.locator(".ithread[data-pending-thread]");
  await expect(composer).toBeVisible({ timeout: 5000 });
  // No card was activated under any hunk.
  await expect(page.locator(".dhunk [data-expansion]")).toHaveCount(0);
});
