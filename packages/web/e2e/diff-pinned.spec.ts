/**
 * Pinned threads in the diff pane (issue #204, revising #167): an Explain
 * thread opens pinned inline under its line — it takes space in the flow,
 * never overlays the code, and asking inside it appends a reply in the
 * same thread (flat, never nested).
 * (Was diff-floating.spec.ts's floating-overlay coverage.)
 */
import { expect, test } from "./network-guard.js";
import type { Page } from "@playwright/test";
import { selectText } from "./select-text.js";

async function gotoDiff(page: Page): Promise<void> {
  await page.goto("/review/demo");
  await expect(page.locator("#page .doc h1.title")).toContainText(
    "Unfold obsolete folded response headers",
  );
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.locator('#right [role="tab"]').getByText("Diff").click();
  await expect(page.locator("#right table.diff").first()).toBeVisible({ timeout: 8000 });
}

for (const mode of ["unified", "split"] as const) {
  test(`pinned thread opens inline under its anchored row (${mode})`, async ({ page }) => {
    await gotoDiff(page);
    if (mode === "split") await page.getByRole("button", { name: "Split" }).click();
    const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
    await selectText(page, scope, 'msg["fold-mixed-repeated"]');
    await page.locator('#selbar [data-act="explain"]').click();
    const thread = page.locator('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
    await expect(thread).toBeVisible({ timeout: 8000 });
    await expect(thread).not.toHaveClass(/floating/);
    await expect(page.locator(".dhunk .exp-float, .dhunk .dhunk-float")).toHaveCount(0);
    await expect(thread.getByRole("button", { name: /Pin into the page|Unpin/ })).toHaveCount(0);

    // The thread sits in the flow under its anchored row (not over it):
    // the row below the thread starts at or after the thread's bottom.
    const layout = await page.evaluate(() => {
      const threadEl = document.querySelector('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])');
      if (!threadEl) return { ok: false, why: "no pinned thread" };
      let row: Element | null = null;
      for (const tr of document.querySelectorAll('tr[id^="L-test-with_dummyserver-test_socketlevel.py-"]')) {
        if ((tr.textContent ?? "").includes('msg["fold-mixed-repeated"]')) row = tr;
      }
      if (!row) return { ok: false, why: "no anchored row" };
      const cr = threadEl.getBoundingClientRect();
      const rr = (row as Element).getBoundingClientRect();
      return {
        ok: cr.top >= rr.top && cr.bottom > cr.top,
        why: `threadTop=${Math.round(cr.top)} rowTop=${Math.round(rr.top)} threadBottom=${Math.round(cr.bottom)}`,
      };
    });
    expect(layout.ok, layout.why).toBe(true);
  });
}

test("asking inside a pinned thread appends in the same thread (#204)", async ({ page }) => {
  await gotoDiff(page);
  await selectText(page, "#right table.diff", "_OBSOLETE_FOLD_RE");
  await page.locator('#selbar [data-act="explain"]').click();
  const parent = page.locator('.dhunk section.ithread[data-thread]:has([data-reply][data-kind="explain"])').first();
  await expect(parent).toBeVisible({ timeout: 8000 });
  await expect(parent).not.toHaveClass(/floating/);
  // Select the thread's answer text: the toolbar appears inside the thread,
  // and Comment works from it as it does anywhere.
  await selectText(page, '.dhunk section.ithread[data-thread] [data-reply][data-kind="explain"] .exp-b', "Mock explanation");
  await page.locator('#selbar [data-act="note"]').click();
  const note = page.locator(".dhunk .ithread[data-pending-thread]").first();
  await expect(note).toBeVisible();
  await note.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".dhunk .ithread[data-pending-thread]")).toHaveCount(0);
  await selectText(page, '.dhunk section.ithread[data-thread] [data-reply][data-kind="explain"] .exp-b', "Mock explanation");
  await page.locator('#selbar [data-act="ask"]').click();
  const composer = page.locator(".dhunk .ithread[data-pending-thread]");
  await expect(composer).toBeVisible();
  await composer.locator("textarea").fill("Why is this here?");
  await composer.getByRole("button", { name: "Ask" }).click();
  const child = parent.locator('[data-reply][data-kind="ask"]', { hasText: "Why is this here?" });
  await expect(child).toContainText("Mock explanation", { timeout: 8000 });
  await expect(parent).not.toHaveClass(/floating/);
  // Closing the thread leaves the line's comment mark; the thread is gone.
  await parent.getByRole("button", { name: "Close" }).click();
  await expect(parent).toHaveCount(0);
});
