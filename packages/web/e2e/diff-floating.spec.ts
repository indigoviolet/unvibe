/**
 * Floating cards in the diff pane (issues #167, #140): a floating card
 * overlays the code below its anchor, and it must paint above the
 * line-number gutter and the code rows — while the pinned file/hunk
 * headers and the actions bar still slide over it.
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
  test(`floating card opens at its anchored row deep in a hunk (${mode})`, async ({ page }) => {
    await gotoDiff(page);
    if (mode === "split") await page.getByRole("button", { name: "Split" }).click();
    // The socket-level hunk runs ~60 rows: pick a token near its end, far
    // below the hunk header, and Explain it.
    const scope = '[id="F-test-with_dummyserver-test_socketlevel.py"]';
    await selectText(page, scope, 'msg["fold-mixed-repeated"]');
    await page.locator('#selbar [data-act="explain"]').click();
    const card = page.locator(".dhunk .card.child.floating").first();
    await expect(card).toBeVisible({ timeout: 8000 });

    // The card's top sits at the anchored row's bottom (within a few px),
    // not at the top of the hunk. Both rects move together on scroll, so
    // viewport coordinates compare directly without scrolling the card.
    const gap = await page.evaluate(() => {
      const cardEl = document.querySelector(".dhunk .card.child.floating");
      if (!cardEl) return { ok: false, why: "no floating card" };
      let row: Element | null = null;
      for (const tr of document.querySelectorAll('tr[id^="L-test-with_dummyserver-test_socketlevel.py-"]')) {
        if ((tr.textContent ?? "").includes('msg["fold-mixed-repeated"]')) row = tr;
      }
      if (!row) return { ok: false, why: "no anchored row" };
      const cr = cardEl.getBoundingClientRect();
      const rr = (row as Element).getBoundingClientRect();
      const header = document.querySelector(".dhunk-h");
      const hr = header?.getBoundingClientRect();
      return {
        ok: Math.abs(cr.top - rr.bottom) <= 6 && (!hr || cr.top > hr.bottom + 100),
        why: `cardTop=${Math.round(cr.top)} rowBottom=${Math.round(rr.bottom)} headerBottom=${hr ? Math.round(hr.bottom) : "?"}`,
      };
    });
    expect(gap.ok, gap.why).toBe(true);
  });
}

test("floating card paints above the line-number gutter", async ({ page }) => {
  await gotoDiff(page);
  // An anchor with plain code rows below it (the regex anchor further up
  // has a comment slot row below it, which has no gutter cell to cover).
  await selectText(page, "#right table.diff", "headers_changed = True");
  await page.locator('#selbar [data-act="explain"]').click();
  const card = page.locator(".dhunk .card.child.floating").first();
  await expect(card).toBeVisible({ timeout: 8000 });
  await card.scrollIntoViewIfNeeded();

  // A point inside the card that lies over the gutter column of a row
  // below the anchor: the topmost element there must be the card, not a
  // line number.
  const hit = await page.evaluate(() => {
    const cardEl = document.querySelector(".dhunk .card.child.floating");
    if (!cardEl) return { ok: false, why: "no floating card" };
    const cr = cardEl.getBoundingClientRect();
    for (const n of document.querySelectorAll("table.diff td.n")) {
      const r = n.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const inViewport = x >= 0 && x < window.innerWidth && y >= 0 && y < window.innerHeight;
      if (inViewport && x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
        const el = document.elementFromPoint(x, y);
        return {
          ok: !!el && (el === cardEl || cardEl.contains(el)),
          why: el ? `${el.tagName}.${el.className}` : "nothing",
          x,
          y,
        };
      }
    }
    return { ok: false, why: "no gutter cell under the card" };
  });
  expect(hit.ok, `elementFromPoint over the gutter returned ${hit.why}`).toBe(true);
});
